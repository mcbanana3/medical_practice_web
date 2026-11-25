import { randomUUID, randomBytes } from "node:crypto";
import { DateTime } from "luxon";
import { z } from "zod";

import { config } from "../config.mjs";
import {
  query, audit, encrypt, decrypt, digest, newId, SafeError
} from "../db.mjs";
import { authSettings } from "../auth/settings.mjs";
import { createRequest } from "../requests.mjs";
import {
  databaseNow, findOption, slotsFor
} from "../scheduling.mjs";
import {
  getRescheduleContext, cancelWithRelated, applyRescheduleDecision
} from "../reschedules.mjs";
import { enqueueNotifications } from "../notifications.mjs";
import { queue } from "./mail.mjs";

const reference = z.string().regex(/^[a-f0-9]{32}$/);
const positive = z.number().int().positive();
const queryId = z.coerce.number().int().positive();
const version = z.number().int().positive();
const reason = z.string().trim().max(500).optional();
const contactMethod = z.enum(["phone", "in_person", "verified_message"]);
const statuses = [
  "pending", "approved", "declined", "expired",
  "cancelled", "completed", "no_show"
];

const fail = (code, message, status = 409) => {
  throw new SafeError(status, code, message);
};

const iso = value => new Date(value).toISOString();

function current(row, expected) {
  if (Number(row.version) !== expected) {
    fail("REQUEST_CHANGED", "The record changed. Reload before acting.");
  }
}

function future(row, now) {
  if (
    !["pending", "approved"].includes(row.status) ||
    row.starts_at.getTime() <= now.toMillis()
  ) fail("CHANGE_UNAVAILABLE", "A future active appointment is required.");
}

const columns = `
  r.id AS reference,r.status,r.starts_at AS startsAt,
  r.ends_at AS endsAt,r.location_id AS locationId,
  r.provider_id AS providerId,l.name AS location,
  p.name AS provider,t.name AS appointmentType`;

const joins = `
  FROM appointment_requests r
  JOIN locations l ON l.id=r.location_id
  JOIN providers p ON p.id=r.provider_id
  JOIN appointment_types t ON t.id=r.type_id`;

const rowView = row => ({
  ...row,
  startsAt: iso(row.startsAt),
  endsAt: iso(row.endsAt)
});

export function mountOperations({ add, need, scoped, scopeSQL }) {
  async function owner(c, requestId) {
    const [row] = await query(
      "SELECT patient_id FROM patient_request_links WHERE request_id=?",
      [requestId], c
    );
    return row?.patient_id || null;
  }

  async function note(c, ctx, row, text) {
    if (!text) return;
    await query(
      `INSERT INTO staff_notes
        (id,request_id,actor,note_enc,created_at)
       VALUES (?,?,?,?,UTC_TIMESTAMP(3))`,
      [newId(), row.id, ctx.subject, encrypt({ text })], c
    );
  }

  async function updateMail(c, row, key) {
    const text =
      "An appointment record has an update. " +
      "Sign in for its current status or use the practice's verified contact channel. " +
      "Do not reply with medical details.";

    for (const [kind, to] of [
      ["patient", decrypt(row.contact_enc).email],
      ["admin", config.adminEmail]
    ]) {
      await queue(c, key + ":" + kind, {
        to, subject: "Appointment update", text
      });
    }
  }

  async function patient(c, ctx, id, permission = "patients") {
    const scope = scopeSQL(ctx, permission);

    const [relationship] = await query(
      `SELECT r.id FROM appointment_requests r
       JOIN patient_request_links x ON x.request_id=r.id
       WHERE x.patient_id=? AND (${scope.sql})
       ORDER BY r.starts_at DESC LIMIT 1`,
      [id, ...scope.params], c
    );

    if (!relationship) fail("NOT_FOUND", "Patient unavailable.", 404);

    const [account] = await query(
      `SELECT id,profile_enc FROM patient_accounts
       WHERE id=? AND disabled_at IS NULL
         AND email_verified_at IS NOT NULL`,
      [id], c
    );

    if (!account) fail("NOT_FOUND", "Patient unavailable.", 404);

    await audit(
      c, relationship.id, ctx.subject,
      permission === "medical"
        ? "patient.medical.viewed"
        : "patient.summary.viewed"
    );

    return { account, relationship };
  }

  async function patientView(c, account) {
    const profile = decrypt(account.profile_enc);
    const [stored] = await query(
      "SELECT details_enc FROM patient_details WHERE patient_id=?",
      [account.id], c
    );
    const details = stored ? decrypt(stored.details_enc) : {};

    return {
      reference: account.id,
      displayName: profile.displayName || "",
      email: profile.email,
      phone: details.phone || ""
    };
  }

  add("get", "/options", async (req, ctx, c) => {
    const pairs = await query(
      `SELECT DISTINCT
         g.location_id AS locationId,g.provider_id AS providerId,
         l.name AS location,p.name AS provider
       FROM staff_grants g
       JOIN locations l ON l.id=g.location_id
       JOIN providers p ON p.id=g.provider_id
       WHERE g.subject=?
       ORDER BY l.name,p.name`,
      [ctx.subject], c
    );

    const scope = scopeSQL(ctx, "read", "b");
    const types = await query(
      `SELECT b.location_id AS locationId,b.provider_id AS providerId,
         t.id,t.name,t.duration_minutes AS durationMinutes
       FROM booking_options b
       JOIN appointment_types t ON t.id=b.type_id
       WHERE (${scope.sql}) ORDER BY t.name`,
      scope.params, c
    );

    const now = (await databaseNow(c)).setZone(config.zone);

    return {
      pairs, types, clinicTimeZone: config.zone,
      minDate: now.toISODate(),
      maxDate: now.plus({ days: config.horizonDays }).toISODate()
    };
  });

  add("get", "/requests", async (req, ctx, c) => {
    const q = z.object({
      from: z.string(), to: z.string(),
      status: z.string().optional(),
      locationId: queryId.optional(),
      providerId: queryId.optional(),
      q: z.string().trim().max(254).optional(),
      offset: z.coerce.number().int().min(0).max(10000).default(0)
    }).strict().parse(req.query);

    const from = DateTime.fromISO(q.from, { zone: config.zone }).startOf("day");
    const to = DateTime.fromISO(q.to, { zone: config.zone }).startOf("day");

    if (
      !from.isValid || !to.isValid ||
      from.toISODate() !== q.from || to.toISODate() !== q.to ||
      to < from || to.diff(from, "days").days > 92
    ) fail("DATE_RANGE", "Choose at most 93 inclusive clinic-local days.", 400);

    const scope = scopeSQL(ctx, "read");
    const clauses = [
      `(${scope.sql})`, "r.starts_at>=?", "r.starts_at<?"
    ];
    const params = [
      ...scope.params,
      from.toUTC().toJSDate(),
      to.plus({ days: 1 }).toUTC().toJSDate()
    ];

    for (const [key, column] of [
      ["locationId", "location_id"], ["providerId", "provider_id"]
    ]) if (q[key]) {
      clauses.push(`r.${column}=?`);
      params.push(q[key]);
    }

    if (q.q) {
      if (reference.safeParse(q.q).success) {
        clauses.push("r.id=?");
        params.push(q.q);
      } else {
        const email = z.string().email().parse(q.q).toLowerCase();
        clauses.push(`EXISTS (
          SELECT 1 FROM patient_request_links x
          JOIN patient_accounts a ON a.id=x.patient_id
          WHERE x.request_id=r.id AND a.email_hash=?
        )`);
        params.push(digest("patient-email:" + email));
      }
    }

    const counts = Object.fromEntries(statuses.map(s => [s, 0]));
    for (const row of await query(
      `SELECT r.status,COUNT(*) AS count
       FROM appointment_requests r
       WHERE ${clauses.join(" AND ")} GROUP BY r.status`,
      params, c
    )) counts[row.status] = Number(row.count);

    if (q.status) {
      const selected = z.array(z.enum(statuses)).min(1).max(7)
        .parse(q.status.split(","));
      clauses.push(`r.status IN (${selected.map(() => "?").join(",")})`);
      params.push(...selected);
    }

    const rows = await query(
      `SELECT ${columns} ${joins}
       WHERE ${clauses.join(" AND ")}
       ORDER BY r.starts_at,r.id LIMIT 51 OFFSET ?`,
      [...params, q.offset], c
    );

    for (const row of rows.slice(0, 50)) {
      await audit(c, row.reference, ctx.subject, "request.listed");
    }

    return {
      items: rows.slice(0, 50).map(rowView), counts,
      nextOffset: rows.length > 50 && q.offset < 10000 ? q.offset + 50 : null,
      clinicTimeZone: config.zone
    };
  });

  add("get", "/requests/:ref", async (req, ctx, c) => {
    const row = await scoped(req.params.ref, ctx, c);
    const contact = decrypt(row.contact_enc);

    const notes = await query(
      `SELECT n.note_enc,COALESCE(u.display_name,'Recorded operator') AS actor,
         n.created_at AS createdAt
       FROM staff_notes n
       LEFT JOIN staff_users u ON u.subject=n.actor
       WHERE n.request_id=?
       ORDER BY n.created_at DESC,n.id DESC LIMIT 50`,
      [row.id], c
    );

    const history = await query(
      `SELECT a.event,a.created_at AS createdAt,
         COALESCE(u.display_name,'Recorded operator') AS actor
       FROM audit_events a
       LEFT JOIN staff_users u ON u.subject=a.actor
       WHERE a.request_id=?
       ORDER BY a.created_at DESC,a.id DESC LIMIT 50`,
      [row.id], c
    );

    const proposals = await query(
      `SELECT id,status,starts_at AS startsAt,version,
         original_version AS originalVersion,
         replacement_id AS replacementReference
       FROM staff_proposals WHERE original_id=?
       ORDER BY created_at DESC,id DESC LIMIT 50`,
      [row.id], c
    );

    await audit(c, row.id, ctx.subject, "request.viewed");

    return {
      reference: row.id, status: row.status, version: row.version,
      startsAt: iso(row.starts_at), endsAt: iso(row.ends_at),
      locationId: row.location_id, providerId: row.provider_id,
      typeId: row.type_id, location: row.location,
      provider: row.provider, appointmentType: row.appointmentType,
      contact: {
        name: contact.name, email: contact.email,
        phone: contact.phone || "", reason: contact.reason || ""
      },
      patientReference: await owner(c, row.id),
      reschedule: await getRescheduleContext(row.id, c),
      notes: notes.map(n => ({
        text: decrypt(n.note_enc).text,
        actor: n.actor, createdAt: iso(n.createdAt)
      })),
      history: history.map(h => ({ ...h, createdAt: iso(h.createdAt) })),
      proposals: proposals.map(p => ({ ...p, startsAt: iso(p.startsAt) })),
      clinicTimeZone: config.zone
    };
  });

  add("post", "/requests/:ref/action", async (req, ctx, c) => {
    const body = z.object({
      action: z.enum(["approve", "decline", "cancel", "completed", "no_show"]),
      expectedVersion: version, staffReason: reason
    }).strict().parse(req.body);

    const permission = ["completed", "no_show"].includes(body.action)
      ? "outcome" : "decide";

    const row = await scoped(req.params.ref, ctx, c, permission, true);
    current(row, body.expectedVersion);
    const now = await databaseNow(c);

    if (["approve", "decline"].includes(body.action)) {
      if (row.status !== "pending") fail("REQUEST_CHANGED", "Only pending requests can be decided.");

      const status = body.action === "approve" ? "approved" : "declined";

      if (status === "approved") {
        future(row, now);
        const conflicts = await query(
          `SELECT id FROM appointment_requests
           WHERE provider_id=? AND id<>?
             AND starts_at<? AND ends_at>?
             AND status IN ('pending','approved')
           LIMIT 1 FOR UPDATE`,
          [row.provider_id, row.id, row.ends_at, row.starts_at], c
        );
        if (conflicts.length) fail("SLOT_UNAVAILABLE", "The provider interval conflicts with another reservation.");
      }

      await query(
        `UPDATE appointment_requests
         SET status=?,expires_at=NULL,version=version+1 WHERE id=?`,
        [status, row.id], c
      );

      await applyRescheduleDecision(c, row, status, ctx.subject);
      await audit(c, row.id, ctx.subject, "request." + status, {
        from: row.status, to: status, version: row.version + 1
      });
      await enqueueNotifications(c, row.id, status, decrypt(row.contact_enc).email);
    } else if (body.action === "cancel") {
      future(row, now);
      await cancelWithRelated(c, row, await owner(c, row.id), ctx.subject);
    } else {
      if (
        row.status !== "approved" ||
        (body.action === "completed" ? row.ends_at : row.starts_at).getTime() >
          now.toMillis()
      ) fail("OUTCOME_UNAVAILABLE", "This outcome cannot be recorded yet.");

      if ((await getRescheduleContext(row.id, c)).pendingReplacementReference) {
        fail("RESCHEDULE_PENDING", "Resolve the pending replacement request first.");
      }

      await query(
        "UPDATE appointment_requests SET status=?,version=version+1 WHERE id=?",
        [body.action, row.id], c
      );
      await audit(c, row.id, ctx.subject, "request." + body.action, {
        from: row.status, to: body.action, version: row.version + 1
      });
      await updateMail(c, row, `outcome:${row.id}:${row.version + 1}`);
    }

    await note(c, ctx, row, body.staffReason);
    return { message: "Appointment updated." };
  });

  add("get", "/slots", async (req, ctx, c) => {
    const q = z.object({
      locationId: queryId, providerId: queryId,
      typeId: queryId, date: z.string()
    }).strict().parse(req.query);

    need(ctx, "read", q.locationId, q.providerId);
    const option = await findOption(q, c);

    return {
      slots: await slotsFor(option, q.date, await databaseNow(c), c),
      clinicTimeZone: config.zone
    };
  });

  add("post", "/requests/:ref/propose", async (req, ctx, c) => {
    const body = z.object({
      startsAt: z.string().datetime(),
      expectedVersion: version, staffReason: reason
    }).strict().parse(req.body);

    if (!config.enabled) fail("BOOKING_UNAVAILABLE", "Appointment requests are unavailable.", 503);

    const row = await scoped(req.params.ref, ctx, c, "decide", true);
    current(row, body.expectedVersion);
    const now = await databaseNow(c);
    future(row, now);

    if ((await query(
      "SELECT id FROM staff_proposals WHERE original_id=? AND status='proposed'",
      [row.id], c
    )).length) fail("PROPOSAL_EXISTS", "Withdraw the current suggestion before making another.");

    const option = await findOption({
      locationId: row.location_id, providerId: row.provider_id,
      typeId: row.type_id
    }, c);

    const selected = DateTime.fromISO(body.startsAt);
    const slots = await slotsFor(
      option, selected.setZone(config.zone).toISODate(), now, c
    );
    const slot = slots.find(s =>
      DateTime.fromISO(s.startsAt).toMillis() === selected.toMillis()
    );
    if (!slot) fail("SLOT_UNAVAILABLE", "Choose a currently available time.");

    const id = newId();

    await query(
      `INSERT INTO staff_proposals
        (id,original_id,starts_at,ends_at,original_version,
         status,version,created_by,created_at,updated_at)
       VALUES (?,?,?,?,?,'proposed',1,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
      [
        id, row.id, new Date(slot.startsAt), new Date(slot.endsAt),
        row.version, ctx.subject
      ], c
    );

    await note(c, ctx, row, body.staffReason);
    await audit(c, row.id, ctx.subject, "proposal.created", { proposalReference: id });
    await updateMail(c, row, `proposal:${id}:1`);

    return { message: "Suggestion saved. It does not reserve a slot or change the original appointment." };
  });

  add("post", "/proposals/:id/action", async (req, ctx, c) => {
    const id = reference.parse(req.params.id);
    const body = z.object({
      action: z.enum(["accept", "withdraw", "decline"]),
      expectedVersion: version, originalExpectedVersion: version,
      acceptanceConfirmed: z.literal(true).optional(),
      method: contactMethod.optional(),
      staffReason: reason
    }).strict().parse(req.body);

    const scope = scopeSQL(ctx, "decide");
    const [initial] = await query(
      `SELECT v.original_id FROM staff_proposals v
       JOIN appointment_requests r ON r.id=v.original_id
       WHERE v.id=? AND (${scope.sql})`,
      [id, ...scope.params], c
    );
    if (!initial) fail("NOT_FOUND", "Suggestion unavailable.", 404);

    const row = await scoped(initial.original_id, ctx, c, "decide", true);
    const [proposal] = await query(
      "SELECT * FROM staff_proposals WHERE id=? FOR UPDATE",
      [id], c
    );

    current(row, body.originalExpectedVersion);
    current(proposal, body.expectedVersion);
    if (proposal.status !== "proposed") fail("PROPOSAL_CHANGED", "This suggestion is closed.");

    let replacement = null;

    if (body.action === "accept") {
      if (!body.acceptanceConfirmed || !body.method) {
        fail("AGREEMENT_REQUIRED", "Record verified contact and explicit patient agreement.", 400);
      }
      if (!config.enabled) fail("BOOKING_UNAVAILABLE", "Appointment requests are unavailable.", 503);
      if (proposal.original_version !== row.version) {
        fail("ORIGINAL_CHANGED", "The original changed. Review and create a new suggestion.");
      }

      future(row, await databaseNow(c));
      const patientId = await owner(c, row.id);
      const contact = decrypt(row.contact_enc);

      // All changes share the existing ALS transaction.
      // Failure below restores the original and all related reservations.
      await cancelWithRelated(c, row, patientId, ctx.subject);

      const created = await createRequest({
        locationId: row.location_id, providerId: row.provider_id,
        typeId: row.type_id, startsAt: iso(proposal.starts_at),
        name: contact.name, email: contact.email, phone: contact.phone || "", reason: contact.reason || ""
      }, randomUUID());

      replacement = created.receipt.reference;
      const fresh = await scoped(replacement, ctx, c, "decide", true);

      if (
        fresh.status !== "pending" ||
        fresh.ends_at.getTime() !== proposal.ends_at.getTime()
      ) fail("PROPOSAL_CHANGED", "The appointment configuration changed.");

      if (patientId) await query(
        "INSERT INTO patient_request_links VALUES (?,?,UTC_TIMESTAMP(3))",
        [replacement, patientId], c
      );

      await query(
        `UPDATE appointment_requests
         SET status='approved',version=version+1 WHERE id=?`,
        [replacement], c
      );

      await audit(c, replacement, ctx.subject, "request.approved", {
        originalReference: row.id, method: body.method,
        agreementConfirmed: true, version: fresh.version + 1
      });
      await enqueueNotifications(c, replacement, "approved", contact.email);
    }

    const status = {
      accept: "accepted", withdraw: "withdrawn", decline: "declined"
    }[body.action];

    await query(
      `UPDATE staff_proposals SET
         status=?,version=version+1,replacement_id=?,
         accepted_by=?,acceptance_method=?,updated_at=UTC_TIMESTAMP(3)
       WHERE id=?`,
      [
        status, replacement,
        body.action === "accept" ? ctx.subject : null,
        body.action === "accept" ? body.method : null, id
      ], c
    );

    await note(c, ctx, row, body.staffReason);
    await audit(c, row.id, ctx.subject, "proposal." + status, {
      proposalReference: id,
      ...(replacement ? { replacementReference: replacement } : {})
    });
    await updateMail(c, row, `proposal:${id}:${proposal.version + 1}`);

    return { message: "Suggestion updated.", reference: replacement };
  });

  add("get", "/patients", async (req, ctx, c) => {
    const { q } = z.object({
      q: z.string().trim().min(1).max(254)
    }).strict().parse(req.query);

    const scope = scopeSQL(ctx, "patients");
    const byId = reference.safeParse(q).success;
    const value = byId ? q : digest(
      "patient-email:" + z.string().email().parse(q).toLowerCase()
    );

    const [account] = await query(
      `SELECT a.id,a.profile_enc FROM patient_accounts a
       WHERE a.${byId ? "id" : "email_hash"}=?
         AND a.disabled_at IS NULL
         AND a.email_verified_at IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM patient_request_links x
           JOIN appointment_requests r ON r.id=x.request_id
           WHERE x.patient_id=a.id AND (${scope.sql})
         ) LIMIT 1`,
      [value, ...scope.params], c
    );

    if (!account) return { items: [] };
    await patient(c, ctx, account.id);
    return { items: [await patientView(c, account)] };
  });

  add("get", "/patients/:id", async (req, ctx, c) => {
    const id = reference.parse(req.params.id);
    const { account } = await patient(c, ctx, id);
    const scope = scopeSQL(ctx, "patients");

    const rows = await query(
      `SELECT ${columns} ${joins}
       JOIN patient_request_links x ON x.request_id=r.id
       WHERE x.patient_id=? AND (${scope.sql})
       ORDER BY r.starts_at DESC,r.id DESC LIMIT 25`,
      [id, ...scope.params], c
    );

    return {
      patient: await patientView(c, account),
      appointments: rows.map(rowView),
      clinicTimeZone: config.zone
    };
  });

  add("get", "/patients/:id/medical", async (req, ctx, c) => {
    const id = reference.parse(req.params.id);
    await patient(c, ctx, id, "medical");

    const [stored] = await query(
      "SELECT details_enc FROM patient_details WHERE patient_id=?",
      [id], c
    );
    const data = stored ? decrypt(stored.details_enc) : {};
    const keys = [
      "dateOfBirth", "heightCm", "weightKg",
      "allergies", "medications", "conditions", "medicalHistory"
    ];

    return {
      details: Object.fromEntries(
        keys.filter(k => Object.hasOwn(data, k)).map(k => [k, data[k]])
      )
    };
  });

  add("post", "/guest-links", async (req, ctx, c) => {
    const body = z.object({
      requestReference: reference, patientReference: reference,
      identityVerificationConfirmed: z.literal(true),
      method: contactMethod
    }).strict().parse(req.body);

    // Read authorization before locking the patient account.
    await scoped(body.requestReference, ctx, c, "link");

    const [account] = await query(
      `SELECT id FROM patient_accounts
       WHERE id=? AND disabled_at IS NULL
         AND email_verified_at IS NOT NULL FOR UPDATE`,
      [body.patientReference], c
    );
    if (!account) fail("NOT_FOUND", "Verified identity unavailable.", 404);

    const row = await scoped(body.requestReference, ctx, c, "link", true);
    if (await owner(c, row.id)) fail("ALREADY_LINKED", "This request is already linked.");

    const code = randomBytes(32).toString("hex");
    const now = await databaseNow(c);

    await query(
      `UPDATE patient_guest_link_codes SET used_at=UTC_TIMESTAMP(3)
       WHERE request_id=? AND used_at IS NULL`,
      [row.id], c
    );

    await query(
      `INSERT INTO patient_guest_link_codes
        (id,request_id,patient_id,token_hash,expires_at,used_at,issued_by)
       VALUES (?,?,?,?,?,NULL,?)`,
      [
        newId(), row.id, account.id,
        digest("guest-link:" + code),
        now.plus({ minutes: authSettings.linkMinutes }).toJSDate(),
        ctx.subject
      ], c
    );

    await audit(c, row.id, ctx.subject, "request.link.authorized", {
      method: body.method, identityVerificationConfirmed: true
    });

    return { code, expiresInMinutes: authSettings.linkMinutes };
  });
}