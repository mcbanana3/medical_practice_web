import { z } from "zod";
import { query, encrypt, decrypt, newId, audit } from "../db.mjs";
import {
  S, PERMS, can, emailSchema, emailHash, fail, databaseDate,
  localUser, invalidate, issueToken, notify, logSecurity
} from "./auth.mjs";

const id = z.number().int().positive();
const subject = z.string().min(1).max(255);
const name = z.string().trim().min(1).max(100)
  .refine(s => !/[\x00-\x1f\x7f]/.test(s));
const roles = z.array(z.enum([
  "scheduler", "clinician", "administrator", "auditor"
])).max(4).refine(a => new Set(a).size === a.length);
const targetBody = z.object({
  subject, impactConfirmed: z.literal(true)
}).strict();

async function grants(c, target) {
  return query(
    `SELECT location_id AS locationId,provider_id AS providerId,role
     FROM staff_grants WHERE subject=?`, [target], c
  );
}

async function ownedPairs(c, target) {
  return query(
    `SELECT location_id AS locationId,provider_id AS providerId
     FROM staff_scopes WHERE subject=?
     UNION
     SELECT location_id AS locationId,provider_id AS providerId
     FROM staff_grants WHERE subject=?`,
    [target, target], c
  );
}

async function manageable(c, ctx, target) {
  const pairs = await ownedPairs(c, target);
  return pairs.length > 0 && pairs.every(p =>
    can(ctx, "access", p.locationId, p.providerId)
  );
}

async function fresh(c, ctx) {
  const age = (await databaseDate(c)).getTime() - ctx.authenticatedAt.getTime();
  if (age < 0 || age > 300000) {
    fail("FRESH_AUTH_REQUIRED", "Confirm your password in Account before this action.", 403);
  }
}

function grantable(ctx, requested, locationId, providerId) {
  if (requested.some(role =>
    !PERMS[role].every(permission => can(ctx, permission, locationId, providerId))
  )) fail("GRANT_DENIED", "You cannot grant capabilities you do not hold.", 403);
}

async function targetUser(c, ctx, target) {
  const user = await localUser(c, target);
  if (!user || !await manageable(c, ctx, target)) {
    fail("ACCOUNT_UNAVAILABLE", "This account is not manageable within your scope.", 404);
  }
  return user;
}

async function protectAdministrator(c, user, locationId, providerId) {
  if (!user.enabled || !user.password_hash) return;
  const [own] = await query(
    `SELECT subject FROM staff_grants
     WHERE subject=? AND location_id=? AND provider_id=? AND role='administrator'`,
    [user.subject, locationId, providerId], c
  );
  if (!own) return;
  const rows = await query(
    `SELECT g.subject FROM staff_grants g
     JOIN staff_users u ON u.subject=g.subject
     JOIN staff_local_credentials l ON l.subject=u.subject
     WHERE g.location_id=? AND g.provider_id=? AND g.role='administrator'
       AND u.enabled=1 AND u.issuer=? AND l.password_hash IS NOT NULL`,
    [locationId, providerId, S.issuer], c
  );
  if (rows.length <= 1) {
    fail("LAST_ADMIN", "Keep another activated administrator for this location/provider.");
  }
}

async function syncScope(c, target, locationId, providerId, requested) {
  await query(
    `INSERT INTO staff_scopes
     (subject,location_id,provider_id,can_decide,revoked_at)
     VALUES(?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       can_decide=VALUES(can_decide),revoked_at=VALUES(revoked_at)`,
    [
      target, locationId, providerId,
      requested.some(r => PERMS[r].includes("decide")) ? 1 : 0,
      requested.length ? null : await databaseDate(c)
    ], c
  );
}

async function cooldown(c, user, purpose) {
  const [recent] = await query(
    `SELECT id FROM staff_local_tokens
     WHERE subject=? AND purpose=?
       AND created_at>DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE) LIMIT 1`,
    [user.subject, purpose], c
  );
  if (recent) fail("EMAIL_COOLDOWN", "Wait ten minutes before sending another account email.", 429);
}

export function mountLocalAccounts({ add, need, scopeSQL }) {
  add("get", "/account", async (req, ctx, c) => {
    const user = await localUser(c, ctx.subject);
    return {
      displayName: user.display_name,
      email: decrypt(user.email_enc).email,
      isDoctor: Boolean(user.is_doctor)
    };
  });

  add("post", "/account/name", async (req, ctx, c) => {
    const body = z.object({ displayName: name }).strict().parse(req.body);
    await query(
      "UPDATE staff_users SET display_name=? WHERE subject=?",
      [body.displayName, ctx.subject], c
    );
    await logSecurity(c, { subject: ctx.subject }, "staff.local.name_changed");
    return { message: "Display name saved. The header updates on the next session check." };
  });

  add("get", "/access", async (req, ctx, c) => {
    if (!can(ctx, "access")) fail("ACCESS_DENIED", "Access denied.", 403);
    const q = z.object({ q: emailSchema.optional() }).strict().parse(req.query);
    const scope = scopeSQL(ctx, "access", "g");
    const users = await query(
      `SELECT u.subject,u.display_name,u.enabled,l.email_enc,
         l.password_hash IS NULL AS pending,l.is_doctor
       FROM staff_users u JOIN staff_local_credentials l ON l.subject=u.subject
       WHERE u.issuer=?
         AND EXISTS(
           SELECT 1 FROM staff_scopes g
           WHERE g.subject=u.subject AND (${scope.sql})
         )
         ${q.q ? "AND l.email_hash=?" : ""}
       ORDER BY u.display_name,u.subject LIMIT 201`,
      [S.issuer, ...scope.params, ...(q.q ? [emailHash(q.q)] : [])], c
    );
    const items = [];
    for (const user of users.slice(0, 200)) {
      const assigned = await grants(c, user.subject);
      items.push({
        subject: user.subject, displayName: user.display_name,
        email: decrypt(user.email_enc).email,
        enabled: Boolean(user.enabled), pending: Boolean(user.pending),
        isDoctor: Boolean(user.is_doctor),
        manageable: await manageable(c, ctx, user.subject),
        grants: assigned.filter(g => can(ctx, "access", g.locationId, g.providerId))
      });
    }
    return { items, truncated: users.length > 200 };
  });

  add("post", "/access/invite", async (req, ctx, c) => {
    const body = z.object({
      email: emailSchema, displayName: name, locationId: id, providerId: id,
      roles: roles.refine(a => a.length > 0),
      impactConfirmed: z.literal(true)
    }).strict().parse(req.body);
    await fresh(c, ctx);
    need(ctx, "access", body.locationId, body.providerId);
    grantable(ctx, body.roles, body.locationId, body.providerId);
    const [pair] = await query(
      "SELECT location_id FROM booking_options WHERE location_id=? AND provider_id=? LIMIT 1",
      [body.locationId, body.providerId], c
    );
    if (!pair) fail("PAIR_UNAVAILABLE", "Choose an existing booking resource pair.");
    const [existing] = await query(
      "SELECT subject FROM staff_local_credentials WHERE email_hash=?",
      [emailHash(body.email)], c
    );
    if (existing) fail("EMAIL_UNAVAILABLE", "This address cannot be invited as a new account.");
    const target = "local:" + newId();
    await query(
      `INSERT INTO staff_users
       (subject,issuer,display_name,enabled,auth_version,created_at)
       VALUES(?,?,?,1,1,UTC_TIMESTAMP(3))`,
      [target, S.issuer, body.displayName], c
    );
    await query(
      `INSERT INTO staff_local_credentials
       (subject,email_hash,email_enc,password_hash,is_doctor,created_at,updated_at)
       VALUES(?,?,?,NULL,0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
      [target, emailHash(body.email), encrypt({ email: body.email })], c
    );
    for (const role of body.roles) await query(
      "INSERT INTO staff_grants(subject,location_id,provider_id,role) VALUES(?,?,?,?)",
      [target, body.locationId, body.providerId, role], c
    );
    await syncScope(c, target, body.locationId, body.providerId, body.roles);
    const user = await localUser(c, target);
    await issueToken(c, user, "invite");
    await logSecurity(c, user, "staff.local.invited", ctx.subject);
    return { message: "Account created. The setup email is queued for delivery." };
  });

  add("post", "/access", async (req, ctx, c) => {
    const body = z.object({
      subject, displayName: name, locationId: id, providerId: id, roles,
      impactConfirmed: z.literal(true)
    }).strict().parse(req.body);
    await fresh(c, ctx);
    const user = await targetUser(c, ctx, body.subject);
    need(ctx, "access", body.locationId, body.providerId);
    grantable(ctx, body.roles, body.locationId, body.providerId);
    const [pair] = await query(
      "SELECT location_id FROM booking_options WHERE location_id=? AND provider_id=? LIMIT 1",
      [body.locationId, body.providerId], c
    );
    if (!pair) fail("PAIR_UNAVAILABLE", "Choose an existing booking pair.");
    if (!body.roles.includes("administrator")) {
      await protectAdministrator(c, user, body.locationId, body.providerId);
    }
    await logSecurity(c, user, "staff.local.access_change_started", ctx.subject);
    await invalidate(c, user);
    await query(
      "UPDATE staff_users SET display_name=? WHERE subject=?",
      [body.displayName, user.subject], c
    );
    await query(
      "DELETE FROM staff_grants WHERE subject=? AND location_id=? AND provider_id=?",
      [user.subject, body.locationId, body.providerId], c
    );
    for (const role of body.roles) await query(
      "INSERT INTO staff_grants(subject,location_id,provider_id,role) VALUES(?,?,?,?)",
      [user.subject, body.locationId, body.providerId, role], c
    );
    await syncScope(c, user.subject, body.locationId, body.providerId, body.roles);
    await audit(c, null, ctx.subject, "staff.local.access_changed", {
      locationId: body.locationId, providerId: body.providerId,
      rolesAfter: body.roles
    });
    const updated = await localUser(c, user.subject);
    if (updated.enabled && !updated.password_hash) await issueToken(c, updated, "invite");
    await notify(c, updated,
      "Your staff access changed. Existing sessions and backup recovery codes were revoked.");
    return {
      message: "Access saved. Target sessions and backup codes were revoked.",
      signedOut: user.subject === ctx.subject
    };
  });

  for (const action of ["disable", "enable", "resend", "reset"]) {
    add("post", "/access/" + action, async (req, ctx, c) => {
      const body = targetBody.parse(req.body);
      await fresh(c, ctx);
      const user = await targetUser(c, ctx, body.subject);
      const assigned = await grants(c, user.subject);

      if (action === "disable") {
        for (const g of assigned) {
          if (g.role === "administrator") {
            await protectAdministrator(c, user, g.locationId, g.providerId);
          }
        }
        await invalidate(c, user);
        await query("UPDATE staff_users SET enabled=0 WHERE subject=?", [user.subject], c);
        await query(
          "UPDATE staff_scopes SET revoked_at=UTC_TIMESTAMP(3) WHERE subject=?",
          [user.subject], c
        );
      } else if (action === "enable") {
        if (!assigned.length) fail("NO_GRANTS", "Assign a resource grant before enabling.");
        for (const g of assigned) grantable(ctx, [g.role], g.locationId, g.providerId);
        await invalidate(c, user);
        await query("UPDATE staff_users SET enabled=1 WHERE subject=?", [user.subject], c);
        for (const p of await ownedPairs(c, user.subject)) {
          await syncScope(c, user.subject, p.locationId, p.providerId,
            assigned.filter(g => g.locationId === p.locationId &&
              g.providerId === p.providerId).map(g => g.role));
        }
        const updated = await localUser(c, user.subject);
        if (!updated.password_hash) await issueToken(c, updated, "invite");
      } else {
        if (!user.enabled || (action === "resend" ? user.password_hash : !user.password_hash)) {
          fail("ACCOUNT_STATE", "This action is not available for this account.");
        }
        const purpose = action === "resend" ? "invite" : "reset";
        await cooldown(c, user, purpose);
        await issueToken(c, user, purpose);
      }
      await logSecurity(c, user, "staff.local.account_" + action, ctx.subject);
      if (["disable", "enable"].includes(action)) {
        await notify(c, user, "Your staff account access status changed.");
      }
      return {
        message: "Account action saved. Any associated email is queued for delivery.",
        signedOut: ["disable", "enable"].includes(action) && user.subject === ctx.subject
      };
    });
  }
}