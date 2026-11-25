import { emailContent, emailTime } from "../email-content.mjs";
import { config } from "../config.mjs";
import {
  decrypt, encrypt, newId, query, transaction
} from "../db.mjs";

export async function queueAccountMail(connection, to, kind, url = "") {
  await query(
    `INSERT INTO patient_mail_outbox
      (id, payload_enc, status, attempts, next_attempt_at)
     VALUES (?, ?, 'pending', 0, UTC_TIMESTAMP(3))`,
    [newId(), encrypt({ to, kind, url, occurredAt: new Date().toISOString() })], connection
  );
}

export function renderAccountMessage(payload) {
    const messages = {
      verify: ["Verify your patient account", "Thank you for registering. Use the single-use link below to verify your email before signing in. The link expires; if needed, request a new verification email.", "Verify email"],
      reset: ["Reset your patient password", "A password reset was requested for your patient account. Use the single-use link below before it expires. If you did not request this, ignore this email; your password has not changed.", "Reset password"],
      registered: ["Your patient account is ready", "Your account was created successfully. You can sign in to complete your profile and manage linked appointment requests."],
      verified: ["Email verified: your account is ready", "Your email was successfully verified. Sign in to complete your patient profile and access your linked appointments."],
      login: ["Patient account sign-in", "A successful sign-in to your patient account was recorded. If this was not you, reset your password and revoke other sessions in Account & security."],
      logout: ["Signed out of patient portal", "This patient portal session was signed out. Other active sessions remain available unless you sign out all sessions."],
      password_reset: ["Your password was reset", "Your patient account password was reset. Existing sessions were revoked. Sign in again using your new password. If unexpected, contact the practice immediately."],
      password_changed: ["Your password was changed", "Your patient account password was changed. Other sessions were revoked. If you did not make this change, use account recovery and contact the practice."],
      profile_updated: ["Patient profile updated", "Changes to your patient profile were saved. Review the saved information securely in your portal. Updating your profile does not change contact details on existing appointments."],
      google_linked: ["Google sign-in linked", "A Google identity was linked to your patient account. If unexpected, review Account & security and contact the practice."],
      google_unlinked: ["Google sign-in unlinked", "The linked Google identity was removed. Password sign-in remains available."],
      reauthenticated: ["Account identity confirmed", "Your linked Google identity was used to confirm a sensitive account action."],
      session_revoked: ["Patient session revoked", "A selected session was signed out from Account & security."],
      sessions_revoked: ["All patient sessions signed out", "All existing patient portal sessions were revoked, including the session used for this action. Sign in again when needed."],
      request_linked: ["Guest request linked to your account", "A verified guest appointment request was linked to your account. You can view its current status in the patient portal."],
      notice: ["Patient account access notice", "An account access request was received. If this was not you, review your account security or contact the practice."]
    };
    const [subject, message, label] = messages[payload.kind] || messages.notice;
    return emailContent(subject, [message, payload.occurredAt ? "Action recorded: " + emailTime(payload.occurredAt) : "", payload.url ? "Keep this access link private. Do not forward it. If it has expired, request a fresh link." : ""], {label: label || "Open patient portal",url:payload.url || config.origin+"/portal"});
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

    const content = renderAccountMessage(payload);
    await transport.sendMail({
      from: config.emailFrom, to: payload.to, ...content,
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