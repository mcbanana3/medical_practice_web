import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db.mjs";

const directory = fileURLToPath(new URL("../migrations/", import.meta.url));
const connection = await pool.getConnection();

try {
  const [[lock]] = await connection.execute(
    "SELECT GET_LOCK('medical_booking_migrations', 30) AS acquired"
  );

  if (Number(lock.acquired) !== 1) throw new Error("Migration lock unavailable");

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(120) PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at DATETIME(3) NOT NULL
    ) ENGINE=InnoDB
  `);

  const files = (await fs.readdir(directory))
    .filter((name) => /^\d+.*\.sql$/.test(name)).sort();

  for (const filename of files) {
    const sql = await fs.readFile(path.join(directory, filename), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");

    const [existing] = await connection.execute(
      "SELECT checksum FROM schema_migrations WHERE version = ?",
      [filename]
    );

    if (existing.length) {
      if (existing[0].checksum !== checksum) {
        throw new Error(`Migration checksum changed: ${filename}`);
      }
      continue;
    }

    // These migrations contain no stored procedures or semicolons in strings.
    // MySQL DDL auto-commits; CREATE IF NOT EXISTS permits safe restart.
    for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) {
      await connection.query(statement);
    }

    await connection.execute(
      `INSERT INTO schema_migrations VALUES (?, ?, UTC_TIMESTAMP(3))`,
      [filename, checksum]
    );

    console.log(`Applied ${filename}`);
  }
} finally {
  await connection.execute(
    "SELECT RELEASE_LOCK('medical_booking_migrations')"
  ).catch(() => {});
  connection.release();
  await pool.end();
}