import { z } from "zod";
import { query, decrypt, digest, audit } from "../db.mjs";
import { config } from "../config.mjs";
import { databaseNow } from "../scheduling.mjs";

export function mountAdmin({ add, need, scopeSQL }) {
  add("get", "/dashboard", async (req, ctx, c) => {
    const scope = scopeSQL(ctx, "read");
    const now = (await databaseNow(c)).setZone(config.zone);
    const [counts] = await query(
      `SELECT SUM(r.status='pending') AS pending,
       SUM(r.status='approved' AND r.starts_at>=? AND r.starts_at<?) AS today,
       SUM(r.status IN ('pending','approved') AND r.starts_at>=?) AS upcoming
       FROM appointment_requests r WHERE (${scope.sql})`,
      [now.startOf("day").toUTC().toJSDate(), now.plus({days:1}).startOf("day").toUTC().toJSDate(), now.toJSDate(), ...scope.params], c);
    const reviewScope = scopeSQL(ctx, "reviews_moderate", "r");
    const [reviews] = await query(`SELECT COUNT(*) AS count FROM public_review_submissions r WHERE r.status='pending' AND (${reviewScope.sql})`, reviewScope.params, c);
    let patients = null;
    if (ctx.grants.some(g => g.role === "administrator")) {
      const [row] = await query("SELECT COUNT(*) AS count FROM patient_accounts WHERE disabled_at IS NULL AND email_verified_at IS NOT NULL", [], c);
      patients = Number(row.count);
    }
    return {todayDate:now.toISODate(),pending:Number(counts.pending || 0), today:Number(counts.today || 0), upcoming:Number(counts.upcoming || 0), reviews:Number(reviews.count), patients, clinicTimeZone:config.zone};
  });

  add("get", "/directory", async (req, ctx, c) => {
    need(ctx, "access");
    const q = z.object({offset:z.coerce.number().int().min(0).max(100000).default(0), q:z.string().trim().max(254).optional()}).strict().parse(req.query);
    const term = (q.q || "").toLowerCase();
    const byReference = /^[a-f0-9]{32}$/.test(term);
    const byEmail = z.string().email().safeParse(term).success;
    const paged = !term || byReference || byEmail;
    const condition = byReference ? "WHERE id=?" : byEmail ? "WHERE email_hash=?" : "";
    const params = byReference ? [term] : byEmail ? [digest("patient-email:" + term)] : [];
    // Browse all accounts with SQL pagination. Encrypted name searches are bounded;
    // exact email/reference lookups can always find older records.
    const rows = await query(
      `SELECT id,profile_enc,created_at,email_verified_at,disabled_at FROM patient_accounts ${condition} ORDER BY created_at DESC,id LIMIT ? OFFSET ?`,
      [...params, paged ? 51 : 10001, paged ? q.offset : 0], c);
    const matches = rows.map(row => {
      const profile = decrypt(row.profile_enc);
      return {reference:row.id, displayName:profile.displayName || "", email:profile.email, verified:Boolean(row.email_verified_at), disabled:Boolean(row.disabled_at), createdAt:row.created_at};
    }).filter(row => paged || [row.reference,row.displayName,row.email].some(value => String(value).toLowerCase().includes(term)));
    await audit(c, null, ctx.subject, "admin.patient_directory.viewed", {offset:q.offset});
    const start = paged ? 0 : q.offset;
    return {items:matches.slice(start,start+50), nextOffset:matches.length>start+50?q.offset+50:null, truncated:!paged && rows.length>10000};
  });

  add("get", "/practice", async (req, ctx, c) => {
    need(ctx, "settings");
    const scope = scopeSQL(ctx, "settings", "b");
    const providers = await query(`SELECT DISTINCT p.id,p.name,l.name AS location FROM booking_options b JOIN providers p ON p.id=b.provider_id JOIN locations l ON l.id=b.location_id WHERE (${scope.sql}) ORDER BY p.name`, scope.params, c);
    return {providers, clinicTimeZone:config.zone, appointmentMinutes:30};
  });
}
