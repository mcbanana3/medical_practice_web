import { setTimeout as wait } from "node:timers/promises";
import { pool } from "../db.mjs";
import { createMailTransport } from "../notifications.mjs";
import { deliverAccountMail } from "./mail.mjs";

const transport = createMailTransport();
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => { stopping = true; });
}

while (!stopping) {
  try {
    await deliverAccountMail(transport);
  } catch {
    console.error("ACCOUNT_MAIL_OPERATION_FAILED");
  }
  await wait(1000);
}

transport.close();
await pool.end();