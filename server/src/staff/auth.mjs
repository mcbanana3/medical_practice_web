import { randomBytes, timingSafeEqual } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { config } from "../config.mjs";
import {
  query, transaction, digest, encrypt, decrypt, newId, SafeError, audit
} from "../db.mjs";
import { rateLimit } from "../security.mjs";
import { queue } from "./mail.mjs";
import {
  passwordValid, hashPassword, verifyPassword, PasswordBusyError
} from "./passwords.mjs";
import { S } from "./local-settings.mjs";

export { S };

export { staffPermissions as PERMS } from "../../../shared/staff-permissions.js";
import { staffPermissions as PERMS } from "../../../shared/staff-permissions.js";

export function can(ctx, permission, locationId, providerId) {
  const anyPair = locationId === undefined && providerId === undefined;
  if (!anyPair && (
    !Number.isSafeInteger(Number(locationId)) || Number(locationId) < 1 ||
    !Number.isSafeInteger(Number(providerId)) || Number(providerId) < 1
  )) return false;
  return Boolean(ctx?.grants?.some(g =>
    Object.hasOwn(PERMS, g.role) && PERMS[g.role].includes(permission) &&
    (anyPair || (
      Number(g.locationId) === Number(locationId) &&
      Number(g.providerId) === Number(providerId)
    ))
  ));
}

export const emailSchema = z.string().trim().max(254).email()
  .transform(s => s.toLowerCase());
export const passwordSchema = z.string().refine(passwordValid, {
  message: "Use 8–128 characters."
});
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const cookieOptions = {
  path: "/", httpOnly: true, secure: config.production, sameSite: "lax"
};
const sessionCookie = config.production ? "__Host-staff_session" : "staff_session";
const formCookie = config.production ? "__Host-staff_form" : "staff_form";
const policy = digest(`staff-local-v1:${S.idleMinutes}:${S.absoluteHours}`);

export const randomSecret = () => randomBytes(32).toString("hex");
export const emailHash = email => digest("staff-email:" + email);

export function fail(code, message, status = 400) {
  throw new SafeError(status, code, message);
}

function same(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function cookie(req, name) {
  const matches = (req.headers.cookie || "").split(";")
    .map(s => s.trim()).filter(s => s.startsWith(name + "="));
  if (matches.length !== 1) return "";
  const value = matches[0].slice(name.length + 1);
  return /^[a-f0-9]{64}$/.test(value) ? value : "";
}

export const clearCookie = res => res.clearCookie(sessionCookie, cookieOptions);

export function csrf(req, ctx) {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && (
    req.get("origin") !== config.origin ||
    !same(req.get("X-Staff-CSRF"), ctx?.csrfToken)
  )) fail("STAFF_CSRF", "Reload the staff page before continuing.", 403);
}

function publicCsrf(req) {
  if (
    req.get("origin") !== config.origin ||
    !req.is("application/json") ||
    !same(req.body?.loginToken, cookie(req, formCookie))
  ) fail("STAFF_CSRF", "Reload the sign-in form before continuing.", 403);
}

function enabled(req, res, next) {
  if (!S.enabled) fail("STAFF_DISABLED", "Staff access is disabled.", 503);
  next();
}

export async function kdf(operation) {
  try { return await operation(); }
  catch (error) {
    if (error instanceof PasswordBusyError) {
      fail("AUTH_BUSY", "Authentication is busy. Wait briefly and retry.", 503);
    }
    throw error;
  }
}

export async function lockSecurity(c) {
  const [row] = await query(
    "SELECT * FROM staff_local_guard WHERE id=1 FOR UPDATE", [], c
  );
  if (!row) fail("AUTH_SETUP", "Install the local staff migration.", 503);
  return row;
}

export async function databaseDate(connection) {
  const [row] = await query(
    "SELECT UTC_TIMESTAMP(3) AS staff_now",
    [],
    connection
  );
  return row.staff_now;
}

export async function localUser(c, subject) {
  const [user] = await query(
    `SELECT u.*,l.email_hash,l.email_enc,l.password_hash,l.is_doctor
     FROM staff_users u JOIN staff_local_credentials l ON l.subject=u.subject
     WHERE u.subject=? AND u.issuer=? FOR UPDATE`,
    [subject, S.issuer], c
  );
  return user;
}

async function emailUser(email) {
  const [user] = await query(
    `SELECT u.*,l.email_hash,l.email_enc,l.password_hash,l.is_doctor
     FROM staff_users u JOIN staff_local_credentials l ON l.subject=u.subject
     WHERE l.email_hash=? AND u.issuer=?`,
    [emailHash(email), S.issuer]
  );
  return user;
}

export async function logSecurity(c, user, event, actor = user.subject) {
  const pairs = await query(
    `SELECT DISTINCT location_id AS locationId,provider_id AS providerId
     FROM staff_grants WHERE subject=?`, [user.subject], c
  );
  if (!pairs.length) await audit(c, null, actor, event);
  for (const pair of pairs) await audit(c, null, actor, event, pair);
}

export async function invalidate(c, user) {
  await query(
    "UPDATE staff_users SET auth_version=auth_version+1 WHERE subject=?",
    [user.subject], c
  );
  await query(
    `UPDATE staff_sessions SET revoked_at=UTC_TIMESTAMP(3)
     WHERE subject=? AND revoked_at IS NULL`, [user.subject], c
  );
  await query(
    `UPDATE staff_local_tokens SET used_at=UTC_TIMESTAMP(3)
     WHERE subject=? AND used_at IS NULL`, [user.subject], c
  );
  await query("DELETE FROM staff_local_recovery WHERE subject=?", [user.subject], c);
}

export async function recoveryCodes(c, user) {
  await query("DELETE FROM staff_local_recovery WHERE subject=?", [user.subject], c);
  const codes = [];
  for (let n = 0; n < 10; n += 1) {
    const raw = randomBytes(16).toString("hex");
    await query(
      `INSERT INTO staff_local_recovery(subject,code_hash,created_at)
       VALUES(?,?,UTC_TIMESTAMP(3))`,
      [user.subject, digest(`staff-recovery:${user.subject}:${raw}`)], c
    );
    codes.push(raw.match(/.{4}/g).join("-"));
  }
  return codes;
}

export async function notify(c, user, text) {
  await queue(c, "security:" + newId(), {
    to: decrypt(user.email_enc).email,
    subject: "Staff account security update",
    text: text + "\n\nIf unexpected, contact your practice administrator."
  });
}

export async function issueToken(c, user, purpose, targetEmail = null) {
  // LOCAL_RESET_COOLDOWN
  if (purpose === "reset") {
    const [recent] = await query(
      `SELECT id FROM staff_local_tokens
       WHERE subject=? AND purpose='reset' AND auth_version=?
         AND used_at IS NULL AND expires_at>UTC_TIMESTAMP(3)
         AND created_at>DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE)
       LIMIT 1`,
      [user.subject, user.auth_version], c
    );
    if (recent) return;
  }
  const raw = randomSecret(), id = newId();
  const minutes = purpose === "invite" ? S.inviteHours * 60
    : purpose === "email" ? S.emailMinutes : S.resetMinutes;
  const target = targetEmail || decrypt(user.email_enc).email;
  const path = purpose === "invite" ? "activate"
    : purpose === "email" ? "verify-email" : "reset-password";

  await query(
    `UPDATE staff_local_tokens SET used_at=UTC_TIMESTAMP(3)
     WHERE subject=? AND purpose=? AND used_at IS NULL`,
    [user.subject, purpose], c
  );
  await query(
    `INSERT INTO staff_local_tokens
     (id,token_hash,subject,purpose,auth_version,target_email_hash,
      target_email_enc,expires_at,created_at)
     VALUES(?,?,?,?,?,?,?,
       DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? MINUTE),UTC_TIMESTAMP(3))`,
    [
      id, digest("staff-token:" + raw), user.subject, purpose, user.auth_version,
      purpose === "email" ? emailHash(target) : null,
      purpose === "email" ? encrypt({ email: target }) : null, minutes
    ], c
  );
  await queue(c, "staff-token:" + id, {
    to: target,
    subject: purpose === "invite" ? "Set up your staff account"
      : purpose === "email" ? "Verify your staff email" : "Reset your staff password",
    text: [
      "Use this single-use staff account link:",
      `${config.origin}/staff/${path}#token=${raw}`,
      `This link expires in ${minutes} minutes.`,
      "If you did not request this, do not use the link."
    ].join("\n\n")
  });
}

export async function readStaff(req, c, touch = true) {
  if (!S.enabled) fail("STAFF_DISABLED", "Staff access is disabled.", 503);
  // Every protected staff transaction takes this lock first.
  await lockSecurity(c);
  const raw = cookie(req, sessionCookie);
  if (!raw) return null;

  const [row] = await query(
    `SELECT s.*,u.display_name,u.enabled,u.issuer,
       u.auth_version AS current_version,l.password_hash,l.is_doctor,
       UTC_TIMESTAMP(3) AS database_now
     FROM staff_sessions s JOIN staff_users u ON u.subject=s.subject
     JOIN staff_local_credentials l ON l.subject=u.subject
     WHERE s.token_hash=? FOR UPDATE`,
    [digest("staff-session:" + raw)], c
  );
  if (!row) return null;
  const now = row.database_now.getTime();
  if (
    row.revoked_at || !row.enabled || !row.password_hash ||
    row.issuer !== S.issuer ||
    Number(row.auth_version) !== Number(row.current_version) ||
    row.mfa_policy_hash !== policy ||
    !Number.isFinite(row.expires_at.getTime()) ||
    !Number.isFinite(row.idle_expires_at.getTime()) ||
    row.expires_at.getTime() <= now || row.idle_expires_at.getTime() <= now
  ) return null;

  const idle = touch ? new Date(Math.min(
    row.expires_at.getTime(), now + S.idleMinutes * 60000
  )) : row.idle_expires_at;
  const ctx = {
    subject: row.subject, name: row.display_name,
    isDoctor: Boolean(row.is_doctor), sessionId: row.id,
    csrfToken: row.csrf_token, authenticatedAt: row.authenticated_at,
    grants: await query(
      `SELECT location_id AS locationId,provider_id AS providerId,role
       FROM staff_grants WHERE subject=? ORDER BY location_id,provider_id,role`,
      [row.subject], c
    ),
    remainingSeconds: Math.max(0, Math.floor(
      (Math.min(idle.getTime(), row.expires_at.getTime()) - now) / 1000
    ))
  };
  csrf(req, ctx);
  if (touch) await query(
    "UPDATE staff_sessions SET last_seen_at=?,idle_expires_at=? WHERE id=?",
    [new Date(now), idle, row.id], c
  );
  return ctx;
}

function send(res, data, seconds) {
  res.set("Cache-Control", "no-store");
  if (seconds !== undefined) res.set("X-Staff-Remaining-Seconds", String(seconds));
  res.json(data);
}

// Password hashing/checking happens outside database transactions.
// The credential/version snapshot is checked again before committing.
export function passwordRoute(router, path, schema, prepare, apply) {
  router.post(path, enabled, rateLimit("staff-confirm-password", 10, 900),
    async (req, res) => {
      const body = schema.parse(req.body);
      const snapshot = await transaction(async c => {
        const ctx = await readStaff(req, c, false);
        if (!ctx) fail("STAFF_SESSION_REQUIRED", "Sign in again.", 401);
        return { user: await localUser(c, ctx.subject) };
      });
      if (!await kdf(() => verifyPassword(body.currentPassword, snapshot.user.password_hash))) {
        fail("PASSWORD_CHECK_FAILED", "The current password could not be verified.", 403);
      }
      const prepared = await prepare(body);
      const result = await transaction(async c => {
        const ctx = await readStaff(req, c);
        if (!ctx) fail("STAFF_SESSION_REQUIRED", "Sign in again.", 401);
        const user = await localUser(c, ctx.subject);
        if (
          user.auth_version !== snapshot.user.auth_version ||
          user.password_hash !== snapshot.user.password_hash
        ) fail("ACCOUNT_CHANGED", "The account changed. Sign in again.", 409);
        return apply(c, ctx, user, body, prepared);
      });
      if (result.signedOut) clearCookie(res);
      send(res, result, result.signedOut ? 0 : undefined);
    });
}

async function tokenUser(c, raw, purpose) {
  const [token] = await query(
    `SELECT * FROM staff_local_tokens
     WHERE token_hash=? AND purpose=? AND used_at IS NULL
       AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE`,
    [digest("staff-token:" + raw), purpose], c
  );
  const user = token ? await localUser(c, token.subject) : null;
  if (!token || !user?.enabled ||
      Number(token.auth_version) !== Number(user.auth_version)) {
    fail("INVALID_LINK", "This link is invalid, expired, or already used.");
  }
  return { token, user };
}

async function savePassword(c, user, passwordHash, event) {
  await invalidate(c, user);
  await query(
    `UPDATE staff_local_credentials SET password_hash=?,updated_at=UTC_TIMESTAMP(3)
     WHERE subject=?`, [passwordHash, user.subject], c
  );
  await logSecurity(c, user, event);
  await notify(c, user,
    "Your staff password changed. Existing sessions and backup codes were revoked.");
}

export function mountAuth(router) {
  router.get("/auth/bootstrap", enabled, (req, res) => {
    const token = cookie(req, formCookie) || randomSecret();
    res.cookie(formCookie, token, { ...cookieOptions, maxAge: 15 * 60000 });
    send(res, { loginToken: token });
  });

  const publicPost = (path, schema, limit, handler) => {
    router.post(path, enabled, rateLimit("staff-public:" + path, limit, 900),
      async (req, res) => {
        publicCsrf(req);
        const body = schema.extend({ loginToken: hex }).strict().parse(req.body);
        await handler(req, res, body);
      });
  };

  publicPost("/auth/login", z.object({
    email: emailSchema, password: z.string().max(1024)
  }), 10, async (req, res, body) => {
    const candidate = await emailUser(body.email);
    const valid = await kdf(() => verifyPassword(body.password, candidate?.password_hash));
    if (!valid || !candidate?.enabled) {
      fail("LOGIN_FAILED", "Email or password could not be verified.", 401);
    }
    const raw = randomSecret(), csrfToken = randomSecret();
    await transaction(async c => {
      await lockSecurity(c);
      const user = await localUser(c, candidate.subject);
      if (!user?.enabled || user.password_hash !== candidate.password_hash ||
          user.auth_version !== candidate.auth_version) {
        fail("LOGIN_FAILED", "Email or password could not be verified.", 401);
      }
      const now = await databaseDate(c);
      const old = cookie(req, sessionCookie);
      if (old) await query(
        "UPDATE staff_sessions SET revoked_at=? WHERE token_hash=?",
        [now, digest("staff-session:" + old)], c
      );
      await query(
        `INSERT INTO staff_sessions
         (id,token_hash,subject,auth_version,csrf_token,mfa_verified,
          mfa_policy_hash,authenticated_at,last_seen_at,idle_expires_at,
          expires_at,created_at)
         VALUES(?,?,?,?,?,0,?,?,?,?,?,?)`,
        [
          newId(), digest("staff-session:" + raw), user.subject,
          user.auth_version, csrfToken, policy, now, now,
          new Date(now.getTime() + S.idleMinutes * 60000),
          new Date(now.getTime() + S.absoluteHours * 3600000), now
        ], c
      );
      await logSecurity(c, user, "staff.local.signed_in");
    });
    res.cookie(sessionCookie, raw, {
      ...cookieOptions, maxAge: S.absoluteHours * 3600000
    });
    send(res, { configured: true });
  });

  router.get("/auth/session", async (req, res) => {
    if (!S.enabled) return send(res, { configured: false });
    const ctx = await transaction(c => readStaff(req, c, req.query.probe !== "1"));
    if (!ctx) {
      clearCookie(res);
      fail("STAFF_SESSION_REQUIRED", "Sign in again.", 401);
    }
    send(res, { configured: true, ...ctx }, ctx.remainingSeconds);
  });

  router.post("/auth/logout", enabled, async (req, res) => {
    await transaction(async c => {
      const ctx = await readStaff(req, c, false);
      if (!ctx) fail("STAFF_SESSION_REQUIRED", "Sign in again.", 401);
      await query(
        "UPDATE staff_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE id=?",
        [ctx.sessionId], c
      );
      await logSecurity(c, { subject: ctx.subject }, "staff.local.signed_out");
    });
    clearCookie(res);
    send(res, { message: "Signed out." }, 0);
  });

  publicPost("/auth/forgot", z.object({ email: emailSchema }), 5,
    async (req, res, body) => {
      const started = Date.now();
      await transaction(async c => {
        await lockSecurity(c);
        const [row] = await query(
          "SELECT subject FROM staff_local_credentials WHERE email_hash=?",
          [emailHash(body.email)], c
        );
        const user = row ? await localUser(c, row.subject) : null;
        if (user?.enabled && user.password_hash) await issueToken(c, user, "reset");
      });
      await delay(Math.max(0, 650 - (Date.now() - started)));
      send(res, {
        message: "If an eligible account exists, reset instructions will be sent."
      });
    });

  for (const [path, purpose] of [
    ["/auth/reset", "reset"], ["/auth/activate", "invite"]
  ]) publicPost(path, z.object({ token: hex, password: passwordSchema }), 5,
    async (req, res, body) => {
      const passwordHash = await kdf(() => hashPassword(body.password));
      await transaction(async c => {
        await lockSecurity(c);
        const { user } = await tokenUser(c, body.token, purpose);
        if (purpose === "invite" && user.password_hash) {
          fail("INVALID_LINK", "This setup link is no longer valid.");
        }
        await savePassword(c, user, passwordHash,
          purpose === "invite" ? "staff.local.activated" : "staff.local.password_reset");
      });
      clearCookie(res);
      send(res, {
        message: "Password saved. Sign in again, then generate new backup codes."
      });
    });

  publicPost("/auth/recover", z.object({
    email: emailSchema,
    code: z.string().max(100)
      .transform(s => s.replace(/[-\s]/g, "").toLowerCase())
      .refine(s => /^[a-f0-9]{32}$/.test(s)),
    password: passwordSchema
  }), 5, async (req, res, body) => {
    const candidate = await emailUser(body.email);
    const passwordHash = await kdf(() => hashPassword(body.password));
    await transaction(async c => {
      await lockSecurity(c);
      const user = candidate ? await localUser(c, candidate.subject) : null;
      const rows = user ? await query(
        `SELECT code_hash FROM staff_local_recovery
         WHERE subject=? AND code_hash=? FOR UPDATE`,
        [user.subject, digest(`staff-recovery:${user.subject}:${body.code}`)], c
      ) : [];
      if (!user?.enabled || !user.password_hash || !rows.length ||
          user.email_hash !== emailHash(body.email)) {
        fail("RECOVERY_FAILED", "The recovery details could not be verified.");
      }
      await savePassword(c, user, passwordHash, "staff.local.backup_recovery");
    });
    clearCookie(res);
    send(res, {
      message: "Password saved. All old backup codes were revoked. Sign in again."
    });
  });

  publicPost("/auth/verify-email", z.object({ token: hex }), 10,
    async (req, res, body) => {
      await transaction(async c => {
        await lockSecurity(c);
        const { token, user } = await tokenUser(c, body.token, "email");
        const [existing] = await query(
          "SELECT subject FROM staff_local_credentials WHERE email_hash=?",
          [token.target_email_hash], c
        );
        if (existing) fail("EMAIL_UNAVAILABLE", "This email change cannot be completed.");
        await invalidate(c, user);
        await query(
          `UPDATE staff_local_credentials
           SET email_hash=?,email_enc=?,updated_at=UTC_TIMESTAMP(3) WHERE subject=?`,
          [token.target_email_hash, token.target_email_enc, user.subject], c
        );
        await logSecurity(c, user, "staff.local.email_changed");
        await notify(c, user, "Your staff sign-in email changed.");
        await notify(c, { ...user, email_enc: token.target_email_enc },
          "This address is now your staff sign-in email.");
      });
      clearCookie(res);
      send(res, {
        message: "Email verified. Sessions and backup codes were revoked. Sign in again."
      });
    });

  const current = { currentPassword: z.string().max(1024) };

  passwordRoute(router, "/auth/reauth", z.object(current).strict(),
    async () => null, async (c, ctx) => {
      await query(
        "UPDATE staff_sessions SET authenticated_at=UTC_TIMESTAMP(3) WHERE id=?",
        [ctx.sessionId], c
      );
      return { message: "Identity confirmed for sensitive account changes." };
    });

  passwordRoute(router, "/auth/change-password",
    z.object({ ...current, password: passwordSchema }).strict(),
    body => kdf(() => hashPassword(body.password)),
    async (c, ctx, user, body, passwordHash) => {
      await savePassword(c, user, passwordHash, "staff.local.password_changed");
      return { message: "Password changed. Sign in again.", signedOut: true };
    });

  passwordRoute(router, "/auth/recovery-codes", z.object(current).strict(),
    async () => null, async (c, ctx, user) => {
      const codes = await recoveryCodes(c, user);
      await logSecurity(c, user, "staff.local.recovery_codes_rotated");
      await notify(c, user,
        "New backup codes were generated. Previous codes no longer work.");
      return {
        message: "Save these codes offline. They will not be shown again.", codes
      };
    });

  passwordRoute(router, "/auth/change-email",
    z.object({ ...current, email: emailSchema }).strict(),
    async () => null, async (c, ctx, user, body) => {
      const [existing] = await query(
        "SELECT subject FROM staff_local_credentials WHERE email_hash=?",
        [emailHash(body.email)], c
      );
      if (existing) fail("EMAIL_UNAVAILABLE", "This address cannot be used.");
      await issueToken(c, user, "email", body.email);
      await logSecurity(c, user, "staff.local.email_change_requested");
      await notify(c, user,
        "A staff sign-in email change was requested. Your current address remains active until verification.");
      return { message: "Verify the link sent to the new address." };
    });
}