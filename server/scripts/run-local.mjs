import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../", import.meta.url));

const services = [
  ["API", "src/index.mjs"],
  ["Appointment email worker", "src/worker.mjs"],
  ["Account email worker", "src/auth/worker.mjs"]
];

const children = [];
let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;

  for (const child of children) {
    if (child.exitCode === null && !child.killed) {
      child.kill("SIGTERM");
    }
  }
}

for (const [name, filename] of services) {
  console.log("Starting " + name + "...");

  const child = spawn(process.execPath, [filename], {
    cwd,
    env: process.env,
    stdio: "inherit"
  });

  children.push(child);

  child.on("error", () => {
    console.error(name + " could not start.");
    stop(1);
  });

  child.on("exit", (code) => {
    if (!stopping) {
      console.error(
        name + " stopped. Check the error above. Stopping other services."
      );
      stop(code || 1);
    }
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));