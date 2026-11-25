import {
  after, before, beforeEach, test
} from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";

import { config } from "../src/config.mjs";
import { pool, query, decrypt } from "../src/db.mjs";
import { createApp } from "../src/app.mjs";
import { expandWindow } from "../src/scheduling.mjs";
import { verifyCaptcha } from "../src/security.mjs";
import { deliverOne } from "../src/notifications.mjs";
import { expireHolds } from "../src/requests.mjs";

let server;
let base;

const testDependencies = {
  captchaVerifier: async () => {},
  staffVerifier: async () => ({
    sub: "development-test-staff",
    scope: "appointments:read appointments:decide"
  })
};

before(async () => {
  if (
    config.environment !== "test" ||
    !config.db.database.endsWith("_test") ||
    !config.fixtures
  ) {
    throw new Error("Tests require NODE_ENV=test, DEV_FIXTURES=true and a _test DB");
  }

  server = createApp(testDependencies).listen(0);
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(async () => {
  for (const table of [
    "notification_outbox",
    "audit_events",
    "appointment_requests",
    "schedule_exceptions",
    "rate_buckets",
    "staff_scopes"
  ]) {
    await query(`DELETE FROM ${table}`);
  }
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await pool.end();
});

async function get(path, origin = base) {
  const response = await fetch(`${origin}${path}`);
  return { status: response.status, body: await response.json() };
}

async function post(path, body, key = randomUUID(), origin = base) {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      Origin: config.origin,
      "Content-Type": "application/json",
      "Idempotency-Key": key
    },
    body: JSON.stringify(body)
  });

  return { status: response.status, body: await response.json() };
}

async function available(typeId = 1) {
  const metadata = (await get("/api/booking/options")).body;
  const option = metadata.options.find((item) => item.typeId === typeId);

  assert.ok(option, "Run the development seed against the test database");

  const date = metadata.dateChoices.find(value => ![0,6].includes(new Date(value + "T12:00:00Z").getUTCDay()) && value > metadata.minDate);
  const parameters = new URLSearchParams({
    locationId: String(option.locationId),
    providerId: String(option.providerId),
    typeId: String(typeId),
    date
  });

  const result = await get(`/api/booking/availability?${parameters}`);

  assert.equal(result.status, 200);
  assert.ok(result.body.slots.length > 1);

  return { option, date, slots: result.body.slots };
}

function inputFor(option, slot) {
  return {
    locationId: option.locationId,
    providerId: option.providerId,
    typeId: option.typeId,
    startsAt: slot.startsAt,
    name: "Development Test Guest",
    email: "guest@example.test",
    phone: "4323370555", reason: "Annual checkup",
    captchaToken: "test-process-injected-verification"
  };
}

test("migrations are recorded and development configuration is explicit", async () => {
  const migrations = await query("SELECT version FROM schema_migrations");
  assert.ok(migrations.some((row) => row.version === "001_booking.sql"));

  const result = await get("/api/booking/options");
  assert.equal(result.body.fixtureData, false);
  assert.equal(result.body.clinicTimeZone, config.zone);
});

test("clinic-wide closure removes availability", async () => {
  const data = await available();

  await query(
    `INSERT INTO schedule_exceptions
      (location_id, provider_id, local_date, closed)
     VALUES (NULL, NULL, ?, 1)`,
    [data.date]
  );

  const parameters = new URLSearchParams({
    locationId: "1", providerId: "1", typeId: "1", date: data.date
  });

  const result = await get(`/api/booking/availability?${parameters}`);
  assert.deepEqual(result.body.slots, []);
});

test("simultaneous overlapping durations cannot both reserve the provider", async () => {
  const short = await available(1);
  const long = await available(1);

  const results = await Promise.all([
    post("/api/booking/requests", inputFor(short.option, short.slots[0])),
    post("/api/booking/requests", inputFor(long.option, long.slots[0]))
  ]);

  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);

  const [count] = await query("SELECT COUNT(*) AS total FROM appointment_requests");
  assert.equal(Number(count.total), 1);
});

test("same submission key creates one request and one notification pair", async () => {
  const data = await available();
  const body = inputFor(data.option, data.slots[0]);
  const key = randomUUID();

  const results = await Promise.all([
    post("/api/booking/requests", body, key),
    post("/api/booking/requests", body, key)
  ]);

  assert.deepEqual(results.map((result) => result.status).sort(), [200, 201]);

  const [requests] = await query("SELECT COUNT(*) AS total FROM appointment_requests");
  const [jobs] = await query("SELECT COUNT(*) AS total FROM notification_outbox");

  assert.equal(Number(requests.total), 1);
  assert.equal(Number(jobs.total), 2);
});

test("submission is pending, contact is encrypted, and receipt excludes contact", async () => {
  const data = await available();
  const key = randomUUID();

  const result = await post(
    "/api/booking/requests",
    inputFor(data.option, data.slots[0]),
    key
  );

  assert.equal(result.status, 201);
  assert.equal(result.body.receipt.submissionStatus, "pending");

  const [row] = await query("SELECT * FROM appointment_requests");
  assert.equal(row.status, "pending");
  assert.ok(!row.contact_enc.includes("guest@example.test"));
  assert.equal(decrypt(row.contact_enc).email, "guest@example.test");

  const receipt = await post("/api/booking/receipt", {
    idempotencyKey: key,
    captchaToken: "test"
  });

  assert.equal(receipt.status, 200);
  assert.ok(!JSON.stringify(receipt.body).includes("guest@example.test"));
  assert.ok(!JSON.stringify(receipt.body).includes("Development Test Guest"));
});

test("validation rejects additional medical narrative fields", async () => {
  const data = await available();

  const result = await post("/api/booking/requests", {
    ...inputFor(data.option, data.slots[0]),
    symptoms: "This field is not permitted"
  });

  assert.equal(result.status, 400);

  const [count] = await query("SELECT COUNT(*) AS total FROM appointment_requests");
  assert.equal(Number(count.total), 0);
});

test("email failure preserves the request and retries the job", async () => {
  const data = await available();
  await post("/api/booking/requests", inputFor(data.option, data.slots[0]));

  const failed = await deliverOne({
    sendMail: async () => { throw new Error("simulated SMTP failure"); }
  });

  assert.equal(failed.status, "pending");

  await query(
    `UPDATE notification_outbox
     SET next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 HOUR)
     WHERE id<>?`,
    [failed.id]
  );

  await query(
    `UPDATE notification_outbox
     SET next_attempt_at=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND)
     WHERE id=?`,
    [failed.id]
  );

  let delivered;

  const retried = await deliverOne({
    sendMail: async (mail) => { delivered = mail; }
  });

  assert.equal(retried.id, failed.id);
  assert.equal(retried.status, "sent");
  assert.ok(!delivered.text.includes("Development Test Guest"));
  assert.ok(!delivered.text.includes(data.slots[0].startsAt));

  const [request] = await query("SELECT status FROM appointment_requests");
  assert.equal(request.status, "pending");
});

test("pending reservations remain blocked until staff decides", async () => {
  const data = await available();
  await post("/api/booking/requests", inputFor(data.option, data.slots[0]));

  await query(
    `UPDATE appointment_requests
     SET expires_at=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND)`
  );

  await expireHolds();

  const [row] = await query("SELECT status FROM appointment_requests");
  assert.equal(row.status, "pending");

  const audit = await query(
    "SELECT event FROM audit_events WHERE event='request.expired'"
  );

  assert.equal(audit.length, 0);
});

test("staff cannot act without a matching database scope", async () => {
  const data = await available();
  const created = await post(
    "/api/booking/requests", inputFor(data.option, data.slots[0])
  );

  const reference = created.body.receipt.reference;
  const path = `/api/staff/requests/${reference}/actions`;

  const denied = await post(path, { action: "approve", expectedVersion: 1 });
  assert.equal(denied.status, 404);

  await query(
    `INSERT INTO staff_scopes
      (subject, location_id, provider_id, can_decide)
     VALUES ('development-test-staff', 1, 1, 1)`
  );

  const approved = await post(path, { action: "approve", expectedVersion: 1 });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.status, "approved");

  const stale = await post(path, { action: "decline", expectedVersion: 1 });
  assert.equal(stale.status, 409);

  const audit = await query(
    "SELECT event FROM audit_events WHERE event='request.approved'"
  );
  assert.equal(audit.length, 1);
});

test("rate limit is shared by two application instances", async () => {
  const second = createApp(testDependencies).listen(0);
  await once(second, "listening");
  const otherBase = `http://127.0.0.1:${second.address().port}`;

  try {
    let last;

    for (let index = 0; index <= config.rateLimit; index += 1) {
      last = await post(
        "/api/booking/requests",
        {},
        randomUUID(),
        index % 2 ? otherBase : base
      );
    }

    assert.equal(last.status, 429);
  } finally {
    await new Promise((resolve) => second.close(resolve));
  }
});

test("reCAPTCHA checks hostname and rejects stale tokens", async () => {
  const response = (hostname, challenge) => async () => ({
    ok: true,
    json: async () => ({
      success: true,
      hostname,
      challenge_ts: challenge
    })
  });

  await verifyCaptcha(
    "test",
    response(config.captchaHosts[0], new Date().toISOString())
  );

  await assert.rejects(
    verifyCaptcha(
      "test",
      response("not-an-approved-host.invalid", new Date().toISOString())
    ),
    (error) => error.code === "SECURITY_CHECK_FAILED"
  );

  await assert.rejects(
    verifyCaptcha(
      "test",
      response(config.captchaHosts[0], new Date(Date.now() - 300000).toISOString())
    ),
    (error) => error.code === "SECURITY_CHECK_FAILED"
  );
});

test("DST overlap exposes both offsets and spring gap skips nonexistent times", () => {
  const fall = expandWindow(
    "2026-11-01", "01:00", "03:00", 30, "America/New_York"
  );

  assert.equal(
    fall.filter((slot) => slot.start.toFormat("HH:mm") === "01:00").length,
    2
  );

  const spring = expandWindow(
    "2026-03-08", "01:00", "04:00", 30, "America/New_York"
  );

  assert.ok(
    !spring.some((slot) => slot.start.toFormat("HH:mm").startsWith("02:"))
  );
});
test("invalid phone and email cannot create bookings", async () => {
 const data = await available();
 for (const patch of [{phone: "+1 416 555 0123"}, {phone: ""}, {email: "a..b@example.com"}, {reason: ""}]) {
  const result = await post("/api/booking/requests", {...inputFor(data.option,data.slots[0]), ...patch});
  assert.equal(result.status,400);
 }
 const [count] = await query("SELECT COUNT(*) AS total FROM appointment_requests");
 assert.equal(Number(count.total),0);
});
test("reservations occupy exactly 30 minutes and pending slots disappear", async () => {
 const data = await available();
 const created = await post("/api/booking/requests",inputFor(data.option,data.slots[0]));
 assert.equal(created.status,201);
 const [row] = await query("SELECT starts_at,ends_at FROM appointment_requests");
 assert.equal(row.ends_at-row.starts_at,30*60000);
 const updated = await available();
 assert.ok(!updated.slots.some(slot => slot.startsAt === data.slots[0].startsAt));
});


test("quick approval delivers both action receipts without dropping the earlier event", async () => {
 const data=await available();
 const created=await post("/api/booking/requests",inputFor(data.option,data.slots[0]));
 const ref=created.body.receipt.reference;
 await query("INSERT INTO staff_scopes(subject,location_id,provider_id,can_decide) VALUES('development-test-staff',1,1,1)");
 assert.equal((await post('/api/staff/requests/'+ref+'/actions',{action:'approve',expectedVersion:1})).status,200);
 const messages=[];
 for(let n=0;n<4;n++){const result=await deliverOne({sendMail:async mail=>messages.push(mail)});assert.equal(result.status,'sent');}
 assert.equal(messages.length,4);
 assert.ok(messages.some(mail=>mail.subject==='Appointment request received'));
 assert.ok(messages.some(mail=>mail.subject==='Appointment approved'));
 for(const mail of messages){assert.ok(mail.html);assert.ok(mail.text.includes('Status when this email was prepared: approved'));assert.ok(!mail.text.includes('Development Test Guest'));}
});
