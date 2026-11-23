import dotenv from "dotenv";
import { config } from "../config.mjs";

dotenv.config({ path: ".env.auth", override: false });

function integer(name, minimum, maximum) {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid authentication setting: ${name}`);
  }
  return value;
}

function flag(name) {
  const value = process.env[name];
  if (!["true", "false"].includes(value)) {
    throw new Error(`Invalid authentication setting: ${name}`);
  }
  return value === "true";
}

const origin = new URL(config.origin);

if (
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash ||
  (config.production && origin.protocol !== "https:")
) {
  throw new Error("FRONTEND_ORIGIN must be an origin without a path");
}

export const authSettings = {
  idleMinutes: integer("SESSION_IDLE_MINUTES", 5, 240),
  absoluteHours: integer("SESSION_ABSOLUTE_HOURS", 1, 168),
  maxSessions: integer("MAX_ACTIVE_SESSIONS", 1, 20),
  verifyMinutes: integer("VERIFY_EMAIL_MINUTES", 5, 10080),
  resetMinutes: integer("RESET_PASSWORD_MINUTES", 5, 60),
  linkMinutes: integer("GUEST_LINK_MINUTES", 5, 60),
  rateLimit: integer("AUTH_RATE_LIMIT", 1, 1000),
  rateSeconds: integer("AUTH_RATE_WINDOW_SECONDS", 30, 86400),
  profileEditable: flag("PROFILE_NAME_EDITABLE"),
  recoveryApproved: flag("PATIENT_RECOVERY_POLICY_APPROVED"),
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || "",
  cookieName: config.production
    ? "__Host-medical_session"
    : "medical_session"
};

if (config.production && !authSettings.recoveryApproved) {
  throw new Error("Approve the patient recovery policy before production");
}