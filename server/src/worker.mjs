import { setTimeout as wait } from "node:timers/promises";
import { pool } from "./db.mjs";
import { expireHolds } from "./requests.mjs";
import { createMailTransport, deliverOne } from "./notifications.mjs";
import { deliverCommunication } from "./staff/mail.mjs";

let stopping = false;
const sleep = new AbortController();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    sleep.abort();
  });
}

const transport = createMailTransport();

try {
  while (!stopping) {
    for (const task of [
      expireHolds,
      () => deliverOne(transport),
      () => deliverCommunication(transport)
    ]) {
      if (stopping) break;
      try {
        await task();
      } catch {
        console.error("BOOKING_WORKER_OPERATION_FAILED");
      }
    }

    if (!stopping) {
      await wait(1000, undefined, { signal: sleep.signal })
        .catch(error => {
          if (error.name !== "AbortError") throw error;
        });
    }
  }
} finally {
  transport.close?.();
  await pool.end();
}