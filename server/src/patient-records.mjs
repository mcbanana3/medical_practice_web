import express from "express";
import { DateTime } from "luxon";
import { z } from "zod";

import { config } from "./config.mjs";
import {
  audit,
  decrypt,
  digest,
  encrypt,
  newId,
  pool,
  query,
  SafeError,
  transaction
} from "./db.mjs";

import { authSettings } from "./auth/settings.mjs";
import { lockPatient } from "./auth/sessions.mjs";
import { phoneSchema } from "./phone.mjs";
import { rateLimit } from "./security.mjs";

import {
  databaseNow,
  findOption,
  slotsFor
} from "./scheduling.mjs";

import {
  cancelWithRelated,
  getRescheduleContext
} from "./reschedules.mjs";

import { enqueueNotifications } from "./notifications.mjs";

const text = (maximum) =>
  z.string().trim().max(maximum).optional().default("");

const detailsSchema = z.object({
  displayName: text(100),
  phone: phoneSchema,

  dateOfBirth: z.string().max(10).refine((value) => {
    if (!value) return true;

    const date = DateTime.fromISO(value, { zone: config.zone });

    return (
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      date.isValid &&
      date.toISODate() === value &&
      value <= DateTime.now().setZone(config.zone).toISODate()
    );
  }, "Enter a valid date of birth.")
    .optional()
    .default(""),

  address: text(300),

  emergencyContactName: text(100),
  emergencyContactRelationship: text(50),
  emergencyContactPhone: phoneSchema,

  heightCm: z.number().finite().positive().max(300)
    .nullable().optional().default(null),

  weightKg: z.number().finite().positive().max(1000)
    .nullable().optional().default(null),

  allergies: text(2000),
  medications: text(2000),
  conditions: text(2000),
  medicalHistory: text(2000)
}).strict();

const expectedVersionSchema = z.number().int().positive();

function unavailable() {
  return new SafeError(
    404,
    "NOT_FOUND",
    "The appointment or request is unavailable."
  );
}

async function owned(
  request,
  reference,
  connection = pool,
  lock = false
) {
  if (!/^[a-f0-9]{32}$/.test(reference || "")) {
    throw unavailable();
  }

  const [row] = await query(
    `SELECT r.*
     FROM appointment_requests r
     JOIN patient_request_links o ON o.request_id=r.id
     WHERE r.id=? AND o.patient_id=?
     ${lock ? "FOR UPDATE" : ""}`,
    [reference, request.patient.id],
    connection
  );

  if (!row) throw unavailable();
  return row;
}

function assertChangeable(row, version, now) {
  if (row.version !== version) {
    throw new SafeError(
      409,
      "REQUEST_CHANGED",
      "This appointment changed. Reload its current status before continuing."
    );
  }

  if (
    !["pending", "approved"].includes(row.status) ||
    row.starts_at.getTime() <= now.toMillis()
  ) {
    throw new SafeError(
      409,
      "CHANGE_UNAVAILABLE",
      "Online changes are unavailable for this appointment."
    );
  }
}

function scopedRescheduleKey(patientId, reference, key) {
  const hash = digest(
    `patient-reschedule:${patientId}:${reference}:${key}`
  ).slice(0, 32);

  return (
    hash.slice(0, 8) + "-" +
    hash.slice(8, 12) + "-4" +
    hash.slice(13, 16) + "-8" +
    hash.slice(17, 20) + "-" +
    hash.slice(20)
  );
}

export function mountPatientRecords(router) {
  const routes = express.Router();
  const limiter = rateLimit("patient-profile-and-changes", 20, 60);

  // Mount this only after the existing requirePatient middleware.
  router.use("/api/portal", routes);

  routes.use((request, response, next) => {
    if (request.method !== "POST") return next();
    return limiter(request, response, next);
  });

  routes.get("/profile", async (request, response) => {
    const [stored] = await query(
      "SELECT * FROM patient_details WHERE patient_id=?",
      [request.patient.id]
    );

    const accountProfile = decrypt(request.patient.profile_enc);

    const details = {
      ...detailsSchema.parse({}),
      ...(stored ? decrypt(stored.details_enc) : {}),
      displayName: accountProfile.displayName || ""
    };

    await audit(
      pool,
      null,
      `patient:${request.patient.id}`,
      "patient.details.viewed"
    );

    response.json({
      details,
      version: stored?.version || 0,
      email: accountProfile.email,
      editable: authSettings.profileEditable,
      updatedAt: stored?.updated_at?.toISOString() || null
    });
  });

  // Contact-only response: booking does not fetch medical information.
  routes.get("/contact", async (request, response) => {
    const [stored] = await query(
      "SELECT details_enc FROM patient_details WHERE patient_id=?",
      [request.patient.id]
    );

    const details = stored ? decrypt(stored.details_enc) : {};
    const profile = decrypt(request.patient.profile_enc);

    response.json({
      displayName: profile.displayName || "",
      phone: details.phone || ""
    });
  });

  routes.post("/profile", async (request, response) => {
    if (!authSettings.profileEditable) {
      throw new SafeError(
        403,
        "PROFILE_RESTRICTED",
        "Profile editing is currently unavailable."
      );
    }

    const input = z.object({
      version: z.number().int().min(0),
      details: detailsSchema
    }).strict().parse(request.body);

    const version = await transaction(async (connection) => {
      const patient = await lockPatient(request, connection);

      const [stored] = await query(
        "SELECT version FROM patient_details WHERE patient_id=? FOR UPDATE",
        [patient.id],
        connection
      );

      if ((stored?.version || 0) !== input.version) {
        throw new SafeError(
          409,
          "PROFILE_CHANGED",
          "Your profile changed in another session. Reload the saved profile before saving again."
        );
      }

      const nextVersion = input.version + 1;

      await query(
        `INSERT INTO patient_details
          (patient_id, details_enc, version, updated_at)
         VALUES (?, ?, ?, UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE
           details_enc=VALUES(details_enc),
           version=VALUES(version),
           updated_at=UTC_TIMESTAMP(3)`,
        [
          patient.id,
          encrypt(input.details),
          nextVersion
        ],
        connection
      );

      // Only the display name enters the existing account/session profile.
      // Never merge the medical details into profile_enc.
      const profile = decrypt(patient.profile_enc);
      profile.displayName = input.details.displayName;

      await query(
        "UPDATE patient_accounts SET profile_enc=? WHERE id=?",
        [encrypt(profile), patient.id],
        connection
      );

      await audit(
        connection,
        null,
        `patient:${patient.id}`,
        "patient.details.updated",
        { version: nextVersion }
      );

      return nextVersion;
    });

    response.json({
      version,
      message: "Your profile was saved."
    });
  });

  routes.get("/appointments/:reference", async (request, response) => {
    const row = await owned(request, request.params.reference);

    const [labels] = await query(
      `SELECT
         l.name AS location,
         p.name AS provider,
         t.name AS appointmentType
       FROM locations l
       JOIN providers p ON p.id=?
       JOIN appointment_types t ON t.id=?
       WHERE l.id=?`,
      [row.provider_id, row.type_id, row.location_id]
    );

    const relation = await getRescheduleContext(row.id);
    const now = await databaseNow();
    const active = ["pending", "approved"].includes(row.status);
    const future = row.starts_at.getTime() > now.toMillis();
    const contact = decrypt(row.contact_enc);

    response.json({
      reference: row.id,
      status: row.status,
      version: row.version,

      startsAt: row.starts_at.toISOString(),
      endsAt: row.ends_at.toISOString(),
      holdExpiresAt: null,

      locationId: row.location_id,
      providerId: row.provider_id,
      typeId: row.type_id,

      ...labels,

      clinicTimeZone: config.zone,
      reschedule: relation,

      contact: {
        name: contact.name || "",
        email: contact.email || "",
        phone: contact.phone || "",
        reason: contact.reason || ""
      },

      canCancel: active && future,

      canReschedule:
        active &&
        future &&
        !relation.pendingReplacementReference &&
        !(
          relation.originalReference &&
          relation.replacementState === "pending"
        )
    });
  });

  routes.post(
    "/appointments/:reference/cancel",
    async (request, response) => {
      const input = z.object({
        expectedVersion: expectedVersionSchema
      }).strict().parse(request.body);

      await transaction(async (connection) => {
        await lockPatient(request, connection);

        const preview = await owned(
          request,
          request.params.reference,
          connection
        );

        await query(
          "SELECT id FROM providers WHERE id=? FOR UPDATE",
          [preview.provider_id],
          connection
        );

        const row = await owned(
          request,
          preview.id,
          connection,
          true
        );

        const now = await databaseNow(connection);

        assertChangeable(row, input.expectedVersion, now);

        await cancelWithRelated(
          connection,
          row,
          request.patient.id,
          `patient:${request.patient.id}`
        );
      });

      response.json({
        message: "The appointment or request was cancelled."
      });
    }
  );

  routes.post(
    "/appointments/:reference/reschedule",
    async (request, response) => {
      if (!config.enabled) {
        throw new SafeError(
          503,
          "BOOKING_UNAVAILABLE",
          "Appointment requests are currently unavailable."
        );
      }

      const input = z.object({
        expectedVersion: expectedVersionSchema,
        startsAt: z.string().datetime()
      }).strict().parse(request.body);

      const key = z.string().uuid()
        .parse(request.get("idempotency-key"))
        .toLowerCase();

      const reference = request.params.reference;

      const submissionKey = scopedRescheduleKey(
        request.patient.id,
        reference,
        key
      );

      const payloadHash = digest(JSON.stringify({
        originalReference: reference,
        ...input
      }));

      const result = await transaction(async (connection) => {
        await lockPatient(request, connection);

        const preview = await owned(
          request,
          reference,
          connection
        );

        await query(
          "SELECT id FROM providers WHERE id=? FOR UPDATE",
          [preview.provider_id],
          connection
        );

        const row = await owned(
          request,
          reference,
          connection,
          true
        );

        const [existing] = await query(
          `SELECT id, payload_hash
           FROM appointment_requests
           WHERE idempotency_key=?`,
          [submissionKey],
          connection
        );

        if (existing) {
          if (existing.payload_hash !== payloadHash) {
            throw new SafeError(
              409,
              "IDEMPOTENCY_MISMATCH",
              "The retry does not match the original request."
            );
          }

          await owned(request, existing.id, connection);

          return {
            reference: existing.id,
            replayed: true
          };
        }

        const now = await databaseNow(connection);
        assertChangeable(row, input.expectedVersion, now);

        const relation = await getRescheduleContext(
          row.id,
          connection
        );

        if (
          relation.pendingReplacementReference ||
          (
            relation.originalReference &&
            relation.replacementState === "pending"
          )
        ) {
          throw new SafeError(
            409,
            "RESCHEDULE_PENDING",
            "A replacement request is already awaiting review."
          );
        }

        const option = await findOption({
          locationId: row.location_id,
          providerId: row.provider_id,
          typeId: row.type_id
        }, connection);

        const selected = DateTime.fromISO(input.startsAt, {
          zone: "utc"
        });

        const localDate = selected
          .setZone(config.zone)
          .toISODate();

        const available = await slotsFor(
          option,
          localDate,
          now,
          connection
        );

        const slot = available.find((item) =>
          DateTime.fromISO(item.startsAt).toMillis() ===
          selected.toMillis()
        );

        if (!slot) {
          throw new SafeError(
            409,
            "SLOT_UNAVAILABLE",
            "That replacement time is unavailable. Your original appointment has not changed."
          );
        }

        const conflicts = await query(
          `SELECT id
           FROM appointment_requests
           WHERE provider_id=?
             AND starts_at < ?
             AND ends_at > ?
             AND status IN ('pending', 'approved')
           LIMIT 1 FOR UPDATE`,
          [
            row.provider_id,
            new Date(slot.endsAt),
            new Date(slot.startsAt)
          ],
          connection
        );

        if (conflicts.length) {
          throw new SafeError(
            409,
            "SLOT_UNAVAILABLE",
            "That replacement time is unavailable. Your original appointment has not changed."
          );
        }

        const replacement = newId();

        const receipt = {
          reference: replacement,
          submissionStatus: "pending",
          clinicTimeZone: config.zone,
          reservationExpiresAt: null,
          supportContact: config.support
        };

        await query(
          `INSERT INTO appointment_requests
            (
              id, idempotency_key, payload_hash,
              location_id, provider_id, type_id,
              starts_at, ends_at, contact_enc,
              status, expires_at, version,
              receipt_json, created_at
            )
           VALUES (
             ?, ?, ?, ?, ?, ?, ?, ?, ?,
             'pending', NULL, 1, ?, UTC_TIMESTAMP(3)
           )`,
          [
            replacement,
            submissionKey,
            payloadHash,
            row.location_id,
            row.provider_id,
            row.type_id,
            new Date(slot.startsAt),
            new Date(slot.endsAt),
            row.contact_enc,
            JSON.stringify(receipt)
          ],
          connection
        );

        await query(
          `INSERT INTO patient_request_links
           VALUES (?, ?, UTC_TIMESTAMP(3))`,
          [replacement, request.patient.id],
          connection
        );

        await query(
          `INSERT INTO patient_reschedules
            (
              replacement_id, original_id, patient_id,
              state, created_at
            )
           VALUES (?, ?, ?, 'pending', UTC_TIMESTAMP(3))`,
          [replacement, row.id, request.patient.id],
          connection
        );

        await query(
          "UPDATE appointment_requests SET version=version+1 WHERE id=?",
          [row.id],
          connection
        );

        await audit(
          connection,
          row.id,
          `patient:${request.patient.id}`,
          "request.reschedule.requested",
          { replacementReference: replacement }
        );

        await audit(
          connection,
          replacement,
          `patient:${request.patient.id}`,
          "request.created",
          { originalReference: row.id }
        );

        await enqueueNotifications(
          connection,
          replacement,
          "requested",
          decrypt(row.contact_enc).email
        );

        return {
          reference: replacement,
          replayed: false
        };
      });

      response.status(result.replayed ? 200 : 201).json(result);
    }
  );

  routes.use((error, request, response, next) => {
    if (!(error instanceof z.ZodError)) return next(error);

    response.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Check the submitted fields and try again."
      }
    });
  });
}