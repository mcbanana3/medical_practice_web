import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { config } from "../src/config.mjs";
import { pool, query, decrypt } from "../src/db.mjs";
import { createApplication } from "../src/application.mjs";

let server;
let base;

async function clean() {
  for (const table of [
    "patient_reschedules",
    "patient_details",
    "patient_guest_link_codes",
    "patient_request_links",
    "patient_auth_tokens",
    "patient_sessions",
    "patient_mail_outbox",
    "patient_accounts",
    "notification_outbox",
    "audit_events",
    "appointment_requests",
    "schedule_exceptions",
    "rate_buckets",
    "staff_scopes"
  ]) {
    await query(`DELETE FROM ${table}`);
  }
}

class Client {
  cookie = "";
  csrf = "";

  async call(path, body, extraHeaders = {}) {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: config.origin,
        ...extraHeaders,
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(body === undefined ? {} : {
          "Content-Type": "application/json",
          "X-CSRF-Token": this.csrf
        })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    const cookies = response.headers.getSetCookie();
    if (cookies.length) this.cookie = cookies[0].split(";")[0];

    const data = await response.json();
    if (data.csrfToken) this.csrf = data.csrfToken;

    return { status: response.status, data };
  }

  async session() {
    return this.call("/api/auth/session");
  }
}

const password = "Development-only password 493!";

async function register(client, email) {
  await client.session();
  return client.call("/api/auth/register", {
    email, password, displayName: "Development Test Account", captchaToken: "test"
  });
}

async function tokenFor(kind, email) {
  const rows = await query(
    "SELECT payload_enc FROM patient_mail_outbox ORDER BY next_attempt_at, id"
  );

  const payload = rows.map((row) => decrypt(row.payload_enc))
    .find((item) => item.kind === kind && (!email || item.to === email));

  assert.ok(payload, `Expected ${kind} email`);
  return new URLSearchParams(new URL(payload.url).hash.slice(1)).get("token");
}

async function verifiedClient(email) {
  const client = new Client();
  await register(client, email);
  const token = await tokenFor("verify", email);
  assert.equal((await client.call("/api/auth/verify-email", {
    token, captchaToken: "test"
  })).status, 200);

  assert.equal((await client.call("/api/auth/login", {
    email, password, captchaToken: "test"
  })).status, 200);

  await client.session();
  return client;
}

before(async () => {
  if (
    config.environment !== "test" ||
    !config.db.database.endsWith("_test")
  ) throw new Error("Dedicated _test database required");

  server = createApplication({
    captchaVerifier: async () => {},
    staffVerifier: async () => ({
      sub: "development-test-staff",
      scope: "appointments:read appointments:decide appointments:link"
    })
  }).listen(0);

  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(clean);

after(async () => {
  await clean();
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test("registration is generic and never stores a plaintext password", async () => {
  const client = new Client();
  const first = await register(client, "first@example.test");
  const duplicate = await register(client, "first@example.test");

  assert.equal(first.status, 202);
  assert.equal(duplicate.status, 202);
  assert.equal(first.data.message, duplicate.data.message);

  const [patient] = await query("SELECT password_hash FROM patient_accounts");
  assert.ok(patient.password_hash.startsWith("$argon2id$"));
  assert.ok(!patient.password_hash.includes(password));
});

test("email verification is single-use and login rotates the session", async () => {
  const client = new Client();
  await register(client, "first@example.test");

  const token = await tokenFor("verify");
  assert.equal((await client.call("/api/auth/verify-email", {
    token, captchaToken: "test"
  })).status, 200);

  assert.equal((await client.call("/api/auth/verify-email", {
    token, captchaToken: "test"
  })).status, 400);

  const previousCookie = client.cookie;

  assert.equal((await client.call("/api/auth/login", {
    email: "first@example.test", password, captchaToken: "test"
  })).status, 200);

  assert.notEqual(client.cookie, previousCookie);
});

test("missing CSRF is denied", async () => {
  const client = await verifiedClient("first@example.test");
  client.csrf = "";

  assert.equal(
    (await client.call("/api/portal/sessions/revoke-all", {})).status,
    403
  );
});

test("recovery token is single-use and revokes active sessions", async () => {
  const client = await verifiedClient("first@example.test");

  assert.equal((await client.call("/api/auth/recovery", {
    email: "first@example.test", captchaToken: "test"
  })).status, 202);

  const token = await tokenFor("reset");
  const reset = {
    token,
    newPassword: "Different development password 981!",
    captchaToken: "test"
  };

  assert.equal((await client.call("/api/auth/reset-password", reset)).status, 200);
  await client.session();
  assert.equal((await client.call("/api/auth/reset-password", reset)).status, 400);

  const [active] = await query(
    `SELECT COUNT(*) AS total FROM patient_sessions
     WHERE patient_id IS NOT NULL AND revoked_at IS NULL`
  );
  assert.equal(Number(active.total), 0);
});

test("patients cannot retrieve a request merely by knowing its reference", async () => {
  const client = await verifiedClient("first@example.test");

  const result = await client.call(
    `/api/portal/appointments/${"a".repeat(32)}`
  );

  assert.equal(result.status, 404);
});

test("logout removes authenticated access", async () => {
  const client = await verifiedClient("first@example.test");

  assert.equal((await client.call("/api/auth/logout", {})).status, 200);
  assert.equal((await client.call("/api/portal/appointments")).status, 401);
});

test("returning patient booking validates contacts and links the 30-minute request", async () => {
 const client = await verifiedClient("booking@example.test");
 const metadata = (await client.call("/api/booking/options")).data;
 const option = metadata.options[0];
 const date = metadata.dateChoices.find(value => value > metadata.minDate && ![0,6].includes(new Date(value+"T12:00:00Z").getUTCDay()));
 const params = new URLSearchParams({locationId:option.locationId,providerId:option.providerId,typeId:option.typeId,date});
 const slot = (await client.call("/api/booking/availability?"+params)).data.slots[0];
 const body = {locationId:option.locationId,providerId:option.providerId,typeId:option.typeId,startsAt:slot.startsAt,name:"Test patient",email:"booking@example.test",phone:"4323370555",reason:"Annual checkup",captchaToken:"test"};
 const headers = {"Idempotency-Key":crypto.randomUUID()};
 assert.equal((await client.call("/api/portal/requests",{...body,phone:"+1 416 555 0123"},headers)).status,400);
 assert.equal((await client.call("/api/portal/requests",{...body,email:"a..b@example.com"},headers)).status,400);
 const created = await client.call("/api/portal/requests",body,headers);
 assert.equal(created.status,201);
 assert.equal((await client.call("/api/portal/requests",body,headers)).status,200);
 const detail = await client.call("/api/portal/appointments/"+created.data.receipt.reference);
 assert.equal(detail.status,200);
 assert.equal(new Date(detail.data.endsAt)-new Date(detail.data.startsAt),1800000);
 assert.equal(detail.data.status,"pending");
});


test("profile edits persist, enforce versions, and stay private to their account", async () => {
 const client = await verifiedClient("profile@example.test");
 const initial = await client.call("/api/portal/profile");
 assert.equal(initial.status,200);
 const saved = await client.call("/api/portal/profile", {version:initial.data.version,details:{displayName:"Synthetic patient",phone:"4323370555",medicalHistory:"Synthetic test information"}});
 assert.equal(saved.status,200);
 const reloaded = await client.call("/api/portal/profile");
 assert.equal(reloaded.data.details.displayName,"Synthetic patient");
 assert.equal(reloaded.data.details.phone,"+14323370555");
 assert.equal(reloaded.data.details.medicalHistory,"Synthetic test information");
 assert.equal((await client.call("/api/portal/profile",{version:initial.data.version,details:{displayName:"Stale update"}})).status,409);
 const [current] = await query("SELECT patient_id FROM patient_details");
 const [record] = await query("SELECT details_enc FROM patient_details WHERE patient_id=?",[current.patient_id]);
 assert.ok(!record.details_enc.includes("Synthetic test information"));
 const contact = await client.call("/api/portal/contact");
 assert.equal(contact.data.medicalHistory,undefined);
 const other = new Client(); await other.session();
 assert.equal((await other.call("/api/portal/profile")).status,401);
});

test("patient rescheduling preserves the original and cancellation releases both linked reservations", async () => {
 const client=await verifiedClient("changes@example.test");
 const meta=(await client.call("/api/booking/options")).data;const option=meta.options[0];
 const date=meta.dateChoices.find(d=>d>meta.minDate&&![0,6].includes(new Date(d+"T12:00:00Z").getUTCDay()));
 const parameters=new URLSearchParams({locationId:option.locationId,providerId:option.providerId,typeId:option.typeId,date});
 const slots=(await client.call("/api/booking/availability?"+parameters)).data.slots;
 const created=await client.call("/api/portal/requests",{locationId:option.locationId,providerId:option.providerId,typeId:option.typeId,startsAt:slots[0].startsAt,name:"Synthetic patient",email:"changes@example.test",phone:"4323370555",reason:"Follow up",captchaToken:"test"},{"Idempotency-Key":crypto.randomUUID()});
 assert.equal(created.status,201);const ref=created.data.receipt.reference;
 const detail=(await client.call("/api/portal/appointments/"+ref)).data;
 assert.equal(detail.contact.reason,"Follow up");
 const other=await verifiedClient("other@example.test");
 assert.equal((await other.call("/api/portal/appointments/"+ref)).status,404);
 const replacement=await client.call("/api/portal/appointments/"+ref+"/reschedule",{expectedVersion:detail.version,startsAt:slots[1].startsAt},{"Idempotency-Key":crypto.randomUUID()});
 assert.equal(replacement.status,201);
 const original=(await client.call("/api/portal/appointments/"+ref)).data;
 assert.equal(original.status,"pending");assert.equal(original.canReschedule,false);
 assert.equal((await client.call("/api/portal/appointments/"+ref+"/cancel",{expectedVersion:detail.version})).status,409);
 assert.equal((await client.call("/api/portal/appointments/"+ref+"/cancel",{expectedVersion:original.version})).status,200);
 assert.equal((await client.call("/api/portal/appointments/"+replacement.data.reference)).data.status,"cancelled");
 const available=(await client.call("/api/booking/availability?"+parameters)).data.slots;
 assert.ok(available.some(s=>s.startsAt===slots[0].startsAt));assert.ok(available.some(s=>s.startsAt===slots[1].startsAt));
});


test("successful account actions queue specific emails and failed actions queue none", async () => {
 const client=await verifiedClient("mail-actions@example.test");
 const kinds=async()=> (await query("SELECT payload_enc FROM patient_mail_outbox")).map(row=>decrypt(row.payload_enc).kind);
 assert.ok((await kinds()).includes("verify"));assert.ok((await kinds()).includes("verified"));assert.ok((await kinds()).includes("login"));
 const count=(await kinds()).length;
 assert.equal((await client.call("/api/auth/login",{email:"mail-actions@example.test",password:"Wrong test password",captchaToken:"test"})).status,401);
 assert.equal((await kinds()).length,count);
 const profile=(await client.call("/api/portal/profile")).data;
 await client.call("/api/portal/profile",{version:profile.version,details:{displayName:"Synthetic mail test"}});
 assert.ok((await kinds()).includes("profile_updated"));
 await client.call("/api/portal/sessions/revoke-all",{});
 assert.ok((await kinds()).includes("sessions_revoked"));
});
