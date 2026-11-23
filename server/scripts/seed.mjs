import { config } from "../src/config.mjs";
import { pool, query, transaction } from "../src/db.mjs";

if (
  config.production ||
  !config.fixtures ||
  !/_(dev|test)$/.test(config.db.database)
) {
  throw new Error("Seeds require DEV_FIXTURES=true and a _dev or _test database");
}

try {
  await transaction(async (connection) => {
    await query(
      `INSERT INTO locations VALUES (1, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      ["[DEVELOPMENT FIXTURE: location]",], connection
    );

    await query(
      `INSERT INTO providers VALUES (1, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      ["[DEVELOPMENT FIXTURE: provider]"], connection
    );

    for (const [id, minutes] of [[1, 20], [2, 40]]) {
      await query(
        `INSERT INTO appointment_types VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name), duration_minutes = VALUES(duration_minutes)`,
        [id, `[DEVELOPMENT FIXTURE: ${minutes}-minute type]`, minutes],
        connection
      );

      await query(
        `INSERT INTO booking_options VALUES (1, 1, ?, 1, 0, 1)
         ON DUPLICATE KEY UPDATE enabled=1, verified=0, is_demo=1`,
        [id], connection
      );
    }

    for (let weekday = 1; weekday <= 7; weekday += 1) {
      await query(
        `INSERT INTO weekly_windows
          (location_id, provider_id, weekday, open_time, close_time)
         VALUES (1, 1, ?, '09:00:00', '17:00:00')
         ON DUPLICATE KEY UPDATE close_time=VALUES(close_time)`,
        [weekday], connection
      );
    }
  });

  console.log("Development configuration fixtures installed. No patients seeded.");
} finally {
  await pool.end();
}