import { emailContent, emailTime } from "./email-content.mjs";
import nodemailer from "nodemailer";
import { config } from "./config.mjs";

import {
  decrypt,
  encrypt,
  newId,
  query,
  transaction
} from "./db.mjs";

export async function enqueueNotifications(
  connection,
  requestId,
  event,
  patientEmail
) {
  const [request] = await query(
    `SELECT r.version,r.starts_at,r.ends_at,l.name AS location,p.name AS provider
     FROM appointment_requests r JOIN locations l ON l.id=r.location_id JOIN providers p ON p.id=r.provider_id WHERE r.id=?`,
    [requestId],
    connection
  );

  if (!request) {
    throw new Error("NOTIFICATION_REQUEST_UNAVAILABLE");
  }

  const [replacement] = await query("SELECT original_id FROM patient_reschedules WHERE replacement_id=?", [requestId], connection);
  const notificationEvent = replacement && ["requested","approved","declined","cancelled"].includes(event) ? "reschedule_" + event : event;
  const recipients = [{ type: "patient", email: patientEmail }, { type: "admin", email: config.adminEmail }];

  const eventKey = `${event}:v${request.version}`;

  for (const recipient of recipients) {
    await query(
      `INSERT INTO notification_outbox
        (
          id, request_id, event_type,
          recipient_type, payload_enc,
          status, attempts, next_attempt_at
        )
       VALUES (?, ?, ?, ?, ?, 'pending', 0, UTC_TIMESTAMP(3))`,
      [
        newId(),
        requestId,
        eventKey,
        recipient.type,
        encrypt({
          to: recipient.email,
          reference: requestId,
          event: notificationEvent,
          startsAt: request.starts_at.toISOString(),
          endsAt: request.ends_at.toISOString(),
          location: request.location,
          provider: request.provider,
          occurredAt: new Date().toISOString(),
          originalReference: replacement?.original_id || null,
          version: request.version,
          recipient: recipient.type
        })
      ],
      connection
    );
  }
}

export function createMailTransport() {
  const url = new URL(config.smtpUrl);

  if (!["smtp:", "smtps:"].includes(url.protocol)) {
    throw new Error("SMTP_URL must use smtp:// or smtps://");
  }

  return nodemailer.createTransport({
    host: url.hostname,
    port: Number(
      url.port || (url.protocol === "smtps:" ? 465 : 587)
    ),
    secure: url.protocol === "smtps:",
    requireTLS:
      config.production && url.protocol !== "smtps:",
    auth: url.username
      ? {
          user: decodeURIComponent(url.username),
          pass: decodeURIComponent(url.password)
        }
      : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    tls: { rejectUnauthorized: true }
  });
}

export function renderMessage(payload, currentStatus) {
  const messages = {
    requested: ["Appointment request received", "Your request was received. It was pending staff approval at submission; this email is not an appointment confirmation."],
    approved: ["Appointment approved", "Staff approved your appointment at the time of this update."],
    declined: ["Appointment request declined", "The practice could not approve this request. Its reserved time has been released. You may request another available time."],
    cancelled: ["Appointment cancelled", "This appointment or request was cancelled and its reserved time was released. Any pending replacement linked to an original appointment was also cancelled."],
    completed: ["Appointment marked completed", "The practice recorded this appointment as completed."],
    no_show: ["Appointment attendance updated", "The practice recorded a missed appointment. If this is incorrect, please contact the practice."],
    reschedule_requested: ["Reschedule request received", "Your requested replacement time is pending staff approval. Your original appointment remains reserved until the replacement is approved."],
    reschedule_approved: ["Reschedule approved", "Staff approved your replacement appointment. The original appointment was cancelled as part of this change."],
    reschedule_declined: ["Reschedule request declined", "The replacement request was declined. Its time was released. Check your original appointment's current status in the portal or contact the practice."],
    reschedule_cancelled: ["Reschedule request cancelled", "The replacement request was cancelled and its time was released. Cancelling only a replacement leaves the original unchanged; cancelling the original also cancels its pending replacement."],
    reschedule_closed: ["Reschedule closed: original retained", "A replacement request was closed. Your original appointment remains active with its existing status."],
    expired: ["Appointment request expired", "This request expired under the previous reservation policy."]
  };
  const [subject, message] = messages[payload.event] || ["Appointment update", "An appointment record was updated."];
  const admin = payload.recipient === "admin";
  return emailContent(admin ? "Practice notification: " + subject : subject, [
    admin ? "An appointment action was recorded. Review the authorized staff workspace for patient contact details and any required follow-up." : message,
    payload.occurredAt ? "Action recorded: " + emailTime(payload.occurredAt) : "",
    "Request reference: " + payload.reference,
    payload.originalReference ? "Original request reference: " + payload.originalReference : "",
    payload.startsAt ? "Appointment starts: " + emailTime(payload.startsAt) : "",
    payload.endsAt ? "Appointment ends: " + emailTime(payload.endsAt) : "",
    payload.provider ? "Provider: " + payload.provider : "",
    payload.location ? "Location: " + payload.location : "",
    currentStatus ? "Status when this email was prepared: " + currentStatus.replaceAll("_", " ") + "." : "",
    "This email records an action. Later changes may have occurred; check the current status before travelling.",
    !admin ? "Guests can call the practice for status updates. Creating an account does not automatically link a guest request." : ""
  ], {label:admin ? "Open staff workspace" : "Open patient portal",url:config.origin+(admin ? "/staff" : "/portal")});
}

export async function deliverOne(transport) {
  const job = await transaction(async (connection) => {
    const [row] = await query(
      `SELECT *
       FROM notification_outbox
       WHERE
         (status='pending' AND next_attempt_at<=UTC_TIMESTAMP(3))
         OR
         (status='processing' AND locked_until<UTC_TIMESTAMP(3))
       ORDER BY next_attempt_at, id
       LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [],
      connection
    );

    if (!row) return null;

    if (row.attempts >= config.emailAttempts) {
      await query(
        `UPDATE notification_outbox
         SET status='failed',
             last_error_code='DELIVERY_OUTCOME_UNKNOWN',
             locked_until=NULL,
             lease_token=NULL
         WHERE id=?`,
        [row.id],
        connection
      );

      return null;
    }

    const lease = newId();

    await query(
      `UPDATE notification_outbox
       SET status='processing',
           attempts=attempts+1,
           lease_token=?,
           locked_until=DATE_ADD(
             UTC_TIMESTAMP(3), INTERVAL 120 SECOND
           )
       WHERE id=?`,
      [lease, row.id],
      connection
    );

    return {
      ...row,
      attempts: row.attempts + 1,
      lease
    };
  });

  if (!job) return null;

  try {
    const payload = decrypt(job.payload_enc);

    const [current] = await query(
      "SELECT version, status FROM appointment_requests WHERE id=?",
      [job.request_id]
    );

    if (!current) throw new Error("REQUEST_UNAVAILABLE");

    const content = renderMessage(payload, current.status);

    await transport.sendMail({
      from: config.emailFrom,
      to: payload.to,
      subject: content.subject,
      text: content.text,
      html: content.html,
      messageId: `<${job.id}@${config.messageDomain}>`
    });

    await query(
      `UPDATE notification_outbox
       SET status='sent',
           sent_at=UTC_TIMESTAMP(3),
           locked_until=NULL,
           lease_token=NULL,
           last_error_code=NULL
       WHERE id=? AND lease_token=?`,
      [job.id, job.lease]
    );

    return { id: job.id, status: "sent" };
  } catch {
    const failed = job.attempts >= config.emailAttempts;
    const delay = Math.min(
      3600,
      15 * (2 ** job.attempts)
    );

    await query(
      `UPDATE notification_outbox
       SET status=?,
           next_attempt_at=DATE_ADD(
             UTC_TIMESTAMP(3), INTERVAL ? SECOND
           ),
           locked_until=NULL,
           lease_token=NULL,
           last_error_code='EMAIL_DELIVERY_FAILED'
       WHERE id=? AND lease_token=?`,
      [
        failed ? "failed" : "pending",
        delay,
        job.id,
        job.lease
      ]
    );

    return {
      id: job.id,
      status: failed ? "failed" : "pending"
    };
  }
}