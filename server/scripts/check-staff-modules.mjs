const checks = [
  [
    "../src/staff/auth.mjs",
    ["can", "readStaff", "csrf", "mountAuth", "clearCookie"]
  ],
  ["../src/staff/operations.mjs", ["mountOperations"]],
  ["../src/staff/management.mjs", ["mountManagement"]],
  ["../src/staff/local-accounts.mjs", ["mountLocalAccounts"]],
  ["../src/staff/index.mjs", ["createStaffRouter"]]
];

let failed = false;

for (const [file, names] of checks) {
  try {
    const module = await import(file);

    for (const name of names) {
      if (typeof module[name] !== "function") {
        throw new Error(`Missing named function export: ${name}`);
      }
    }

    console.log("OK " + file);
  } catch (error) {
    failed = true;
    console.error("FAILED " + file);
    console.error(error.message);
  }
}

if (!failed) {
  try {
    const { createStaffRouter } = await import("../src/staff/index.mjs");
    createStaffRouter();
    console.log("OK staff route registration");
  } catch (error) {
    failed = true;
    console.error("FAILED staff route registration");
    console.error(error.message);
  }
}

try {
  const { pool } = await import("../src/db.mjs");
  await pool.end();
} catch {
  failed = true;
  console.error("Database module configuration could not be completed.");
}

process.exitCode = failed ? 1 : 0;