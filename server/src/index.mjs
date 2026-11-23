import { config } from "./config.mjs";
import { pool, query } from "./db.mjs";
import { createApplication } from "./application.mjs";

await query("SELECT 1");

const server = createApplication().listen(config.port, () => {
  console.log(`Practice API listening on port ${config.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  });
}