import "dotenv/config";
import { DateTime } from "luxon";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing configuration: ${name}`);
  return value;
}

function integer(name, minimum, maximum) {
  const value = Number(required(name));

  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid integer configuration: ${name}`);
  }

  return value;
}

function boolean(name) {
  const value = required(name);
  if (!["true", "false"].includes(value)) {
    throw new Error(`Invalid boolean configuration: ${name}`);
  }
  return value === "true";
}

function key(name) {
  const value = Buffer.from(required(name), "base64");
  if (value.length !== 32) {
    throw new Error(`${name} must contain 32 random bytes encoded as base64`);
  }
  return value;
}

function email(name) {
  const value = required(name);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error(`Invalid email configuration: ${name}`);
  }
  return value;
}

const environment = required("NODE_ENV");
const production = environment === "production";
const zone = required("CLINIC_TIME_ZONE");

if (!DateTime.now().setZone(zone).isValid) {
  throw new Error("CLINIC_TIME_ZONE must be a valid IANA time zone");
}

export const config = {
  environment,
  production,
  port: integer("PORT", 1, 65535),
  origin: required("FRONTEND_ORIGIN").replace(/\/$/, ""),
  proxyHops: integer("TRUST_PROXY_HOPS", 0, 10),

  db: {
    host: required("DB_HOST"),
    port: integer("DB_PORT", 1, 65535),
    database: required("DB_NAME"),
    user: required("DB_USER"),
    password: required("DB_PASSWORD"),
    connectionLimit: integer("DB_POOL_SIZE", 1, 100),
    tls: boolean("DB_TLS"),
    caFile: process.env.DB_CA_FILE?.trim() || ""
  },

  dataKey: key("DATA_ENCRYPTION_KEY"),
  hmacKey: key("HMAC_KEY"),

  enabled: boolean("BOOKING_ENABLED"),
  fixtures: boolean("DEV_FIXTURES"),
  practiceVerified: boolean("PRACTICE_CONFIG_VERIFIED"),
  identityApproved: boolean("MINIMUM_IDENTITY_FIELDS_APPROVED"),
  zone,
  leadMinutes: integer("MIN_LEAD_MINUTES", 0, 525600),
  horizonDays: integer("BOOKING_HORIZON_DAYS", 1, 365),
  capacity: integer("SLOT_CAPACITY", 1, 1),
  support: required("PUBLIC_SUPPORT_CONTACT"),

  rateLimit: integer("BOOKING_RATE_LIMIT", 1, 1000),
  rateWindowSeconds: integer("BOOKING_RATE_WINDOW_SECONDS", 10, 86400),

  captchaSecret: required("RECAPTCHA_SECRET"),
  captchaHosts: required("RECAPTCHA_ALLOWED_HOSTS")
    .split(",").map((host) => host.trim().toLowerCase()).filter(Boolean),

  smtpUrl: required("SMTP_URL"),
  emailFrom: email("EMAIL_FROM"),
  adminEmail: email("ADMIN_NOTIFICATION_EMAIL"),
  messageDomain: required("MESSAGE_ID_DOMAIN"),
  emailAttempts: integer("EMAIL_MAX_ATTEMPTS", 1, 20),

  oidcIssuer: process.env.OIDC_ISSUER?.trim() || "",
  oidcAudience: process.env.OIDC_AUDIENCE?.trim() || "",
  oidcJwks: process.env.OIDC_JWKS_URL?.trim() || ""
};

if (!/^[a-z0-9.-]+$/i.test(config.messageDomain)) {
  throw new Error("Invalid MESSAGE_ID_DOMAIN");
}

const oidcValues = [
  config.oidcIssuer,
  config.oidcAudience,
  config.oidcJwks
];

if (oidcValues.some(Boolean) && !oidcValues.every(Boolean)) {
  throw new Error("Configure all OIDC variables together");
}

if (config.oidcJwks && new URL(config.oidcJwks).protocol !== "https:") {
  throw new Error("OIDC_JWKS_URL must use HTTPS");
}

if (production) {
  if (
    config.fixtures ||
    !config.practiceVerified ||
    !config.identityApproved ||
    !config.db.tls ||
    !config.origin.startsWith("https:") ||
    config.support.includes("[PLACEHOLDER:") ||
    config.emailFrom.endsWith(".test") ||
    config.adminEmail.endsWith(".test") ||
    config.captchaHosts.some((host) => ["localhost", "127.0.0.1"].includes(host))
  ) {
    throw new Error("Production configuration requires verified, non-fixture settings");
  }
}