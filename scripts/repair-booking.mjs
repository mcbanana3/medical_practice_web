import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const changes = new Map();

async function read(relative) {
  if (changes.has(relative)) return changes.get(relative);
  return fs.readFile(path.join(root, relative), "utf8");
}

function put(relative, contents) {
  changes.set(relative, contents.trimStart());
}

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;

  if (count !== 1) {
    throw new Error(
      label + ": expected exactly one matching block, found " + count +
      ". No changes have been written."
    );
  }

  return source.replace(before, after);
}

async function edit(relative, callback) {
  put(relative, callback(await read(relative)));
}

try {
  await fs.access(path.join(root, ".booking-repair-applied"));
  throw new Error("This repair was already applied. Do not run it twice.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

/* ---------- Pending appointments never expire automatically ---------- */

await edit("server/src/scheduling.mjs", (source) =>
  replaceOnce(
    source,
    "(status='pending' AND expires_at > UTC_TIMESTAMP(3))",
    "status='pending'",
    "Availability reservation rule"
  )
);

await edit("server/src/requests.mjs", (source) => {
  source = replaceOnce(
    source,
    "      const expires = now.plus({ minutes: config.holdMinutes });",
    "",
    "Remove timed pending hold"
  );

  source = replaceOnce(
    source,
    "reservationExpiresAt: expires.toISO(),",
    "reservationExpiresAt: null,",
    "Receipt reservation expiry"
  );

  source = replaceOnce(
    source,
    "expires.toJSDate(), JSON.stringify(receipt)",
    "null, JSON.stringify(receipt)",
    "Store indefinite pending reservation"
  );

  source = replaceOnce(
    source,
    String.raw`      row.version !== expectedVersion ||
      row.status !== "pending" ||
      !row.expires_at ||
      row.expires_at.getTime() <= now.toMillis()`,
    String.raw`      row.version !== expectedVersion ||
      row.status !== "pending"`,
    "Staff decision validation"
  );

  source = source.replace(
    "The request changed or its hold expired. Reload before acting.",
    "The request changed. Reload before acting."
  );

  source = replaceOnce(
    source,
    "(status='pending' AND expires_at > UTC_TIMESTAMP(3))",
    "status='pending'",
    "Approval overlap protection"
  );

  const start = source.indexOf("export async function expireHolds() {");

  if (start < 0 || !source.slice(start).includes("request.expired")) {
    throw new Error("Could not locate the original expiration worker.");
  }

  source = source.slice(0, start) + String.raw`
export async function expireHolds() {
  // Compatibility export for the existing worker.
  // Pending requests now remain reserved until a staff decision.
  await query(
    "DELETE FROM rate_buckets WHERE expires_at < UTC_TIMESTAMP(3)"
  );
}
`;

  return source;
});

await edit("server/src/config.mjs", (source) => {
  source = replaceOnce(
    source,
    '  holdMinutes: integer("PENDING_HOLD_MINUTES", 1, 10080),\n',
    "",
    "Remove obsolete hold duration configuration"
  );

  source = replaceOnce(
    source,
    '  expiryAction: required("EXPIRED_REQUEST_ACTION"),\n',
    "",
    "Remove obsolete expiration configuration"
  );

  source = replaceOnce(
    source,
    String.raw`if (config.expiryAction !== "expire") {
  throw new Error("This implementation requires EXPIRED_REQUEST_ACTION=expire");
}
`,
    "",
    "Remove obsolete expiration check"
  );

  source = replaceOnce(
    source,
    '  support: required("PUBLIC_SUPPORT_CONTACT"),',
    String.raw`  support: (process.env.PUBLIC_SUPPORT_CONTACT || "").includes("[PLACEHOLDER:")
    ? ""
    : (process.env.PUBLIC_SUPPORT_CONTACT || "").trim(),`,
    "Hide unconfigured public support text"
  );

  source = replaceOnce(
    source,
    '    config.support.includes("[PLACEHOLDER:") ||',
    String.raw`    !config.support ||
    config.support.includes("[PLACEHOLDER:") ||`,
    "Require verified production support contact"
  );

  return source;
});

put("server/migrations/003_pending_until_staff_decision.sql", String.raw`
START TRANSACTION;

INSERT INTO audit_events
  (request_id, actor, event, details, created_at)
SELECT
  id,
  'system',
  'request.reservation.policy.updated',
  JSON_OBJECT(
    'from', 'timed_pending_hold',
    'to', 'pending_until_staff_decision'
  ),
  UTC_TIMESTAMP(3)
FROM appointment_requests
WHERE status='pending' AND expires_at IS NOT NULL;

UPDATE appointment_requests
SET expires_at=NULL
WHERE status='pending';

COMMIT;
`);

/* ---------- Password policy and safe verification ---------- */

await edit("server/src/auth/routes.mjs", (source) => {
  source = replaceOnce(
    source,
    "const passwordSchema = z.string().min(8).max(128);",
    "const passwordSchema = z.string().min(8).max(128);",
    "Password minimum"
  );

  source = source.replaceAll("15–128", "8–128");

  const start = source.indexOf('  router.post("/api/auth/verify-email",');
  const end = source.indexOf('  router.post("/api/auth/reset-password",', start);

  if (start < 0 || end < 0) {
    throw new Error("Could not locate the verification endpoint.");
  }

  return source.slice(0, start) + String.raw`
  router.post("/api/auth/verify-email", async (request, response) => {
    const input = z.object({
      token: tokenSchema,
      password: passwordSchema,
      captchaToken: captchaSchema
    }).strict().parse(request.body);

    await captchaVerifier(input.captchaToken);
    const initial = await tokenPatient(input.token, "verify");
    const passwordHash = await hashPassword(input.password);

    await transaction(async (connection) => {
      const [patient] = await query(
        "SELECT * FROM patient_accounts WHERE id=? FOR UPDATE",
        [initial.id], connection
      );

      if (
        !patient ||
        patient.disabled_at ||
        patient.email_verified_at
      ) {
        throw new SafeError(
          400, "INVALID_LINK", "This link is invalid or expired."
        );
      }

      await consumeToken(connection, input.token, "verify", patient.id);

      // The person controlling the verification link chooses the final
      // password. A pre-existing unverified password cannot remain usable.
      await query(
        "UPDATE patient_accounts SET password_hash=?, " +
        "email_verified_at=UTC_TIMESTAMP(3), auth_version=auth_version+1 " +
        "WHERE id=?",
        [passwordHash, patient.id], connection
      );

      await query(
        "UPDATE patient_sessions SET revoked_at=UTC_TIMESTAMP(3) " +
        "WHERE patient_id=? AND revoked_at IS NULL",
        [patient.id], connection
      );

      await query(
        "UPDATE patient_auth_tokens SET used_at=UTC_TIMESTAMP(3) " +
        "WHERE patient_id=? AND purpose='verify' AND used_at IS NULL",
        [patient.id], connection
      );

      await audit(
        connection, null,
        "patient:" + patient.id,
        "patient.email.verified"
      );
    });

    response.json({ message: "Email verified. You can now sign in." });
  });

` + source.slice(end);
});

put("src/auth/emailLink.js", String.raw`
export function captureEmailToken(reference, hash) {
  if (reference.current === null) {
    const value = new URLSearchParams(hash.replace(/^#/, "")).get("token") || "";
    reference.current = /^[a-f0-9]{64}$/.test(value) ? value : "";
  }

  return reference.current;
}
`);

await edit("src/pages/AuthPages.jsx", (source) => {
  source = replaceOnce(
    source,
    'import { post } from "../auth/client.js";',
    String.raw`import { post } from "../auth/client.js";
import { captureEmailToken } from "../auth/emailLink.js";`,
    "Import stable verification-token reader"
  );

  source = replaceOnce(
    source,
    'const tokenRef = useRef("");',
    "const tokenRef = useRef(null);",
    "Retain token across Strict Mode effects"
  );

  const start = source.indexOf("  useEffect(() => {\n    const parsed = new URLSearchParams");
  const end = source.indexOf("  }, [mode]);", start);

  if (start < 0 || end < 0) {
    throw new Error("Could not locate the original email-token effect.");
  }

  source = source.slice(0, start) + String.raw`
  useEffect(() => {
    const raw = captureEmailToken(tokenRef, window.location.hash);
    setToken(raw);

    if (window.location.hash) {
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search
      );
    }
  }, [mode]);` + source.slice(end + "  }, [mode]);".length);

  source = replaceOnce(
    source,
    'const fields = mode === "verify" ? [] : reset',
    'const fields = mode === "verify" ? [["password", "Confirm or choose your password", "password", "new-password"]] : reset',
    "Verification password field"
  );

  source = replaceOnce(
    source,
    "? { token: tokenRef.current, captchaToken: captcha }",
    '? { token: tokenRef.current, password: values.password || "", captchaToken: captcha }',
    "Submit verification password"
  );

  source = source.replaceAll(
    'field === "password" && mode === "register"',
    'field === "password" && (mode === "register" || mode === "verify")'
  );

  source = source.replaceAll("? 15 : undefined", "? 8 : undefined");
  source = source.replaceAll("15–128", "8–128");

  source = replaceOnce(
    source,
    '(mode === "register" || reset)',
    '(mode === "register" || mode === "verify" || reset)',
    "Password guidance on verification"
  );

  source = replaceOnce(
    source,
    'disabled={busy || auth.loading || Boolean(auth.error) || (mode === "verify" && !token)}',
    'disabled={busy || auth.loading || Boolean(auth.error) || !captcha || (mode === "verify" && !token)}',
    "Enable verification after valid token and captcha"
  );

  source = replaceOnce(
    source,
    '{auth.error && <Notice title="Account services unavailable">{auth.error}</Notice>}',
    String.raw`{auth.error && (
              <div>
                <Notice title="Account services unavailable">{auth.error}</Notice>
                <Button type="button" variant="outline" onClick={auth.refresh}>
                  Retry account connection
                </Button>
              </div>
            )}`,
    "Retry account bootstrap"
  );

  return source;
});

await edit("src/pages/Portal.jsx", (source) =>
  source.replaceAll("8–128", "8–128").replaceAll("minLength={8}", "minLength={8}")
);

/* ---------- Remove literal fallback placeholders from booking ---------- */

await edit("src/pages/Booking.jsx", (source) =>
  source
    .replaceAll(
      '"[PLACEHOLDER: clinic time zone]"',
      '"Clinic time zone unavailable"'
    )
    .replaceAll(
      '"[PLACEHOLDER: verified booking support]"',
      '"Contact information is not currently available"'
    )
);

await edit("src/components/LocationMap.jsx", (source) =>
  source.replaceAll(
    '"[PLACEHOLDER: verified practice location and Google Maps embed]"',
    '"Use the published address and written directions."'
  )
);

/* ---------- Update existing automated tests ---------- */

await edit("server/tests/booking.test.mjs", (source) => {
  const start = source.indexOf('test("expired hold is released and audited"');
  const end = source.indexOf('test("staff cannot act without a matching database scope"', start);

  if (start < 0 || end < 0) {
    throw new Error("Could not locate the old timed-expiration test.");
  }

  source = source.slice(0, start) + String.raw`
test("pending requests remain reserved until a staff decision", async () => {
  const data = await available();
  await post(
    "/api/booking/requests",
    inputFor(data.option, data.slots[0])
  );

  // Even a legacy timestamp must not release a still-pending request.
  await query(
    "UPDATE appointment_requests " +
    "SET expires_at=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND)"
  );

  await expireHolds();

  const [row] = await query("SELECT status FROM appointment_requests");
  assert.equal(row.status, "pending");

  const parameters = new URLSearchParams({
    locationId: String(data.option.locationId),
    providerId: String(data.option.providerId),
    typeId: String(data.option.typeId),
    date: data.date
  });

  const result = await get("/api/booking/availability?" + parameters);

  assert.ok(!result.body.slots.some(
    (slot) => slot.startsAt === data.slots[0].startsAt
  ));
});

test("declining releases the slot and queues the patient notification", async () => {
  const data = await available();

  const created = await post(
    "/api/booking/requests",
    inputFor(data.option, data.slots[0])
  );

  const reference = created.body.receipt.reference;

  await query(
    "INSERT INTO staff_scopes " +
    "(subject, location_id, provider_id, can_decide) " +
    "VALUES ('development-test-staff', ?, ?, 1)",
    [data.option.locationId, data.option.providerId]
  );

  const declined = await post(
    "/api/staff/requests/" + reference + "/actions",
    { action: "decline", expectedVersion: 1 }
  );

  assert.equal(declined.status, 200);
  assert.equal(declined.body.status, "declined");

  const parameters = new URLSearchParams({
    locationId: String(data.option.locationId),
    providerId: String(data.option.providerId),
    typeId: String(data.option.typeId),
    date: data.date
  });

  const result = await get("/api/booking/availability?" + parameters);

  assert.ok(result.body.slots.some(
    (slot) => slot.startsAt === data.slots[0].startsAt
  ));

  const patientJobs = await query(
    "SELECT id FROM notification_outbox " +
    "WHERE request_id=? AND event_type='declined' AND recipient_type='patient'",
    [reference]
  );

  const doctorJobs = await query(
    "SELECT id FROM notification_outbox " +
    "WHERE request_id=? AND event_type='requested' AND recipient_type='admin'",
    [reference]
  );

  assert.equal(patientJobs.length, 1);
  assert.equal(doctorJobs.length, 1);
});

` + source.slice(end);

  return source;
});

await edit("server/tests/auth.test.mjs", (source) => {
  if (!source.includes('token, captchaToken: "test"')) {
    throw new Error("Could not locate verification test requests.");
  }

  source = source.replaceAll(
    'token, captchaToken: "test"',
    'token, password, captchaToken: "test"'
  );

  return source + String.raw`

test("eight-character passwords are accepted and seven are rejected", async () => {
  const client = new Client();
  await client.session();

  const accepted = await client.call("/api/auth/register", {
    email: "eight@example.test",
    password: "Dev8!abc",
    displayName: "",
    captchaToken: "test"
  });

  const rejected = await client.call("/api/auth/register", {
    email: "seven@example.test",
    password: "Dev8!ab",
    displayName: "",
    captchaToken: "test"
  });

  assert.equal(accepted.status, 202);
  assert.equal(rejected.status, 400);
});
`;
});

put("tests/email-link.test.js", String.raw`
import test from "node:test";
import assert from "node:assert/strict";
import { captureEmailToken } from "../src/auth/emailLink.js";

test("verification token survives a second effect after hash removal", () => {
  const holder = { current: null };
  const token = "a".repeat(64);

  assert.equal(captureEmailToken(holder, "#token=" + token), token);
  assert.equal(captureEmailToken(holder, ""), token);
});

test("invalid verification tokens are not accepted by the reader", () => {
  assert.equal(captureEmailToken({ current: null }, "#token=invalid"), "");
});
`);

/* ---------- Remove generic development banner and internal preview routes ---------- */

await edit("src/components/Header.jsx", (source) => {
  const start = source.indexOf("      {!site.publicationReady && (");
  const end = source.indexOf("      <MotionPreferences />", start);

  if (start < 0 || end < 0) {
    throw new Error("Could not locate the development header banner.");
  }

  return source.slice(0, start) + source.slice(end);
});

await edit("src/App.jsx", (source) => {
  for (const route of ["/care/content-preview", "/preview/states"]) {
    const lines = source.split("\n");
    const matching = lines.filter((line) => line.includes('path="' + route + '"'));

    if (matching.length !== 1) {
      throw new Error("Could not locate preview route: " + route);
    }

    source = lines.filter((line) =>
      !line.includes('path="' + route + '"')
    ).join("\n");
  }

  return source;
});

/* ---------- Add useful package commands ---------- */

const serverPackage = JSON.parse(await read("server/package.json"));
serverPackage.scripts["dev:all"] = "node scripts/run-local.mjs";
serverPackage.scripts["email:check"] = "node scripts/check-doctor-email.mjs";
put("server/package.json", JSON.stringify(serverPackage, null, 2) + "\n");

/* ---------- Wireframe amendment ---------- */

put("docs/wireframe-amendment-v0.3.md", String.raw`
# Wireframe amendment v0.3

User-requested changes:
- Public identity: Harika Thummala MD.
- Password minimum: 8 characters; maximum remains 128.
- A successfully accepted pending request reserves its provider interval
  until an authorized staff decision.
- No automatic expiration of pending appointment reservations.
- Approval keeps the interval unavailable as a confirmed appointment.
- Rejection releases the interval, subject to normal schedule and lead-time rules.
- New requests queue a doctor notification and patient acknowledgement.
- Rejection queues a patient message inviting another appointment request.
- Email delivery failures never erase a saved request.
- General development banners and public draft content are removed.
- Unknown clinical/practice facts are omitted, not fabricated.
- Emergency, security, privacy, error, and request-status messages remain.

This records requested product behavior, not clinical/legal approval.
`);

/* ---------- Write only after every baseline check succeeds ---------- */

for (const [relative, contents] of changes) {
  const filename = path.join(root, relative);
  await fs.mkdir(path.dirname(filename), { recursive: true });

  try {
    await fs.copyFile(filename, filename + ".before-booking-repair", 1);
  } catch (error) {
    if (!["ENOENT", "EEXIST"].includes(error.code)) throw error;
  }

  await fs.writeFile(filename, contents);
  console.log("Updated " + relative);
}

await fs.writeFile(path.join(root, ".booking-repair-applied"), "applied\n");

console.log("\nRepair files written. Database migration has NOT been run.");
console.log("Next: replace notifications.mjs and add the worker/email scripts below.");