import test, { after } from "node:test";
import assert from "node:assert/strict";

import { config } from "../src/config.mjs";
import { pool } from "../src/db.mjs";
import { can, csrf } from "../src/staff/auth.mjs";
import { need, scopeSQL } from "../src/staff/index.mjs";

after(async () => {
  await pool.end();
});

function context(role, extra = {}) {
  return {
    subject: "synthetic-policy-test-subject",
    csrfToken: "a".repeat(64),
    grants: [{
      locationId: 101,
      providerId: 202,
      role
    }],
    ...extra
  };
}

function request(origin, token, method = "POST") {
  const headers = {
    origin,
    "x-staff-csrf": token
  };

  return {
    method,
    get(name) {
      return headers[name.toLowerCase()];
    }
  };
}

test("scheduling permission requires the exact location/provider pair", () => {
  const ctx = context("scheduler");

  assert.equal(can(ctx, "decide", 101, 202), true);
  assert.equal(can(ctx, "decide", 101, 203), false);
  assert.equal(can(ctx, "decide", 102, 202), false);
  assert.equal(can(ctx, "decide", 102, 203), false);

  assert.throws(
    () => need(ctx, "decide", 101, 203),
    error => error.status === 403
  );
});

test("administrative access does not automatically grant medical access", () => {
  assert.equal(can(context("administrator"), "access", 101, 202), true);
  assert.equal(can(context("administrator"), "medical", 101, 202), false);
  assert.equal(can(context("clinician"), "medical", 101, 202), true);
});

test("auditors cannot read appointments or patient profiles", () => {
  const ctx = context("auditor");

  assert.equal(can(ctx, "audit", 101, 202), true);
  assert.equal(can(ctx, "read", 101, 202), false);
  assert.equal(can(ctx, "patients", 101, 202), false);
  assert.equal(can(ctx, "medical", 101, 202), false);
});

test("unknown and inherited object-property names grant no permissions", () => {
  for (const role of ["unknown", "toString", "constructor", "__proto__"]) {
    assert.equal(can(context(role), "read", 101, 202), false);
    assert.equal(can(context(role), "access", 101, 202), false);
  }
});

test("untrusted top-level role claims do not grant access", () => {
  const ctx = context("auditor", {
    role: "administrator",
    permissions: ["read", "medical", "access"],
    locationId: 101,
    providerId: 202
  });

  assert.equal(can(ctx, "read", 101, 202), false);
  assert.equal(can(ctx, "medical", 101, 202), false);
});

test("SQL authorization binds subject and both resource columns", () => {
  const ctx = context("scheduler");
  const result = scopeSQL(ctx, "read", "r");

  assert.match(result.sql, /EXISTS/);
  assert.match(result.sql, /sg\.subject=\?/);
  assert.match(result.sql, /sg\.location_id=r\.location_id/);
  assert.match(result.sql, /sg\.provider_id=r\.provider_id/);

  assert.equal(result.params[0], ctx.subject);
  assert.equal(result.sql.includes(ctx.subject), false);
});

test("unknown permissions fail closed", () => {
  assert.deepEqual(scopeSQL(context("administrator"), "unrestricted"), {
    sql: "0=1",
    params: []
  });
});

test("internal SQL aliases cannot contain SQL", () => {
  assert.throws(() =>
    scopeSQL(context("administrator"), "read", "r;DROP TABLE staff_users")
  );
});

test("valid same-origin CSRF request passes", () => {
  const ctx = context("scheduler");

  assert.doesNotThrow(() =>
    csrf(request(config.origin, ctx.csrfToken), ctx)
  );
});

test("cross-origin mutation is rejected", () => {
  const ctx = context("scheduler");

  assert.throws(
    () => csrf(request("https://untrusted.example.invalid", ctx.csrfToken), ctx),
    error => error.status === 403
  );
});

test("missing, wrong and non-ASCII CSRF values are rejected safely", () => {
  const ctx = context("scheduler");

  for (const token of [undefined, "", "b".repeat(64), "é".repeat(64)]) {
    assert.throws(
      () => csrf(request(config.origin, token), ctx),
      error => error.status === 403
    );
  }
});