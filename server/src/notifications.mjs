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
    "SELECT version FROM appointment_requests WHERE id=?",
    [requestId],
    connection
  );

  if (!request) {
    throw new Error("NOTIFICATION_REQUEST_UNAVAILABLE");
  }

  const recipients = [
    { type: "patient", email: patientEmail },
    ...(
      ["requested", "cancelled"].includes(event)
        ? [{ type: "admin", email: config.adminEmail }]
        : []
    )
  ];

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
          event,
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

function renderMessage(payload) {
  const portalUrl = config.origin + "/portal";
  const bookingUrl = config.origin + "/request-an-appointment";

  if (payload.recipient === "admin") {
    return {
      subject: "Appointment request update",
      text: [
        payload.event === "cancelled"
          ? "A cancellation update was recorded."
          : "An appointment request needs review.",
        "Reference: " + payload.reference,
        "Use the approved staff workspace for the current status and authorized details."
      ].join("\n\n")
    };
  }

  const messages = {
    requested:
      "Your appointment request was received. Staff approval is required. Sign in for its current status.",
    approved:
      "An approval update was recorded for your appointment request. Sign in to view its current status.",
    declined:
      "The practice could not approve this appointment request. Sign in to review any related original or replacement request.",
    cancelled:
      "A cancellation update was recorded. Sign in to review the current status of this appointment and any related request.",
    expired:
      "This earlier request expired under the previous reservation policy."
  };

  return {
    subject: "Appointment request update",
    text: [
      messages[payload.event] ||
        "Your appointment request has an update.",
      "Reference: " + payload.reference,
      "Patient portal: " + portalUrl,
      ...(payload.event === "declined"
        ? ["Request another available time: " + bookingUrl]
        : []),
      "Do not reply with medical details.",
      "If you are experiencing a medical emergency, call 911."
    ].join("\n\n")
  };
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

    const expectedStatus = {
      requested: "pending",
      approved: "approved",
      declined: "declined",
      cancelled: "cancelled",
      expired: "expired"
    }[payload.event];

    const superseded =
      !current ||
      (
        payload.version != null &&
        current.version !== payload.version
      ) ||
      (
        expectedStatus &&
        current.status !== expectedStatus
      );

    if (superseded) {
      await query(
        `UPDATE notification_outbox
         SET status='failed',
             last_error_code='SUPERSEDED_BY_UPDATE',
             locked_until=NULL,
             lease_token=NULL
         WHERE id=? AND lease_token=?`,
        [job.id, job.lease]
      );

      return { id: job.id, status: "superseded" };
    }

    const content = renderMessage(payload);

    await transport.sendMail({
      from: config.emailFrom,
      to: payload.to,
      subject: content.subject,
      text: content.text,
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