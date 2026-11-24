import { parseArgs } from "node:util";
import { Writable } from "node:stream";
import { createInterface } from "node:readline/promises";
import { z } from "zod";
import {
  pool, query, transaction, encrypt, newId, audit
} from "../src/db.mjs";
import {
  S, emailSchema, emailHash, lockSecurity, recoveryCodes
} from "../src/staff/auth.mjs";
import { hashPassword, passwordValid } from "../src/staff/passwords.mjs";

async function hiddenPassword(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Run this setup interactively in a terminal.");
  }
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    }
  });
  const rl = createInterface({
    input: process.stdin, output, terminal: true
  });
  try {
    const answer = rl.question(prompt);
    muted = true;
    return await answer;
  } finally {
    muted = false;
    rl.close();
    process.stdout.write("\n");
  }
}

try {
  const { values: v } = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      location: { type: "string" },
      provider: { type: "string" },
      operator: { type: "string" },
      doctor: { type: "boolean", default: false }
    },
    strict: true
  });
  if (!S.enabled) throw new Error("Set STAFF_LOCAL_ENABLED=true first.");
  const label = z.string().trim().min(1).max(100)
    .refine(s => !/[\x00-\x1f\x7f]/.test(s));
  const email = emailSchema.parse(v.email);
  const name = label.parse(v.name);
  const operator = label.parse(v.operator);
  const location = z.coerce.number().int().positive().parse(v.location);
  const provider = z.coerce.number().int().positive().parse(v.provider);

  const password = await hiddenPassword("New administrator password: ");
  const confirmation = await hiddenPassword("Repeat password: ");
  if (!passwordValid(password) || password !== confirmation) {
    throw new Error("Passwords must match and contain 8–128 characters.");
  }
  const passwordHash = await hashPassword(password);

  const codes = await transaction(async c => {
    const guard = await lockSecurity(c);
    const [count] = await query(
      "SELECT COUNT(*) AS total FROM staff_local_credentials", [], c
    );
    if (guard.bootstrap_subject || Number(count.total) > 0) {
      throw new Error("Initial setup has already been completed. Use staff account management.");
    }
    const [pair] = await query(
      "SELECT location_id FROM booking_options WHERE location_id=? AND provider_id=? LIMIT 1",
      [location, provider], c
    );
    if (!pair) throw new Error("Choose an existing location/provider booking pair.");
    const subject = "local:" + newId();
    await query(
      `INSERT INTO staff_users
       (subject,issuer,display_name,enabled,auth_version,created_at)
       VALUES(?,?,?,1,1,UTC_TIMESTAMP(3))`,
      [subject, S.issuer, name], c
    );
    await query(
      `INSERT INTO staff_local_credentials
       (subject,email_hash,email_enc,password_hash,is_doctor,created_at,updated_at)
       VALUES(?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
      [subject, emailHash(email), encrypt({ email }), passwordHash, v.doctor ? 1 : 0], c
    );
    const roles = v.doctor ? ["administrator", "clinician"] : ["administrator"];
    for (const role of roles) await query(
      "INSERT INTO staff_grants(subject,location_id,provider_id,role) VALUES(?,?,?,?)",
      [subject, location, provider, role], c
    );
    await query(
      `INSERT INTO staff_scopes
       (subject,location_id,provider_id,can_decide,revoked_at)
       VALUES(?,?,?,1,NULL)`,
      [subject, location, provider], c
    );
    await query(
      "UPDATE staff_local_guard SET bootstrap_subject=? WHERE id=1", [subject], c
    );
    await audit(c, null, "offline:" + operator, "staff.local.bootstrapped", {
      locationId: location, providerId: provider, rolesAfter: roles
    });
    return recoveryCodes(c, { subject });
  });

  console.log("\nLocal administrator created.");
  console.log("SAVE THESE BACKUP CODES OFFLINE. THEY WILL NOT BE SHOWN AGAIN.\n");
  for (const code of codes) console.log(code);
  console.log("\nSign in at /staff/login.");
} catch (error) {
  console.error(error instanceof z.ZodError
    ? "Check the setup arguments."
    : error.code?.startsWith("ER_")
      ? "Database setup failed. Check migrations and connectivity."
      : error.message || "Setup failed.");
  process.exitCode = 1;
} finally {
  await pool.end();
}