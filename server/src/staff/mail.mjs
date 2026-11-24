import { z } from "zod";
import { config } from "../config.mjs";
import {
  query, transaction, digest, encrypt, decrypt, newId
} from "../db.mjs";

const messageSchema = z.object({
  to: z.string().trim().email().max(254),
  subject: z.string().min(1).max(150)
    .refine(s => !/[\r\n]/.test(s)),
  text: z.string().min(1).max(12000)
}).strict();

export async function queue(c, key, message) {
  const payload = messageSchema.parse(message);

  await query(
    `INSERT INTO communications_outbox
      (id,dedup_key,payload_enc,status,attempts,
       next_attempt_at,created_at)
     VALUES (?,?,?,'pending',0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE dedup_key=dedup_key`,
    [
      newId(),
      digest("staff-message:" + key),
      encrypt(payload)
    ], c
  );
}

export async function deliverCommunication(transport) {
  const job = await transaction(async c => {
    const [row] = await query(
      `SELECT * FROM communications_outbox
       WHERE (status='pending' AND next_attempt_at<=UTC_TIMESTAMP(3))
          OR (status='processing' AND locked_until<UTC_TIMESTAMP(3))
       ORDER BY next_attempt_at,id
       LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [], c
    );

    if (!row) return null;

    if (row.attempts >= config.emailAttempts) {
      await query(
        `UPDATE communications_outbox
         SET status='failed',last_error_code='ATTEMPTS_EXHAUSTED',
             locked_until=NULL,lease_token=NULL WHERE id=?`,
        [row.id], c
      );
      return null;
    }

    const lease = newId();

    await query(
      `UPDATE communications_outbox
       SET status='processing',attempts=attempts+1,
           lease_token=?,
           locked_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 120 SECOND)
       WHERE id=?`,
      [lease, row.id], c
    );

    return { ...row, lease, attempts: row.attempts + 1 };
  });

  if (!job) return null;

  try {
    const payload = messageSchema.parse(decrypt(job.payload_enc));

    await transport.sendMail({
      from: config.emailFrom,
      ...payload,
      messageId: `<staff.${job.id}@${config.messageDomain}>`
    });

    await query(
      `UPDATE communications_outbox
       SET status='sent',sent_at=UTC_TIMESTAMP(3),
           locked_until=NULL,lease_token=NULL,last_error_code=NULL
       WHERE id=? AND lease_token=?`,
      [job.id, job.lease]
    );

    return { id: job.id, status: "sent" };
  } catch {
    const failed = job.attempts >= config.emailAttempts;
    const seconds = Math.min(3600, 15 * 2 ** job.attempts);

    await query(
      `UPDATE communications_outbox
       SET status=?,
           next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND),
           locked_until=NULL,lease_token=NULL,
           last_error_code='DELIVERY_FAILED'
       WHERE id=? AND lease_token=?`,
      [
        failed ? "failed" : "pending",
        seconds, job.id, job.lease
      ]
    );

    return { id: job.id, status: failed ? "failed" : "pending" };
  }
}