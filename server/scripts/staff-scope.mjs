import { pool, query } from "../src/db.mjs";

const [action, subject, locationValue, providerValue] = process.argv.slice(2);
const locationId = Number(locationValue);
const providerId = Number(providerValue);

if (
  !["grant", "revoke"].includes(action) ||
  !subject ||
  subject.length > 255 ||
  !Number.isInteger(locationId) ||
  !Number.isInteger(providerId) ||
  locationId < 1 ||
  providerId < 1
) {
  throw new Error(
    "Usage: npm run staff-scope -- grant|revoke OIDC_SUB LOCATION_ID PROVIDER_ID"
  );
}

try {
  if (action === "grant") {
    await query(
      `INSERT INTO staff_scopes
        (subject, location_id, provider_id, can_decide, revoked_at)
       VALUES (?, ?, ?, 1, NULL)
       ON DUPLICATE KEY UPDATE can_decide=1, revoked_at=NULL`,
      [subject, locationId, providerId]
    );
  } else {
    await query(
      `UPDATE staff_scopes SET revoked_at=UTC_TIMESTAMP(3)
       WHERE subject=? AND location_id=? AND provider_id=?`,
      [subject, locationId, providerId]
    );
  }

  console.log(`Scoped access ${action} completed.`);
} finally {
  await pool.end();
}