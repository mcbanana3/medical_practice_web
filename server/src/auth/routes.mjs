import express from "express";
import cors from "cors";
import helmet from "helmet";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { mountPatientRecords } from "../patient-records.mjs";
import { validEmail } from "../../../shared/contact.js";
import { phoneSchema } from "../phone.mjs";

import { config } from "../config.mjs";
import {
  audit, decrypt, digest, encrypt, newId,
  pool, query, SafeError, transaction
} from "../db.mjs";
import {
  rateLimit, requireStaff, verifyCaptcha, verifyStaff
} from "../security.mjs";
import {
  createRequest, lookupSubmissionReceipt
} from "../requests.mjs";
import { authSettings as settings } from "./settings.mjs";
import { hashPassword, checkPassword } from "./passwords.mjs";
import {
  clearSessionCookie, csrf, issueSession, lockPatient,
  publicPatient, readSession, requirePatient, secret
} from "./sessions.mjs";
import { queueAccountMail } from "./mail.mjs";

const emailSchema = z.string().trim().email().max(254)
  .refine(validEmail, "Enter a valid email address.")
  .transform((value) => value.toLowerCase());
const passwordSchema = z.string().min(8).max(128);
const captchaSchema = z.string().min(1).max(4096);
const referenceSchema = z.string().regex(/^[a-f0-9]{32}$/);
const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);

const googleClient = new OAuth2Client(settings.googleClientId);

async function defaultGoogleVerifier(credential) {
  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: settings.googleClientId
  });
  return ticket.getPayload();
}

const genericAccountMessage =
  "If this action can proceed, an email will provide the next step.";

async function emailQuota(email) {
  const bucket = Math.floor(Date.now() / 3600000);
  const key = digest(`account-email:${email}:${bucket}`);

  await query(
    `INSERT INTO rate_buckets VALUES
      (?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 2 HOUR), 1)
     ON DUPLICATE KEY UPDATE hits=hits+1`,
    [key]
  );

  const [row] = await query(
    "SELECT hits FROM rate_buckets WHERE bucket_hash=?", [key]
  );

  return row.hits <= 3;
}

async function issueToken(connection, patient, purpose) {
  const raw = secret();
  const minutes = purpose === "verify"
    ? settings.verifyMinutes : settings.resetMinutes;

  await query(
    `UPDATE patient_auth_tokens SET used_at=UTC_TIMESTAMP(3)
     WHERE patient_id=? AND purpose=? AND used_at IS NULL`,
    [patient.id, purpose], connection
  );

  await query(
    `INSERT INTO patient_auth_tokens
     VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE), NULL)`,
    [newId(), patient.id, purpose, digest(`auth-token:${raw}`), minutes],
    connection
  );

  const profile = decrypt(patient.profile_enc);
  const route = purpose === "verify" ? "verify" : "recovery";

  await queueAccountMail(
    connection, profile.email, purpose,
    `${config.origin}/portal/${route}#token=${raw}`
  );
}

async function tokenPatient(raw, purpose) {
  const [row] = await query(
    `SELECT p.* FROM patient_auth_tokens t
     JOIN patient_accounts p ON p.id=t.patient_id
     WHERE t.token_hash=? AND t.purpose=? AND t.used_at IS NULL
       AND t.expires_at>UTC_TIMESTAMP(3) AND p.disabled_at IS NULL`,
    [digest(`auth-token:${raw}`), purpose]
  );

  if (!row) {
    throw new SafeError(400, "INVALID_LINK", "This link is invalid or expired.");
  }
  return row;
}

async function consumeToken(connection, raw, purpose, patientId) {
  const result = await query(
    `UPDATE patient_auth_tokens SET used_at=UTC_TIMESTAMP(3)
     WHERE token_hash=? AND purpose=? AND patient_id=?
       AND used_at IS NULL AND expires_at>UTC_TIMESTAMP(3)`,
    [digest(`auth-token:${raw}`), purpose, patientId], connection
  );

  if (result.affectedRows !== 1) {
    throw new SafeError(400, "INVALID_LINK", "This link is invalid or expired.");
  }
}

function privateSubmissionKey(patientId, key) {
  const value = digest(`patient-booking:${patientId}:${key}`).slice(0, 32);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function patientRouter({
  captchaVerifier = verifyCaptcha,
  staffVerifier = verifyStaff,
  googleVerifier = defaultGoogleVerifier
} = {}) {
  const router = express.Router();

  router.use((request, response, next) => {
    const applies =
      request.path.startsWith("/api/auth/") ||
      request.path.startsWith("/api/portal/") ||
      request.path === "/api/staff/guest-links";

    if (!applies) return next("router");
    next();
  });

  router.use(helmet());
  router.use(cors({
    origin: config.origin,
    credentials: true,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "X-CSRF-Token", "Idempotency-Key", "Authorization"]
  }));
  router.use(express.json({ limit: "24kb" }));
  router.use((request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  router.use(readSession);
  router.use(rateLimit("patient-account-read", 120, 60));

  router.get("/api/auth/session", async (request, response) => {
    const session = request.patientSession || await transaction((connection) =>
      issueSession(connection, response, null, null, null)
    );

    response.json({
      patient: publicPatient(request.patient),
      csrfToken: session.csrf_token,
      googleClientId: settings.googleClientId,
      profileNameEditable: settings.profileEditable,
      supportContact: config.support
    });
  });

  router.use((request, response, next) => {
    if (
      request.method !== "POST" ||
      request.path === "/api/staff/guest-links"
    ) return next();
    csrf(request, response, next);
  });

  router.use("/api/auth", (request, response, next) => {
    if (request.method !== "POST") return next();
    return rateLimit(
      "patient-account-write", settings.rateLimit, settings.rateSeconds
    )(request, response, next);
  });

  router.post("/api/auth/register", async (request, response) => {
    const input = z.object({
      email: emailSchema,
      password: passwordSchema,
      displayName: z.string().trim().max(100).optional().default(""),
      captchaToken: captchaSchema
    }).strict().parse(request.body);

    await captchaVerifier(input.captchaToken);
    const passwordHash = await hashPassword(input.password);
    const allowed = await emailQuota(input.email);

    if (allowed) {
      try {
        await transaction(async (connection) => {
          const [existing] = await query(
            "SELECT * FROM patient_accounts WHERE email_hash=? FOR UPDATE",
            [digest(`patient-email:${input.email}`)], connection
          );

          if (existing) {
            if (!existing.disabled_at && !existing.email_verified_at) {
              await issueToken(connection, existing, "verify");
            } else if (!existing.disabled_at) {
              await queueAccountMail(connection, input.email, "notice");
            }
            return;
          }

          const patient = {
            id: newId(),
            profile_enc: encrypt({
              email: input.email, displayName: input.displayName
            })
          };

          await query(
            `INSERT INTO patient_accounts
             (id, email_hash, profile_enc, password_hash, auth_version, created_at)
             VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP(3))`,
            [
              patient.id, digest(`patient-email:${input.email}`),
              patient.profile_enc, passwordHash
            ], connection
          );

          await issueToken(connection, patient, "verify");
          await audit(connection, null, `patient:${patient.id}`, "patient.registered");
        });
      } catch (error) {
        if (error.code !== "ER_DUP_ENTRY") throw error;
      }
    }

    response.status(202).json({ message: genericAccountMessage });
  });

  router.post("/api/auth/login", async (request, response) => {
    const input = z.object({
      email: emailSchema,
      password: z.string().min(1).max(128),
      captchaToken: captchaSchema
    }).strict().parse(request.body);

    await captchaVerifier(input.captchaToken);

    const [patient] = await query(
      "SELECT * FROM patient_accounts WHERE email_hash=?",
      [digest(`patient-email:${input.email}`)]
    );

    const valid = await checkPassword(patient?.password_hash, input.password);

    if (!valid || patient.disabled_at || !patient.email_verified_at) {
      throw new SafeError(
        401, "SIGN_IN_FAILED",
        "We could not sign you in with those details. Check them or use recovery."
      );
    }

    const session = await transaction(async (connection) => {
      const [locked] = await query(
        "SELECT * FROM patient_accounts WHERE id=? FOR UPDATE",
        [patient.id], connection
      );

      if (
        locked.password_hash !== patient.password_hash ||
        locked.disabled_at ||
        !locked.email_verified_at
      ) throw new SafeError(401, "SIGN_IN_FAILED", "Sign-in could not be completed.");

      return issueSession(
        connection, response, locked, request.patientSession.id, "password"
      );
    });

    response.json({ ok: true, csrfToken: session.csrf_token });
  });

  router.post("/api/auth/recovery", async (request, response) => {
    const input = z.object({
      email: emailSchema, captchaToken: captchaSchema
    }).strict().parse(request.body);

    await captchaVerifier(input.captchaToken);
    const allowed = await emailQuota(input.email);

    if (allowed) {
      await transaction(async (connection) => {
        const [patient] = await query(
          `SELECT * FROM patient_accounts WHERE email_hash=?
           AND email_verified_at IS NOT NULL AND disabled_at IS NULL FOR UPDATE`,
          [digest(`patient-email:${input.email}`)], connection
        );
        if (patient) await issueToken(connection, patient, "reset");
      });
    }

    response.status(202).json({ message: genericAccountMessage });
  });

  router.post("/api/auth/verify-email", async (request, response) => {
    const input = z.object({
      token: tokenSchema, captchaToken: captchaSchema
    }).strict().parse(request.body);

    await captchaVerifier(input.captchaToken);
    const patient = await tokenPatient(input.token, "verify");

    await transaction(async (connection) => {
      await query(
        "SELECT id FROM patient_accounts WHERE id=? FOR UPDATE",
        [patient.id], connection
      );
      await consumeToken(connection, input.token, "verify", patient.id);
      await query(
        `UPDATE patient_accounts SET email_verified_at=UTC_TIMESTAMP(3)
         WHERE id=? AND email_verified_at IS NULL`,
        [patient.id], connection
      );
      await audit(connection, null, `patient:${patient.id}`, "patient.email.verified");
    });

    response.json({ message: "Email verified. You can now sign in." });
  });

  router.post("/api/auth/reset-password", async (request, response) => {
    const input = z.object({
      token: tokenSchema,
      newPassword: passwordSchema,
      captchaToken: captchaSchema
    }).strict().parse(request.body);

    await captchaVerifier(input.captchaToken);
    const patient = await tokenPatient(input.token, "reset");
    const passwordHash = await hashPassword(input.newPassword);

    await transaction(async (connection) => {
      await query(
        "SELECT id FROM patient_accounts WHERE id=? FOR UPDATE",
        [patient.id], connection
      );
      await consumeToken(connection, input.token, "reset", patient.id);

      await query(
        `UPDATE patient_accounts SET password_hash=?, auth_version=auth_version+1
         WHERE id=?`,
        [passwordHash, patient.id], connection
      );
      await query(
        `UPDATE patient_sessions SET revoked_at=UTC_TIMESTAMP(3)
         WHERE patient_id=? AND revoked_at IS NULL`,
        [patient.id], connection
      );
      await query(
        `UPDATE patient_auth_tokens SET used_at=UTC_TIMESTAMP(3)
         WHERE patient_id=? AND purpose='reset' AND used_at IS NULL`,
        [patient.id], connection
      );
      await queueAccountMail(
        connection, decrypt(patient.profile_enc).email, "notice"
      );
      await audit(connection, null, `patient:${patient.id}`, "patient.password.reset");
    });

    clearSessionCookie(response);
    response.json({ message: "Password updated. Sign in again on your devices." });
  });

  router.post("/api/auth/logout", async (request, response) => {
    await query(
      "UPDATE patient_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE id=?",
      [request.patientSession.id]
    );
    clearSessionCookie(response);
    response.json({ ok: true });
  });

  router.post("/api/auth/google/start", async (request, response) => {
    if (!settings.googleClientId) {
      throw new SafeError(503, "GOOGLE_UNAVAILABLE", "Google sign-in is not configured.");
    }

    const { purpose } = z.object({
      purpose: z.enum(["signin", "link", "reauth"])
    }).strict().parse(request.body);

    if (purpose !== "signin" && !request.patient) {
      throw new SafeError(401, "SESSION_REQUIRED", "Sign in again.");
    }

    const nonce = secret();

    await query(
      `UPDATE patient_sessions SET google_nonce_hash=?,
       google_nonce_expires_at=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 5 MINUTE),
       google_purpose=? WHERE id=? AND revoked_at IS NULL`,
      [digest(`google-nonce:${nonce}`), purpose, request.patientSession.id]
    );

    response.json({ nonce, clientId: settings.googleClientId });
  });

  router.post("/api/auth/google/complete", async (request, response) => {
    if (!settings.googleClientId) {
      throw new SafeError(503, "GOOGLE_UNAVAILABLE", "Google sign-in is not configured.");
    }

    const input = z.object({
      credential: z.string().min(1).max(12000),
      currentPassword: z.string().max(128).optional()
    }).strict().parse(request.body);

    let claims;

    try {
      claims = await googleVerifier(input.credential);
    } catch {
      throw new SafeError(401, "GOOGLE_FAILED", "Google sign-in could not be completed.");
    }

    if (
      !claims?.sub || claims.sub.length > 255 ||
      claims.email_verified !== true ||
      !["accounts.google.com", "https://accounts.google.com"].includes(claims.iss) ||
      typeof claims.nonce !== "string" ||
      (claims.azp && claims.azp !== settings.googleClientId)
    ) {
      throw new SafeError(401, "GOOGLE_FAILED", "Google sign-in could not be completed.");
    }

    const email = emailSchema.parse(claims.email);

    if (
      request.patientSession.google_purpose === "link" &&
      !await checkPassword(request.patient?.password_hash, input.currentPassword || "")
    ) {
      throw new SafeError(401, "REAUTH_REQUIRED", "Confirm your current password.");
    }

    await transaction(async (connection) => {
      const consumed = await query(
        `UPDATE patient_sessions SET google_nonce_hash=NULL
         WHERE id=? AND revoked_at IS NULL AND google_nonce_hash=?
           AND google_nonce_expires_at>UTC_TIMESTAMP(3)`,
        [request.patientSession.id, digest(`google-nonce:${claims.nonce}`)],
        connection
      );

      if (consumed.affectedRows !== 1) {
        throw new SafeError(401, "GOOGLE_FAILED", "Restart Google sign-in.");
      }

      const purpose = request.patientSession.google_purpose;

      if (purpose === "link" || purpose === "reauth") {
        if (!request.patient) {
          throw new SafeError(401, "SESSION_REQUIRED", "Sign in again.");
        }

        const patient = await lockPatient(request, connection);

        if (purpose === "reauth") {
          if (patient.google_sub !== claims.sub) {
            throw new SafeError(401, "GOOGLE_FAILED", "Use the linked Google identity.");
          }

          await query(
            `UPDATE patient_sessions SET last_auth_at=UTC_TIMESTAMP(3),
             last_auth_method='google' WHERE id=?`,
            [request.patientSession.id], connection
          );
        } else {
          if (patient.google_sub) {
            throw new SafeError(409, "GOOGLE_FAILED", "An identity is already linked.");
          }

          const [used] = await query(
            "SELECT id FROM patient_accounts WHERE google_sub=?",
            [claims.sub], connection
          );

          if (used) {
            throw new SafeError(409, "GOOGLE_FAILED", "This identity cannot be linked.");
          }

          await query(
            "UPDATE patient_accounts SET google_sub=? WHERE id=?",
            [claims.sub, patient.id], connection
          );
          await audit(connection, null, `patient:${patient.id}`, "patient.google.linked");
        }

        return;
      }

      if (purpose !== "signin") {
        throw new SafeError(401, "GOOGLE_FAILED", "Restart Google sign-in.");
      }

      let [patient] = await query(
        "SELECT * FROM patient_accounts WHERE google_sub=? FOR UPDATE",
        [claims.sub], connection
      );

      if (!patient) {
        const [sameEmail] = await query(
          "SELECT id FROM patient_accounts WHERE email_hash=?",
          [digest(`patient-email:${email}`)], connection
        );

        // Never merge a password account merely because Google has the same email.
        if (sameEmail) {
          throw new SafeError(
            409, "GOOGLE_FAILED",
            "Use your existing sign-in method, then explicitly link Google in account security."
          );
        }

        patient = {
          id: newId(),
          auth_version: 1,
          profile_enc: encrypt({
            email,
            displayName: String(claims.name || "").slice(0, 100)
          })
        };

        await query(
          `INSERT INTO patient_accounts
           (id, email_hash, profile_enc, google_sub, email_verified_at,
            auth_version, created_at)
           VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), 1, UTC_TIMESTAMP(3))`,
          [
            patient.id, digest(`patient-email:${email}`),
            patient.profile_enc, claims.sub
          ], connection
        );
      }

      if (patient.disabled_at) {
        throw new SafeError(401, "GOOGLE_FAILED", "Google sign-in could not be completed.");
      }

      await issueSession(
        connection, response, patient, request.patientSession.id, "google"
      );
    });

    response.json({ ok: true });
  });

  router.use("/api/portal", requirePatient);
  mountPatientRecords(router);

  router.get("/api/portal/overview", async (request, response) => {
    const rows = await query(
      `SELECT r.id AS reference, r.status, r.starts_at AS startsAt,
       l.name AS location, p.name AS provider, t.name AS appointmentType
       FROM patient_request_links o
       JOIN appointment_requests r ON r.id=o.request_id
       JOIN locations l ON l.id=r.location_id
       JOIN providers p ON p.id=r.provider_id
       JOIN appointment_types t ON t.id=r.type_id
       WHERE o.patient_id=? AND r.status IN ('pending','approved')
         AND r.ends_at>=UTC_TIMESTAMP(3)
       ORDER BY r.starts_at LIMIT 6`,
      [request.patient.id]
    );
    response.json({ items: rows, clinicTimeZone: config.zone });
  });

  router.get("/api/portal/appointments", async (request, response) => {
    const page = z.coerce.number().int().min(0).max(10000)
      .parse(request.query.page || 0);

    const rows = await query(
      `SELECT r.id AS reference, r.status, r.starts_at AS startsAt,
       l.name AS location, p.name AS provider, t.name AS appointmentType
       FROM patient_request_links o
       JOIN appointment_requests r ON r.id=o.request_id
       JOIN locations l ON l.id=r.location_id
       JOIN providers p ON p.id=r.provider_id
       JOIN appointment_types t ON t.id=r.type_id
       WHERE o.patient_id=?
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT 26 OFFSET ${page * 25}`,
      [request.patient.id]
    );

    response.json({
      items: rows.slice(0, 25),
      hasNext: rows.length > 25,
      clinicTimeZone: config.zone
    });
  });

  router.get("/api/portal/appointments/:reference", async (request, response) => {
    const reference = referenceSchema.safeParse(request.params.reference);

    const rows = reference.success ? await query(
      `SELECT r.id AS reference, r.status, r.starts_at AS startsAt,
       r.ends_at AS endsAt, r.expires_at AS holdExpiresAt,
       l.name AS location, p.name AS provider, t.name AS appointmentType
       FROM patient_request_links o
       JOIN appointment_requests r ON r.id=o.request_id
       JOIN locations l ON l.id=r.location_id
       JOIN providers p ON p.id=r.provider_id
       JOIN appointment_types t ON t.id=r.type_id
       WHERE o.patient_id=? AND r.id=?`,
      [request.patient.id, reference.data]
    ) : [];

    if (!rows.length) {
      throw new SafeError(404, "NOT_FOUND", "The appointment or request is unavailable.");
    }

    response.json({ ...rows[0], clinicTimeZone: config.zone });
  });

  router.post("/api/portal/profile", async (request, response) => {
    if (!settings.profileEditable) {
      throw new SafeError(403, "PROFILE_RESTRICTED", "Profile editing is not enabled.");
    }

    const { displayName } = z.object({
      displayName: z.string().trim().max(100)
    }).strict().parse(request.body);

    await transaction(async (connection) => {
      const patient = await lockPatient(request, connection);
      const profile = decrypt(patient.profile_enc);
      profile.displayName = displayName;

      await query(
        "UPDATE patient_accounts SET profile_enc=? WHERE id=?",
        [encrypt(profile), patient.id], connection
      );
      await audit(connection, null, `patient:${patient.id}`, "patient.profile.updated");
    });

    response.json({ message: "Profile updated." });
  });

  router.get("/api/portal/sessions", async (request, response) => {
    const items = await query(
      `SELECT id, created_at AS createdAt, last_seen_at AS lastSeenAt
       FROM patient_sessions
       WHERE patient_id=? AND auth_version=? AND revoked_at IS NULL
         AND expires_at>UTC_TIMESTAMP(3) AND idle_expires_at>UTC_TIMESTAMP(3)
       ORDER BY created_at DESC`,
      [request.patient.id, request.patient.auth_version]
    );

    response.json({
      items: items.map((item) => ({
        ...item, current: item.id === request.patientSession.id
      }))
    });
  });

  router.post("/api/portal/sessions/revoke", async (request, response) => {
    const { id } = z.object({ id: referenceSchema }).strict().parse(request.body);

    await transaction(async (connection) => {
      await lockPatient(request, connection);
      await query(
        `UPDATE patient_sessions SET revoked_at=UTC_TIMESTAMP(3)
         WHERE id=? AND patient_id=?`,
        [id, request.patient.id], connection
      );
      await audit(connection, null, `patient:${request.patient.id}`, "patient.session.revoked");
    });

    if (id === request.patientSession.id) clearSessionCookie(response);
    response.json({ ok: true });
  });

  router.post("/api/portal/sessions/revoke-all", async (request, response) => {
    await transaction(async (connection) => {
      await lockPatient(request, connection);
      await query(
        `UPDATE patient_sessions SET revoked_at=UTC_TIMESTAMP(3)
         WHERE patient_id=? AND revoked_at IS NULL`,
        [request.patient.id], connection
      );
      await audit(connection, null, `patient:${request.patient.id}`, "patient.sessions.revoked");
    });

    clearSessionCookie(response);
    response.json({ ok: true });
  });

  router.post("/api/portal/password", async (request, response) => {
    const input = z.object({
      currentPassword: z.string().max(128).optional().default(""),
      newPassword: passwordSchema,
      captchaToken: captchaSchema
    }).strict().parse(request.body);

    await captchaVerifier(input.captchaToken);

    const patient = request.patient;
    const googleFresh =
      request.patientSession.last_auth_method === "google" &&
      request.patientSession.last_auth_at &&
      Date.now() - request.patientSession.last_auth_at.getTime() < 300000;

    const valid = patient.password_hash
      ? await checkPassword(patient.password_hash, input.currentPassword)
      : googleFresh;

    if (!valid) {
      throw new SafeError(
        401, "REAUTH_REQUIRED",
        "Confirm your password, or reauthenticate with your linked Google identity."
      );
    }

    const passwordHash = await hashPassword(input.newPassword);

    await transaction(async (connection) => {
      const locked = await lockPatient(request, connection);
      if (locked.password_hash !== patient.password_hash) {
        throw new SafeError(409, "ACCOUNT_CHANGED", "Reload before trying again.");
      }

      await query(
        `UPDATE patient_accounts SET password_hash=?, auth_version=auth_version+1
         WHERE id=?`,
        [passwordHash, patient.id], connection
      );
      await query(
        `UPDATE patient_sessions SET revoked_at=UTC_TIMESTAMP(3)
         WHERE patient_id=? AND revoked_at IS NULL`,
        [patient.id], connection
      );

      await issueSession(
        connection, response,
        { ...locked, auth_version: locked.auth_version + 1 },
        null, "password"
      );
      await queueAccountMail(connection, decrypt(locked.profile_enc).email, "notice");
      await audit(connection, null, `patient:${patient.id}`, "patient.password.changed");
    });

    response.json({ message: "Password updated. Other sessions were revoked." });
  });

  router.post("/api/portal/google/unlink", async (request, response) => {
    const { currentPassword, captchaToken } = z.object({
      currentPassword: z.string().min(1).max(128),
      captchaToken: captchaSchema
    }).strict().parse(request.body);

    await captchaVerifier(captchaToken);

    if (!await checkPassword(request.patient.password_hash, currentPassword)) {
      throw new SafeError(401, "REAUTH_REQUIRED", "Confirm your current password.");
    }

    await transaction(async (connection) => {
      const patient = await lockPatient(request, connection);

      if (patient.password_hash !== request.patient.password_hash) {
        throw new SafeError(409, "ACCOUNT_CHANGED", "Reload before trying again.");
      }

      await query(
        "UPDATE patient_accounts SET google_sub=NULL WHERE id=?",
        [patient.id], connection
      );
      await audit(connection, null, `patient:${patient.id}`, "patient.google.unlinked");
    });

    response.json({ message: "Google identity unlinked. Password sign-in remains available." });
  });

  router.post("/api/portal/requests", async (request, response) => {
    if (!config.enabled) {
      throw new SafeError(503, "BOOKING_UNAVAILABLE", "Appointment requests are unavailable.");
    }

    const input = z.object({
      locationId: z.number().int().positive(),
      providerId: z.number().int().positive(),
      typeId: z.number().int().positive(),
      startsAt: z.string().datetime(),
      name: z.string().trim().min(1).max(100),
      email: emailSchema,
      phone: phoneSchema.refine(value => Boolean(value), "Phone is required."),
      reason: z.string().trim().min(1).max(1000),
      captchaToken: captchaSchema
    }).strict().parse(request.body);

    const key = z.string().uuid().parse(request.get("idempotency-key"));
    await captchaVerifier(input.captchaToken);

    const result = await transaction(async (connection) => {
      const patient = await lockPatient(request, connection);
      const profile = decrypt(patient.profile_enc);
      const { captchaToken, ...selection } = input;

      const created = await createRequest(
        { ...selection, email: profile.email },
        privateSubmissionKey(patient.id, key)
      );

      const [owner] = await query(
        "SELECT patient_id FROM patient_request_links WHERE request_id=? FOR UPDATE",
        [created.receipt.reference], connection
      );

      if (owner && owner.patient_id !== patient.id) {
        throw new SafeError(409, "OWNERSHIP_CONFLICT", "The request could not be linked.");
      }

      if (!owner) {
        await query(
          "INSERT INTO patient_request_links VALUES (?, ?, UTC_TIMESTAMP(3))",
          [created.receipt.reference, patient.id], connection
        );
        await audit(
          connection, created.receipt.reference,
          `patient:${patient.id}`, "request.account.created"
        );
      }

      return created;
    });

    response.status(result.replayed ? 200 : 201).json(result);
  });

  router.post("/api/portal/requests/receipt", async (request, response) => {
    const input = z.object({
      idempotencyKey: z.string().uuid(), captchaToken: captchaSchema
    }).strict().parse(request.body);

    await captchaVerifier(input.captchaToken);

    const receipt = await lookupSubmissionReceipt(
      privateSubmissionKey(request.patient.id, input.idempotencyKey)
    );

    const [owner] = await query(
      "SELECT request_id FROM patient_request_links WHERE request_id=? AND patient_id=?",
      [receipt.reference, request.patient.id]
    );

    if (!owner) {
      throw new SafeError(404, "NOT_FOUND", "The submission outcome is unavailable.");
    }

    response.json({ receipt });
  });

  router.post(
    "/api/staff/guest-links",
    requireStaff("appointments:link", staffVerifier),
    async (request, response) => {
      const input = z.object({
        requestReference: referenceSchema,
        patientReference: referenceSchema,
        identityVerificationConfirmed: z.literal(true)
      }).strict().parse(request.body);

      const code = secret();

      await transaction(async (connection) => {
        const [patient] = await query(
          `SELECT id FROM patient_accounts
           WHERE id=? AND email_verified_at IS NOT NULL AND disabled_at IS NULL
           FOR UPDATE`,
          [input.patientReference], connection
        );

        const [record] = await query(
          `SELECT r.id FROM appointment_requests r
           JOIN staff_scopes s
             ON s.location_id=r.location_id AND s.provider_id=r.provider_id
           WHERE r.id=? AND s.subject=? AND s.can_decide=1
             AND s.revoked_at IS NULL FOR UPDATE`,
          [input.requestReference, request.staff.sub], connection
        );

        if (!patient || !record) {
          throw new SafeError(404, "NOT_FOUND", "The resource is unavailable.");
        }

        const [owner] = await query(
          "SELECT request_id FROM patient_request_links WHERE request_id=?",
          [record.id], connection
        );

        if (owner) {
          throw new SafeError(409, "LINK_UNAVAILABLE", "The record cannot be linked.");
        }

        await query(
          `UPDATE patient_guest_link_codes SET used_at=UTC_TIMESTAMP(3)
           WHERE request_id=? AND used_at IS NULL`,
          [record.id], connection
        );

        await query(
          `INSERT INTO patient_guest_link_codes VALUES
           (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE), NULL, ?)`,
          [
            newId(), record.id, patient.id,
            digest(`guest-link:${code}`), settings.linkMinutes, request.staff.sub
          ], connection
        );

        await audit(connection, record.id, request.staff.sub, "request.link.authorized", {
          patientReference: patient.id,
          method: "practice_identity_check_completed"
        });
      });

      // Display once to authorized staff for an approved delivery process.
      response.status(201).json({ code, expiresInMinutes: settings.linkMinutes });
    }
  );

  router.post("/api/portal/link", async (request, response) => {
    const input = z.object({
      code: tokenSchema, captchaToken: captchaSchema
    }).strict().parse(request.body);

    await captchaVerifier(input.captchaToken);

    await transaction(async (connection) => {
      const patient = await lockPatient(request, connection);

      const [ticket] = await query(
        `SELECT * FROM patient_guest_link_codes
         WHERE token_hash=? AND patient_id=? AND used_at IS NULL
           AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE`,
        [digest(`guest-link:${input.code}`), patient.id], connection
      );

      if (!ticket) {
        throw new SafeError(400, "INVALID_LINK", "This linking code is invalid or expired.");
      }

      await query(
        "SELECT id FROM appointment_requests WHERE id=? FOR UPDATE",
        [ticket.request_id], connection
      );

      const [owner] = await query(
        "SELECT patient_id FROM patient_request_links WHERE request_id=?",
        [ticket.request_id], connection
      );

      if (owner && owner.patient_id !== patient.id) {
        throw new SafeError(400, "INVALID_LINK", "This linking code is unavailable.");
      }

      if (!owner) {
        await query(
          "INSERT INTO patient_request_links VALUES (?, ?, UTC_TIMESTAMP(3))",
          [ticket.request_id, patient.id], connection
        );
      }

      await query(
        "UPDATE patient_guest_link_codes SET used_at=UTC_TIMESTAMP(3) WHERE id=?",
        [ticket.id], connection
      );
      await audit(
        connection, ticket.request_id,
        `patient:${patient.id}`, "request.link.redeemed"
      );
    });

    response.json({ message: "The request is now linked to your account." });
  });

  router.use((error, request, response, next) => {
    if (response.headersSent) return next(error);

    const validation = error instanceof z.ZodError;
    const known = error instanceof SafeError;
    const malformed = ["entity.parse.failed", "entity.too.large"].includes(error.type);

    response.status(
      known ? error.status : validation || malformed ? 400 : 500
    ).json({
      error: {
        code: known ? error.code : validation ? "VALIDATION_ERROR" : "ACCOUNT_SERVICE_ERROR",
        message: known
          ? error.message
          : validation
            ? "Check the form fields. Passwords must contain 8–128 characters."
            : "The account operation could not be completed. Please try again."
      }
    });

    if (!known && !validation && !malformed) {
      console.error("PATIENT_ACCOUNT_OPERATION_FAILED");
    }
  });

  return router;
}