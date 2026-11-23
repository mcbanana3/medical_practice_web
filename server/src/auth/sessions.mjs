import { randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../config.mjs";
import { authSettings as settings } from "./settings.mjs";
import {
  audit, decrypt, digest, newId, query, SafeError
} from "../db.mjs";

export const secret = () => randomBytes(32).toString("hex");

const cookieOptions = {
  httpOnly: true,
  secure: config.production,
  sameSite: "lax",
  path: "/"
};

function readCookie(request) {
  const matches = (request.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${settings.cookieName}=`));

  if (matches.length !== 1) return "";

  const value = matches[0].slice(settings.cookieName.length + 1);
  return /^[a-f0-9]{64}$/.test(value) ? value : "";
}

export async function readSession(request, response, next) {
  request.patient = null;
  request.patientSession = null;

  const raw = readCookie(request);

  if (raw) {
    const [session] = await query(
      `SELECT * FROM patient_sessions
       WHERE token_hash=? AND revoked_at IS NULL
         AND expires_at > UTC_TIMESTAMP(3)
         AND idle_expires_at > UTC_TIMESTAMP(3)`,
      [digest(`session:${raw}`)]
    );

    if (session) {
      if (!session.patient_id) {
        request.patientSession = session;
      } else {
        const [patient] = await query(
          `SELECT * FROM patient_accounts
           WHERE id=? AND disabled_at IS NULL
             AND email_verified_at IS NOT NULL AND auth_version=?`,
          [session.patient_id, session.auth_version]
        );

        if (patient) {
          request.patient = patient;
          request.patientSession = session;
        }
      }
    }
  }

  next();
}

export async function issueSession(connection, response, patient, oldId, method) {
  if (patient) {
    await query(
      "SELECT id FROM patient_accounts WHERE id=? FOR UPDATE",
      [patient.id], connection
    );

    const sessions = await query(
      `SELECT id FROM patient_sessions
       WHERE patient_id=? AND revoked_at IS NULL
       ORDER BY created_at DESC`,
      [patient.id], connection
    );

    for (const row of sessions.slice(settings.maxSessions - 1)) {
      await query(
        "UPDATE patient_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE id=?",
        [row.id], connection
      );
    }
  }

  if (oldId) {
    await query(
      "UPDATE patient_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE id=?",
      [oldId], connection
    );
  }

  const raw = secret();
  const id = newId();
  const csrf = secret();

  await query(
    `INSERT INTO patient_sessions
      (id, token_hash, patient_id, auth_version, csrf_token, created_at,
       last_seen_at, idle_expires_at, expires_at, last_auth_at, last_auth_method)
     VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3),
       LEAST(
         DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE),
         DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? HOUR)
       ),
       DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? HOUR),
       ${patient ? "UTC_TIMESTAMP(3)" : "NULL"}, ?)`,
    [
      id, digest(`session:${raw}`), patient?.id || null,
      patient?.auth_version || null, csrf,
      settings.idleMinutes, settings.absoluteHours,
      settings.absoluteHours, method || null
    ],
    connection
  );

  response.cookie(settings.cookieName, raw, {
    ...cookieOptions,
    maxAge: settings.absoluteHours * 3600000
  });

  if (patient) {
    await audit(connection, null, `patient:${patient.id}`, "patient.session.created");
  }

  return { id, csrf_token: csrf };
}

export function clearSessionCookie(response) {
  response.clearCookie(settings.cookieName, cookieOptions);
}

export function csrf(request, response, next) {
  const session = request.patientSession;
  const supplied = request.get("x-csrf-token") || "";

  if (
    request.get("origin") !== config.origin ||
    !session ||
    supplied.length !== session.csrf_token.length ||
    !timingSafeEqual(
      Buffer.from(supplied), Buffer.from(session.csrf_token)
    )
  ) {
    throw new SafeError(
      403, "SESSION_CHECK_FAILED",
      "The session check failed. Refresh the page and try again."
    );
  }

  next();
}

export async function requirePatient(request, response, next) {
  if (!request.patient) {
    throw new SafeError(
      401, "SESSION_REQUIRED",
      "Sign in again. Your session may have expired."
    );
  }

  await query(
    `UPDATE patient_sessions
     SET last_seen_at=UTC_TIMESTAMP(3),
         idle_expires_at=LEAST(
           expires_at, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE)
         )
     WHERE id=? AND revoked_at IS NULL`,
    [settings.idleMinutes, request.patientSession.id]
  );

  next();
}

export function publicPatient(patient) {
  if (!patient) return null;

  return {
    reference: patient.id,
    ...decrypt(patient.profile_enc),
    emailVerified: Boolean(patient.email_verified_at),
    hasPassword: Boolean(patient.password_hash),
    googleLinked: Boolean(patient.google_sub)
  };
}

export async function lockPatient(request, connection) {
  const [patient] = await query(
    `SELECT * FROM patient_accounts WHERE id=? AND disabled_at IS NULL
     AND auth_version=? AND email_verified_at IS NOT NULL FOR UPDATE`,
    [request.patient.id, request.patientSession.auth_version], connection
  );

  if (!patient) {
    throw new SafeError(401, "SESSION_REQUIRED", "Sign in again.");
  }

  return patient;
}