import { DateTime } from "luxon";
import { config } from "./config.mjs";

import {
  applyRescheduleDecision,
  getRescheduleContext
} from "./reschedules.mjs";

import {
  audit,
  decrypt,
  digest,
  encrypt,
  newId,
  pool,
  query,
  SafeError,
  transaction
} from "./db.mjs";

import {
  databaseNow,
  findOption,
  slotsFor
} from "./scheduling.mjs";

import { enqueueNotifications } from "./notifications.mjs";

function savedReceipt(row) {
  return typeof row.receipt_json === "string"
    ? JSON.parse(row.receipt_json)
    : row.receipt_json;
}

function replay(row, payloadHash) {
  if (row.payload_hash !== payloadHash) {
    throw new SafeError(
      409,
      "IDEMPOTENCY_MISMATCH",
      "This submission key was already used. Check the original submission outcome."
    );
  }

  return {
    receipt: savedReceipt(row),
    replayed: true
  };
}

export async function createRequest(input, key) {
  const payloadHash = digest(JSON.stringify(input));

  const [existing] = await query(
    "SELECT * FROM appointment_requests WHERE idempotency_key=?",
    [key]
  );

  if (existing) {
    return replay(existing, payloadHash);
  }

  try {
    return await transaction(async (connection) => {
      // Every writer must lock this same provider row before
      // inspecting or modifying appointment reservations.
      const [provider] = await query(
        "SELECT id FROM providers WHERE id=? FOR UPDATE",
        [input.providerId],
        connection
      );

      if (!provider) {
        throw new SafeError(
          404,
          "OPTION_UNAVAILABLE",
          "That appointment option is unavailable."
        );
      }

      // A concurrent submission may have committed while we waited.
      const [duplicate] = await query(
        "SELECT * FROM appointment_requests WHERE idempotency_key=?",
        [key],
        connection
      );

      if (duplicate) {
        return replay(duplicate, payloadHash);
      }

      const option = await findOption(input, connection);
      const now = await databaseNow(connection);

      const selected = DateTime.fromISO(input.startsAt, {
        zone: "utc"
      });

      if (!selected.isValid) {
        throw new SafeError(
          400,
          "INVALID_APPOINTMENT_TIME",
          "Choose a valid appointment time."
        );
      }

      const startsAt = selected.toUTC();
      const endsAt = startsAt.plus({
        minutes: option.durationMinutes
      });

      // Authoritative overlap check.
      // This is independent of what the frontend previously displayed.
      const conflicts = await query(
        `SELECT id
         FROM appointment_requests
         WHERE provider_id=?
           AND starts_at < ?
           AND ends_at > ?
           AND status IN ('pending', 'approved')
         LIMIT 1 FOR UPDATE`,
        [
          option.providerId,
          endsAt.toJSDate(),
          startsAt.toJSDate()
        ],
        connection
      );

      if (conflicts.length) {
        throw new SafeError(
          409,
          "SLOT_UNAVAILABLE",
          "That time has already been requested or confirmed. Please choose another available time."
        );
      }

      // Also validate the current schedule, exceptions, lead time,
      // booking horizon, and appointment type.
      const localDate = startsAt
        .setZone(config.zone)
        .toISODate();

      const slots = await slotsFor(
        option,
        localDate,
        now,
        connection
      );

      const slot = slots.find((item) =>
        DateTime.fromISO(item.startsAt).toMillis() ===
        startsAt.toMillis()
      );

      if (!slot) {
        throw new SafeError(
          409,
          "SLOT_UNAVAILABLE",
          "That time is no longer available. Choose from current availability."
        );
      }

      const reference = newId();

      const receipt = {
        reference,
        submissionStatus: "pending",
        clinicTimeZone: config.zone,
        reservationExpiresAt: null,
        supportContact: config.support
      };

      await query(
        `INSERT INTO appointment_requests
          (
            id,
            idempotency_key,
            payload_hash,
            location_id,
            provider_id,
            type_id,
            starts_at,
            ends_at,
            contact_enc,
            status,
            expires_at,
            version,
            receipt_json,
            created_at
          )
         VALUES (
           ?, ?, ?, ?, ?, ?, ?, ?, ?,
           'pending',
           NULL,
           1,
           ?,
           UTC_TIMESTAMP(3)
         )`,
        [
          reference,
          key,
          payloadHash,
          input.locationId,
          input.providerId,
          input.typeId,
          new Date(slot.startsAt),
          new Date(slot.endsAt),
          encrypt({
            name: input.name,
            email: input.email,
            phone: input.phone || "",
            reason: input.reason || ""
          }),
          JSON.stringify(receipt)
        ],
        connection
      );

      await audit(
        connection,
        reference,
        "guest",
        "request.created",
        {
          status: "pending",
          version: 1,
          reservationPolicy: "until_staff_decision"
        }
      );

      // Patient acknowledgement and doctor notification.
      // Both queue entries commit with the request.
      await enqueueNotifications(
        connection,
        reference,
        "requested",
        input.email
      );

      return {
        receipt,
        replayed: false
      };
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      const [row] = await query(
        "SELECT * FROM appointment_requests WHERE idempotency_key=?",
        [key]
      );

      if (row) {
        return replay(row, payloadHash);
      }
    }

    throw error;
  }
}

export async function lookupSubmissionReceipt(key) {
  const [row] = await query(
    "SELECT receipt_json FROM appointment_requests WHERE idempotency_key=?",
    [key]
  );

  if (!row) {
    throw new SafeError(
      404,
      "OUTCOME_NOT_VERIFIED",
      "The submission outcome could not be verified. Try again or use verified support. Do not assume the request was lost."
    );
  }

  return savedReceipt(row);
}

async function scopedRequest(
  reference,
  subject,
  connection = pool,
  decide = false
) {
  const decisionRestriction = decide
    ? "AND s.can_decide=1"
    : "";

  const [row] = await query(
    `SELECT r.*
     FROM appointment_requests r
     JOIN staff_scopes s
       ON s.location_id=r.location_id
      AND s.provider_id=r.provider_id
     WHERE r.id=?
       AND s.subject=?
       AND s.revoked_at IS NULL
       ${decisionRestriction}
     LIMIT 1`,
    [reference, subject],
    connection
  );

  if (!row) {
    throw new SafeError(
      404,
      "NOT_FOUND",
      "The requested resource is unavailable."
    );
  }

  return row;
}

export async function readStaffRequest(reference, subject) {
  const row = await scopedRequest(reference, subject);

  await audit(
    pool,
    reference,
    subject,
    "request.viewed"
  );

  const notifications = await query(
    `SELECT status, COUNT(*) AS count
     FROM notification_outbox
     WHERE request_id=?
     GROUP BY status`,
    [reference]
  );

  return {
    reference: row.id,
    status: row.status,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    clinicTimeZone: config.zone,
    version: row.version,
    contact: decrypt(row.contact_enc),
    reschedule: await getRescheduleContext(reference),
    notifications
  };
}

export async function decideRequest(
  reference,
  subject,
  action,
  expectedVersion
) {
  if (!["approve", "decline"].includes(action)) {
    throw new SafeError(
      400,
      "INVALID_ACTION",
      "Choose a permitted appointment action."
    );
  }

  const initial = await scopedRequest(
    reference,
    subject,
    pool,
    true
  );

  return transaction(async (connection) => {
    await query(
      "SELECT id FROM providers WHERE id=? FOR UPDATE",
      [initial.provider_id],
      connection
    );

    const row = await scopedRequest(
      reference,
      subject,
      connection,
      true
    );

    const now = await databaseNow(connection);

    if (
      row.version !== expectedVersion ||
      row.status !== "pending"
    ) {
      throw new SafeError(
        409,
        "REQUEST_CHANGED",
        "The request changed. Reload before acting."
      );
    }

    if (action === "approve") {
      const occupied = await query(
        `SELECT id
         FROM appointment_requests
         WHERE provider_id=?
           AND id<>?
           AND starts_at < ?
           AND ends_at > ?
           AND status IN ('pending', 'approved')
         LIMIT 1 FOR UPDATE`,
        [
          row.provider_id,
          row.id,
          row.ends_at,
          row.starts_at
        ],
        connection
      );

      if (
        occupied.length ||
        row.starts_at.getTime() <= now.toMillis()
      ) {
        throw new SafeError(
          409,
          "SLOT_UNAVAILABLE",
          "The appointment cannot be approved at that time."
        );
      }
    }

    const status = action === "approve"
      ? "approved"
      : "declined";

    await query(
      `UPDATE appointment_requests
       SET status=?,
           expires_at=NULL,
           version=version+1
       WHERE id=?`,
      [status, reference],
      connection
    );

    await applyRescheduleDecision(
      connection,
      row,
      status,
      subject
    );

    await audit(
      connection,
      reference,
      subject,
      "request." + status,
      {
        from: "pending",
        to: status,
        version: row.version + 1
      }
    );

    const contact = decrypt(row.contact_enc);

    await enqueueNotifications(
      connection,
      reference,
      status,
      contact.email
    );

    return {
      reference,
      status,
      version: row.version + 1
    };
  });
}

// The provider lock serializes automatic expiry with approvals and rescheduling.
export async function expireHolds() {
  const candidates = await query(
    "SELECT id,provider_id FROM appointment_requests WHERE status='pending' AND starts_at<=UTC_TIMESTAMP(3) ORDER BY starts_at,id LIMIT 100"
  );
  let expired = 0;
  for (const candidate of candidates) {
    expired += await transaction(async connection => {
      await query("SELECT id FROM providers WHERE id=? FOR UPDATE", [candidate.provider_id], connection);
      const [row] = await query("SELECT * FROM appointment_requests WHERE id=? FOR UPDATE", [candidate.id], connection);
      const now = await databaseNow(connection);
      if (!row || row.status !== "pending" || row.starts_at.getTime() > now.toMillis()) return 0;
      await query("UPDATE appointment_requests SET status='expired',expires_at=NULL,version=version+1 WHERE id=?", [row.id], connection);
      await applyRescheduleDecision(connection, row, "expired", "system:appointment-expiry");
      await audit(connection, row.id, "system:appointment-expiry", "request.expired", {from:"pending",to:"expired",version:row.version+1});
      await enqueueNotifications(connection, row.id, "expired", decrypt(row.contact_enc).email);
      return 1;
    });
  }
  await query("DELETE FROM rate_buckets WHERE expires_at < UTC_TIMESTAMP(3)");
  return expired;
}
