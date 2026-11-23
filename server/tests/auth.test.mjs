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

  async call(path, body) {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: config.origin,
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

async function tokenFor(kind) {
  const rows = await query(
    "SELECT payload_enc FROM patient_mail_outbox ORDER BY next_attempt_at, id"
  );

  const payload = rows.map((row) => decrypt(row.payload_enc))
    .find((item) => item.kind === kind);

  assert.ok(payload, `Expected ${kind} email`);
  return new URLSearchParams(new URL(payload.url).hash.slice(1)).get("token");
}

async function verifiedClient(email) {
  const client = new Client();
  await register(client, email);
  const token = await tokenFor("verify");
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