import { setTimeout as wait } from "node:timers/promises";
import { pool } from "./db.mjs";
import { expireHolds } from "./requests.mjs";
import {
  createMailTransport, deliverOne
} from "./notifications.mjs";

const transport = createMailTransport();
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => { stopping = true; });
}

while (!stopping) {
  try {
    await expireHolds();
    await deliverOne(transport);
  } catch {
    console.error("WORKER_OPERATION_FAILED");
  }

  await wait(1000);
}

transport.close();
await pool.end();