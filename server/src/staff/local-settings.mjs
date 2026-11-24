import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

dotenv.config({
  path: fileURLToPath(new URL("../../.env.staff", import.meta.url)),
  override: false
});

function integer(name, fallback, min, max) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid staff setting: ${name}`);
  }
  return value;
}

const enabled = process.env.STAFF_LOCAL_ENABLED ?? "false";
if (!["true", "false"].includes(enabled)) {
  throw new Error("STAFF_LOCAL_ENABLED must be true or false.");
}

export const S = Object.freeze({
  enabled: enabled === "true",
  issuer: "urn:medical-practice:staff:local:v1",
  idleMinutes: integer("STAFF_LOCAL_IDLE_MINUTES", 15, 5, 60),
  absoluteHours: integer("STAFF_LOCAL_ABSOLUTE_HOURS", 8, 1, 12),
  resetMinutes: integer("STAFF_LOCAL_RESET_MINUTES", 20, 5, 60),
  inviteHours: integer("STAFF_LOCAL_INVITE_HOURS", 24, 1, 72),
  emailMinutes: integer("STAFF_LOCAL_EMAIL_MINUTES", 30, 5, 60)
});