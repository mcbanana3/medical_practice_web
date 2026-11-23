import { config } from "../src/config.mjs";
import { pool, query } from "../src/db.mjs";
import { createMailTransport } from "../src/notifications.mjs";

const transport = createMailTransport();

try {
  const url = new URL(config.smtpUrl);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);

  console.log(local
    ? "SMTP points to a LOCAL inbox. It will not deliver to the doctor's real inbox."
    : "SMTP points to an external provider.");

  console.log(config.adminEmail.endsWith(".test")
    ? "Doctor recipient is still a development address."
    : "A non-development doctor recipient is configured.");

  await transport.verify();
  console.log("SMTP connection/authentication check passed.");

  const counts = await query(
    "SELECT status, COUNT(*) AS total FROM notification_outbox GROUP BY status"
  );

  console.table(counts);

  if (process.argv.includes("--send")) {
    const result = await transport.sendMail({
      from: config.emailFrom,
      to: config.adminEmail,
      subject: "Email configuration check",
      text:
        "This is an email configuration check for the Harika Thummala MD website. " +
        "It is not an appointment request."
    });

    if (Array.isArray(result.accepted) && !result.accepted.length) {
      throw new Error("Recipient was not accepted");
    }

    console.log("Test message accepted by SMTP. Check the configured inbox.");
  }
} catch {
  console.error(
    "Email check failed. Verify SMTP_URL, sender authorization, credentials, " +
    "network access, and ADMIN_NOTIFICATION_EMAIL."
  );
  process.exitCode = 1;
} finally {
  transport.close();
  await pool.end();
}  