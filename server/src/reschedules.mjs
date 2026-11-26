import {
  audit,
  decrypt,
  pool,
  query,
  SafeError
} from "./db.mjs";

import { databaseNow } from "./scheduling.mjs";
import { enqueueNotifications } from "./notifications.mjs";

export async function getRescheduleContext(
  reference,
  connection = pool
) {
  const [incoming] = await query(
    `SELECT original_id, state
     FROM patient_reschedules
     WHERE replacement_id=?`,
    [reference],
    connection
  );

  const [pending] = await query(
    `SELECT replacement_id
     FROM patient_reschedules
     WHERE original_id=? AND state='pending'
     LIMIT 1`,
    [reference],
    connection
  );

  const [latest] = await query(
    `SELECT replacement_id, state
     FROM patient_reschedules
     WHERE original_id=?
     ORDER BY created_at DESC, replacement_id DESC
     LIMIT 1`,
    [reference],
    connection
  );

  return {
    originalReference: incoming?.original_id || null,
    replacementState: incoming?.state || null,
    pendingReplacementReference: pending?.replacement_id || null,
    latestReplacementReference:
      pending?.replacement_id || latest?.replacement_id || null,
    latestReplacementState:
      pending ? "pending" : latest?.state || null
  };
}

async function closeReservation(
  connection,
  row,
  status,
  actor
) {
  await query(
    `UPDATE appointment_requests
     SET status=?, expires_at=NULL, version=version+1
     WHERE id=?`,
    [status, row.id],
    connection
  );

  await audit(
    connection,
    row.id,
    actor,
    "request." + status,
    {
      from: row.status,
      to: status,
      version: row.version + 1
    }
  );

  await enqueueNotifications(
    connection,
    row.id,
    status,
    decrypt(row.contact_enc).email
  );
}

async function refreshOriginal(
  connection,
  originalId,
  replacementId,
  actor
) {
  const [original] = await query(
    "SELECT * FROM appointment_requests WHERE id=? FOR UPDATE",
    [originalId],
    connection
  );

  if (!original || !["pending", "approved"].includes(original.status)) {
    return;
  }

  await query(
    "UPDATE appointment_requests SET version=version+1 WHERE id=?",
    [original.id],
    connection
  );

  await audit(
    connection,
    original.id,
    actor,
    "request.reschedule.closed",
    { replacementReference: replacementId }
  );

  await enqueueNotifications(connection, original.id, "reschedule_closed", decrypt(original.contact_enc).email);

}

// The caller must already hold the provider row lock.
export async function cancelWithRelated(
  connection,
  row,
  patientId,
  actor
) {
  const relations = await query(
    `SELECT *
     FROM patient_reschedules
     WHERE state='pending'
       AND (original_id=? OR replacement_id=?)
     FOR UPDATE`,
    [row.id, row.id],
    connection
  );

  for (const relation of relations) {
    if (relation.patient_id !== patientId) {
      throw new SafeError(
        404,
        "NOT_FOUND",
        "The appointment is unavailable."
      );
    }

    if (relation.original_id === row.id) {
      const [replacement] = await query(
        `SELECT r.*
         FROM appointment_requests r
         JOIN patient_request_links o ON o.request_id=r.id
         WHERE r.id=? AND o.patient_id=?
         FOR UPDATE`,
        [relation.replacement_id, patientId],
        connection
      );

      if (replacement?.status === "pending") {
        await closeReservation(
          connection,
          replacement,
          "cancelled",
          actor
        );
      }

      await query(
        `UPDATE patient_reschedules
         SET state='cancelled'
         WHERE replacement_id=?`,
        [relation.replacement_id],
        connection
      );
    } else {
      // Withdrawing a replacement must not cancel the original.
      await query(
        `UPDATE patient_reschedules
         SET state='cancelled'
         WHERE replacement_id=?`,
        [row.id],
        connection
      );

      await refreshOriginal(
        connection,
        relation.original_id,
        row.id,
        actor
      );
    }
  }

  await closeReservation(
    connection,
    row,
    "cancelled",
    actor
  );
}

// Called inside the existing staff decision transaction,
// after updating the selected request's status.
// The provider lock must still be held.
export async function applyRescheduleDecision(
  connection,
  row,
  status,
  actor
) {
  const [incoming] = await query(
    `SELECT *
     FROM patient_reschedules
     WHERE replacement_id=? AND state='pending'
     FOR UPDATE`,
    [row.id],
    connection
  );

  if (incoming) {
    if (status === "approved") {
      const [original] = await query(
        "SELECT * FROM appointment_requests WHERE id=? FOR UPDATE",
        [incoming.original_id],
        connection
      );

      const now = await databaseNow(connection);

      if (
        !original ||
        !["pending", "approved"].includes(original.status) ||
        original.starts_at.getTime() <= now.toMillis()
      ) {
        throw new SafeError(
          409,
          "ORIGINAL_CHANGED",
          "The original appointment needs review before this replacement can be approved."
        );
      }

      await closeReservation(
        connection,
        original,
        "cancelled",
        actor
      );

      await query(
        `UPDATE patient_reschedules
         SET state='approved'
         WHERE replacement_id=?`,
        [row.id],
        connection
      );

      await audit(
        connection,
        original.id,
        actor,
        "request.replaced",
        { replacementReference: row.id }
      );
    } else if (["declined", "expired"].includes(status)) {
      await query(
        `UPDATE patient_reschedules
         SET state=?
         WHERE replacement_id=?`,
        [status, row.id],
        connection
      );

      await refreshOriginal(
        connection,
        incoming.original_id,
        row.id,
        actor
      );
    }
  }

  // Closing an unapproved original also closes its pending replacement.
  if (["declined", "expired"].includes(status)) {
    const [outgoing] = await query(
      `SELECT *
       FROM patient_reschedules
       WHERE original_id=? AND state='pending'
       FOR UPDATE`,
      [row.id],
      connection
    );

    if (outgoing) {
      const [replacement] = await query(
        "SELECT * FROM appointment_requests WHERE id=? FOR UPDATE",
        [outgoing.replacement_id],
        connection
      );

      if (replacement?.status === "pending") {
        await closeReservation(
          connection,
          replacement,
          status,
          actor
        );
      }

      await query(
        `UPDATE patient_reschedules
         SET state=?
         WHERE replacement_id=?`,
        [status, outgoing.replacement_id],
        connection
      );
    }
  }
}