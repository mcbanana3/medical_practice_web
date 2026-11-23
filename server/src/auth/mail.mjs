import { config } from "../config.mjs";
import {
  decrypt, encrypt, newId, query, transaction
} from "../db.mjs";

export async function queueAccountMail(connection, to, kind, url = "") {
  await query(
    `INSERT INTO patient_mail_outbox
      (id, payload_enc, status, attempts, next_attempt_at)
     VALUES (?, ?, 'pending', 0, UTC_TIMESTAMP(3))`,
    [newId(), encrypt({ to, kind, url })], connection
  );
}

export async function deliverAccountMail(transport) {
  const job = await transaction(async (connection) => {
    const [row] = await query(
      `SELECT * FROM patient_mail_outbox
       WHERE (status='pending' AND next_attempt_at<=UTC_TIMESTAMP(3))
          OR (status='processing' AND locked_until<UTC_TIMESTAMP(3))
       ORDER BY next_attempt_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [], connection
    );

    if (!row) return null;

    if (row.attempts >= config.emailAttempts) {
      await query(
        `UPDATE patient_mail_outbox SET status='failed',
         last_error_code='DELIVERY_OUTCOME_UNKNOWN',
         locked_until=NULL, lease_token=NULL WHERE id=?`,
        [row.id], connection
      );
      return null;
    }

    const lease = newId();

    await query(
      `UPDATE patient_mail_outbox SET status='processing',
       attempts=attempts+1, lease_token=?,
       locked_until=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 120 SECOND)
       WHERE id=?`,
      [lease, row.id], connection
    );

    return { ...row, lease, attempts: row.attempts + 1 };
  });

  if (!job) return null;

  try {
    const payload = decrypt(job.payload_enc);

    const instruction = payload.kind === "verify"
      ? "If you requested an account, verify your email using this link."
      : payload.kind === "reset"
        ? "If you requested account recovery, use this single-use link."
        : "An account security action occurred. If unexpected, use the verified account-support route.";

    await transport.sendMail({
      from: config.emailFrom,
      to: payload.to,
      subject: "Account access",
      text: [
        instruction,
        payload.url,
        "Do not forward access links or send medical information in reply."
      ].filter(Boolean).join("\n\n"),
      messageId: `<account-${job.id}@${config.messageDomain}>`
    });

    await query(
      `UPDATE patient_mail_outbox SET status='sent',
       sent_at=UTC_TIMESTAMP(3), locked_until=NULL, lease_token=NULL
       WHERE id=? AND lease_token=?`,
      [job.id, job.lease]
    );

    return { id: job.id, status: "sent" };
  } catch {
    const status = job.attempts >= config.emailAttempts ? "failed" : "pending";

    await query(
      `UPDATE patient_mail_outbox SET status=?,
       next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND),
       locked_until=NULL, lease_token=NULL,
       last_error_code='EMAIL_DELIVERY_FAILED'
       WHERE id=? AND lease_token=?`,
      [status, Math.min(3600, 15 * 2 ** job.attempts), job.id, job.lease]
    );

    return { id: job.id, status };
  }
}