import { z } from "zod";
import { DateTime } from "luxon";
import { config } from "../config.mjs";
import {
  query, encrypt, decrypt, digest, newId, SafeError, audit
} from "../db.mjs";
import { databaseNow, expandWindow } from "../scheduling.mjs";

function fail(code, message, status = 409) {
  throw new SafeError(status, code, message);
}

const id = z.number().int().positive();
const queryId = z.coerce.number().int().positive();
const reference = z.string().regex(/^[a-f0-9]{32}$/);
const role = z.enum([
  "scheduler", "clinician", "administrator", "auditor"
]);
const statusValues = [
  "pending", "approved", "declined", "expired",
  "cancelled", "completed", "no_show"
];

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(value =>
    DateTime.fromISO(value, { zone: config.zone }).toISODate() === value
  );

const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

const weeklyRow = z.object({
  weekday: z.number().int().min(1).max(7),
  open: time,
  close: time
}).strict().refine(row => row.open < row.close, {
  message: "Opening must precede closing."
});

const exceptionRow = z.object({
  date,
  closed: z.boolean(),
  open: time.nullish(),
  close: time.nullish()
}).strict().superRefine((row, context) => {
  if (!row.closed && (!row.open || !row.close || row.open >= row.close)) {
    context.addIssue({
      code: "custom",
      message: "Opening must precede closing."
    });
  }
});

const scheduleSchema = z.object({
  locationId: id,
  providerId: id,
  from: date,
  to: date,
  weekly: z.array(weeklyRow).max(56),
  exceptions: z.array(exceptionRow).max(93)
}).strict();

function dateRange(from, to) {
  const start = DateTime.fromISO(from, {
    zone: config.zone
  }).startOf("day");
  const last = DateTime.fromISO(to, {
    zone: config.zone
  }).startOf("day");

  if (!start.isValid || !last.isValid ||
      last < start || last.diff(start, "days").days > 92) {
    fail("DATE_RANGE", "Choose at most 93 inclusive days.", 400);
  }

  return { start, end: last.plus({ days: 1 }) };
}

function validateSchedule(edit, now) {
  dateRange(edit.from, edit.to);

  if (edit.from < now.setZone(config.zone).toISODate()) {
    fail(
      "PAST_DATE",
      "The exception edit range must start today or later.",
      400
    );
  }

  const sorted = [...edit.weekly].sort((a, b) =>
    a.weekday - b.weekday || a.open.localeCompare(b.open)
  );

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];

    if (current.weekday === previous.weekday &&
        current.open < previous.close) {
      fail("WINDOW_OVERLAP", "Weekly intervals overlap.", 400);
    }
  }

  const seen = new Set();
  for (const item of edit.exceptions) {
    if (item.date < edit.from || item.date > edit.to ||
        seen.has(item.date)) {
      fail(
        "EXCEPTION_DATE",
        "Use one override per date inside the edit range.",
        400
      );
    }
    seen.add(item.date);
  }
}

function safeAuditDetails(raw) {
  let data = raw;
  if (typeof raw === "string") {
    try { data = JSON.parse(raw); }
    catch { return {}; }
  }

  const result = {};
  if (!data || typeof data !== "object") return result;

  for (const key of [
    "locationId", "providerId", "version", "conflictCount"
  ]) {
    if (Number.isSafeInteger(data[key])) result[key] = data[key];
  }
  for (const key of ["from", "to"]) {
    if (statusValues.includes(data[key])) result[key] = data[key];
  }
  for (const key of ["rolesBefore", "rolesAfter"]) {
    if (Array.isArray(data[key])) {
      result[key] = data[key].filter(value => role.safeParse(value).success);
    }
  }
  return result;
}

export function mountManagement({ add, need, scopeSQL }) {
  async function providerLock(connection, providerId) {
    const [provider] = await query(
      "SELECT id FROM providers WHERE id=? FOR UPDATE",
      [providerId],
      connection
    );
    if (!provider) fail("NOT_FOUND", "Resource unavailable.", 404);
  }

  async function snapshot(connection, providerId) {
    await providerLock(connection, providerId);

    await query(
      `INSERT IGNORE INTO staff_schedule_revisions
       (provider_id,version) VALUES(?,0)`,
      [providerId],
      connection
    );

    const [revision] = await query(
      "SELECT version FROM staff_schedule_revisions WHERE provider_id=?",
      [providerId],
      connection
    );

    const now = await databaseNow(connection);
    const clinicDay = now.setZone(config.zone).toISODate();
    const start = DateTime.fromISO(clinicDay, {
      zone: config.zone
    }).toUTC();

    const bookings = await query(
      `SELECT id,location_id,provider_id,type_id,
         starts_at,ends_at,status,version
       FROM appointment_requests
       WHERE provider_id=? AND ends_at>=?
         AND status IN ('pending','approved')
       ORDER BY id LIMIT 5001`,
      [providerId, start.toJSDate()],
      connection
    );

    const weekly = await query(
      `SELECT id,location_id,provider_id,weekday,
         TIME_FORMAT(open_time,'%H:%i') AS open,
         TIME_FORMAT(close_time,'%H:%i') AS close
       FROM weekly_windows
       WHERE provider_id=?
       ORDER BY id LIMIT 5001`,
      [providerId],
      connection
    );

    const exceptions = await query(
      `SELECT id,location_id,provider_id,
         DATE_FORMAT(local_date,'%Y-%m-%d') AS date,closed,
         TIME_FORMAT(open_time,'%H:%i') AS open,
         TIME_FORMAT(close_time,'%H:%i') AS close
       FROM schedule_exceptions
       WHERE local_date>=?
         AND (provider_id IS NULL OR provider_id=?)
       ORDER BY id LIMIT 5001`,
      [clinicDay, providerId],
      connection
    );

    const types = await query(
      `SELECT b.*,t.duration_minutes
       FROM booking_options b
       JOIN appointment_types t ON t.id=b.type_id
       WHERE b.provider_id=?
       ORDER BY b.location_id,b.type_id LIMIT 5001`,
      [providerId],
      connection
    );

    if ([bookings, weekly, exceptions, types].some(rows =>
      rows.length > 5000
    )) {
      fail(
        "SNAPSHOT_LIMIT",
        "This schedule exceeds the safe preview limit.",
        413
      );
    }

    const data = {
      clinicDay,
      zone: config.zone,
      lead: config.leadMinutes,
      horizon: config.horizonDays,
      revision: revision.version,
      bookings,
      weekly,
      exceptions,
      types
    };

    return {
      ...data,
      now,
      hash: digest(JSON.stringify(data))
    };
  }

  function conflicts(state, edit) {
    const matchesPair = row =>
      Number(row.location_id) === edit.locationId &&
      Number(row.provider_id) === edit.providerId;

    const exceptions = state.exceptions.filter(row =>
      !(matchesPair(row) &&
        row.date >= edit.from &&
        row.date <= edit.to)
    );

    for (const row of edit.exceptions) {
      exceptions.push({
        ...row,
        id: Number.MAX_SAFE_INTEGER,
        location_id: edit.locationId,
        provider_id: edit.providerId
      });
    }

    const cache = new Map();

    function fitsWindow(day, opening, closing, start, end) {
      const key = `${day}:${opening}:${closing}`;
      if (!cache.has(key)) {
        const minutes = expandWindow(
          day, opening, closing, 1, config.zone
        );

        cache.set(key, minutes.length ? [
          Math.min(...minutes.map(item => item.start.toMillis())),
          Math.max(...minutes.map(item => item.end.toMillis()))
        ] : null);
      }

      const bounds = cache.get(key);
      return Boolean(bounds && start >= bounds[0] && end <= bounds[1]);
    }

    return state.bookings.filter(booking => {
      if (!matchesPair(booking) ||
          booking.ends_at.getTime() <= state.now.toMillis()) {
        return false;
      }

      const local = DateTime.fromJSDate(booking.starts_at, {
        zone: config.zone
      });
      const day = local.toISODate();

      const applicable = exceptions.filter(row =>
        row.date === day &&
        (row.location_id == null ||
          Number(row.location_id) === edit.locationId) &&
        (row.provider_id == null ||
          Number(row.provider_id) === edit.providerId)
      );

      if (applicable.some(row => Boolean(Number(row.closed)))) {
        return true;
      }

      const openings = applicable
        .filter(row => !Number(row.closed))
        .sort((a, b) =>
          Number(b.location_id != null) +
          Number(b.provider_id != null) -
          Number(a.location_id != null) -
          Number(a.provider_id != null) ||
          Number(b.id) - Number(a.id)
        );

      const windows = openings.length
        ? [openings[0]]
        : edit.weekly.filter(row => row.weekday === local.weekday);

      return !windows.some(row => fitsWindow(
        day, row.open, row.close,
        booking.starts_at.getTime(),
        booking.ends_at.getTime()
      ));
    }).map(booking => ({
      reference: booking.id,
      status: booking.status,
      startsAt: booking.starts_at.toISOString(),
      endsAt: booking.ends_at.toISOString()
    }));
  }

  add("get", "/availability", async (req, ctx, connection) => {
    const input = z.object({
      locationId: queryId,
      providerId: queryId,
      from: date,
      to: date
    }).strict().parse(req.query);

    need(ctx, "availability", input.locationId, input.providerId);
    dateRange(input.from, input.to);

    const weekly = await query(
      `SELECT weekday,
         TIME_FORMAT(open_time,'%H:%i') AS open,
         TIME_FORMAT(close_time,'%H:%i') AS close
       FROM weekly_windows
       WHERE location_id=? AND provider_id=?
       ORDER BY weekday,open_time`,
      [input.locationId, input.providerId],
      connection
    );

    const rows = await query(
      `SELECT DATE_FORMAT(local_date,'%Y-%m-%d') AS date,closed,
         TIME_FORMAT(open_time,'%H:%i') AS open,
         TIME_FORMAT(close_time,'%H:%i') AS close
       FROM schedule_exceptions
       WHERE location_id=? AND provider_id=?
         AND local_date BETWEEN ? AND ?
       ORDER BY local_date,id DESC`,
      [input.locationId, input.providerId, input.from, input.to],
      connection
    );

    const byDate = new Map();
    for (const row of rows) {
      const closed = Boolean(Number(row.closed));
      if (!byDate.has(row.date) || closed) {
        byDate.set(row.date, { ...row, closed });
      }
    }

    return {
      weekly,
      exceptions: [...byDate.values()],
      from: input.from,
      to: input.to
    };
  });

  add("post", "/availability/preview", async (req, ctx, connection) => {
    const edit = scheduleSchema.parse(req.body);
    need(ctx, "availability", edit.locationId, edit.providerId);

    const state = await snapshot(connection, edit.providerId);
    validateSchedule(edit, state.now);

    const found = conflicts(state, edit);
    const previewId = newId();
    const expires = state.now.plus({ minutes: 5 });

    await query(
      `INSERT INTO staff_previews
       (id,subject,location_id,provider_id,payload_enc,
        snapshot_hash,expires_at,created_at)
       VALUES(?,?,?,?,?,?,?,?)`,
      [
        previewId, ctx.subject, edit.locationId, edit.providerId,
        encrypt(edit), state.hash,
        expires.toJSDate(), state.now.toJSDate()
      ],
      connection
    );

    await audit(connection, null, ctx.subject, "availability.previewed", {
      locationId: edit.locationId,
      providerId: edit.providerId,
      conflictCount: found.length
    });

    return {
      previewId,
      conflicts: found,
      expiresAt: expires.toISO()
    };
  });

  add("post", "/availability/save", async (req, ctx, connection) => {
    const body = z.object({
      previewId: reference,
      acknowledgeConflicts: z.boolean()
    }).strict().parse(req.body);

    const [preview] = await query(
      `SELECT * FROM staff_previews
       WHERE id=? AND subject=? FOR UPDATE`,
      [body.previewId, ctx.subject],
      connection
    );

    if (!preview) fail("NOT_FOUND", "Preview unavailable.", 404);

    need(
      ctx, "availability",
      Number(preview.location_id), Number(preview.provider_id)
    );

    const state = await snapshot(connection, Number(preview.provider_id));

    if (preview.used_at ||
        preview.expires_at.getTime() <= state.now.toMillis()) {
      fail("PREVIEW_EXPIRED", "Generate a fresh preview.");
    }
    if (preview.snapshot_hash !== state.hash) {
      fail("PREVIEW_CHANGED", "Bookings or scheduling changed. Preview again.");
    }

    const edit = scheduleSchema.parse(decrypt(preview.payload_enc));
    if (edit.locationId !== Number(preview.location_id) ||
        edit.providerId !== Number(preview.provider_id)) {
      fail("PREVIEW_CHANGED", "Generate a fresh preview.");
    }
    validateSchedule(edit, state.now);

    const found = conflicts(state, edit);
    if (found.length && !body.acknowledgeConflicts) {
      fail("ACK_REQUIRED", "Review and acknowledge the listed conflicts.");
    }

    await query(
      "DELETE FROM weekly_windows WHERE location_id=? AND provider_id=?",
      [edit.locationId, edit.providerId],
      connection
    );

    for (const row of edit.weekly) {
      await query(
        `INSERT INTO weekly_windows
         (location_id,provider_id,weekday,open_time,close_time)
         VALUES(?,?,?,?,?)`,
        [
          edit.locationId, edit.providerId,
          row.weekday, row.open, row.close
        ],
        connection
      );
    }

    await query(
      `DELETE FROM schedule_exceptions
       WHERE location_id=? AND provider_id=?
         AND local_date BETWEEN ? AND ?`,
      [edit.locationId, edit.providerId, edit.from, edit.to],
      connection
    );

    for (const row of edit.exceptions) {
      await query(
        `INSERT INTO schedule_exceptions
         (location_id,provider_id,local_date,closed,open_time,close_time)
         VALUES(?,?,?,?,?,?)`,
        [
          edit.locationId, edit.providerId, row.date,
          row.closed ? 1 : 0,
          row.closed ? null : row.open,
          row.closed ? null : row.close
        ],
        connection
      );
    }

    await query(
      `UPDATE staff_schedule_revisions
       SET version=version+1 WHERE provider_id=?`,
      [edit.providerId],
      connection
    );
    await query(
      "UPDATE staff_previews SET used_at=UTC_TIMESTAMP(3) WHERE id=?",
      [preview.id],
      connection
    );

    await audit(connection, null, ctx.subject, "availability.saved", {
      locationId: edit.locationId,
      providerId: edit.providerId,
      conflictCount: found.length
    });

    return {
      message: "Availability saved. Existing appointments were not changed."
    };
  });

  add("get", "/sessions", async (req, ctx, connection) => {
    const rows = await query(
      `SELECT id,created_at,expires_at,last_seen_at
       FROM staff_sessions
       WHERE subject=? AND revoked_at IS NULL
         AND expires_at>UTC_TIMESTAMP(3)
         AND idle_expires_at>UTC_TIMESTAMP(3)
       ORDER BY created_at DESC LIMIT 100`,
      [ctx.subject],
      connection
    );

    return {
      items: rows.map(row => ({
        id: row.id,
        current: row.id === ctx.sessionId,
        createdAt: row.created_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
        lastSeenAt: row.last_seen_at.toISOString()
      }))
    };
  });

  add("post", "/sessions/revoke", async (req, ctx, connection) => {
    const body = z.object({
      id: reference
    }).strict().parse(req.body);

    const [session] = await query(
      `SELECT id FROM staff_sessions
       WHERE id=? AND subject=? FOR UPDATE`,
      [body.id, ctx.subject],
      connection
    );

    if (!session) fail("NOT_FOUND", "Session unavailable.", 404);

    await query(
      "UPDATE staff_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE id=?",
      [session.id],
      connection
    );

    const pairs = new Map(ctx.grants.map(grant => [
      `${grant.locationId}:${grant.providerId}`,
      {
        locationId: Number(grant.locationId),
        providerId: Number(grant.providerId)
      }
    ]));
    for (const pair of pairs.values()) {
      await audit(
        connection, null, ctx.subject, "staff.session.revoked", pair
      );
    }

    const current = session.id === ctx.sessionId;
    return {
      message: "Session revoked.",
      current,
      signedOut: current
    };
  });

  add("get", "/audit", async (req, ctx, connection) => {
    need(ctx, "audit");

    const input = z.object({
      from: date,
      to: date,
      event: z.string()
        .regex(/^[a-zA-Z0-9_.:-]{0,64}$/)
        .default(""),
      offset: z.coerce.number().int().min(0).max(10000).default(0)
    }).strict().parse(req.query);

    const dates = dateRange(input.from, input.to);
    const requestScope = scopeSQL(ctx, "audit", "r");
    const metadataScope = scopeSQL(ctx, "audit", "a");
    const eventPrefix = input.event.replace(/[=%_]/g, value => "=" + value) + "%";

    const rows = await query(
      `SELECT CAST(a.id AS CHAR) AS id,
         a.event,a.request_id AS reference,
         a.created_at AS createdAt,a.details,
         COALESCE(u.display_name,'Recorded operator') AS actor
       FROM (
         SELECT e.*,
           CAST(
             JSON_UNQUOTE(JSON_EXTRACT(e.details,'$.locationId'))
             AS UNSIGNED
           ) AS location_id,
           CAST(
             JSON_UNQUOTE(JSON_EXTRACT(e.details,'$.providerId'))
             AS UNSIGNED
           ) AS provider_id
         FROM audit_events e
       ) a
       LEFT JOIN appointment_requests r ON r.id=a.request_id
       LEFT JOIN staff_users u ON u.subject=a.actor
       WHERE a.created_at>=? AND a.created_at<?
         AND a.event LIKE ? ESCAPE '='
         AND (
           (a.request_id IS NOT NULL AND (${requestScope.sql}))
           OR
           (a.request_id IS NULL AND (${metadataScope.sql}))
         )
       ORDER BY a.created_at DESC,a.id DESC
       LIMIT 51 OFFSET ?`,
      [
        dates.start.toUTC().toJSDate(),
        dates.end.toUTC().toJSDate(),
        eventPrefix,
        ...requestScope.params,
        ...metadataScope.params,
        input.offset
      ],
      connection
    );

    return {
      items: rows.slice(0, 50).map(row => ({
        id: row.id,
        event: row.event,
        reference: row.reference,
        actor: row.actor,
        createdAt: row.createdAt.toISOString(),
        details: safeAuditDetails(row.details)
      })),
      nextOffset: rows.length > 50 && input.offset < 10000
        ? input.offset + 50
        : null,
      clinicTimeZone: config.zone
    };
  });
}