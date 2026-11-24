import express from "express";
import cors from "cors";
import helmet from "helmet";
import { z } from "zod";

import { config } from "../config.mjs";
import { query, transaction, SafeError } from "../db.mjs";
import { rateLimit } from "../security.mjs";
import { S, PERMS, can, readStaff, mountAuth, clearCookie } from "./auth.mjs";
import { mountOperations } from "./operations.mjs";
import { mountManagement } from "./management.mjs";

export function need(ctx, permission, locationId, providerId) {
  if (!can(ctx, permission, locationId, providerId)) {
    throw new SafeError(403, "ACCESS_DENIED", "This action is not permitted.");
  }
}

export function scopeSQL(ctx, permission, alias = "r") {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) {
    throw new Error("Invalid internal SQL alias.");
  }

  const roles = Object.keys(PERMS).filter(r => PERMS[r].includes(permission));
  if (!roles.length) return { sql: "0=1", params: [] };

  return {
    sql: `EXISTS (
      SELECT 1 FROM staff_grants sg
      WHERE sg.subject=?
        AND sg.location_id=${alias}.location_id
        AND sg.provider_id=${alias}.provider_id
        AND sg.role IN (${roles.map(() => "?").join(",")})
    )`,
    params: [ctx.subject, ...roles]
  };
}

export async function scoped(ref, ctx, c, permission = "read", lock = false) {
  if (!/^[a-f0-9]{32}$/.test(ref || "")) {
    throw new SafeError(404, "NOT_FOUND", "The resource is unavailable.");
  }

  const scope = scopeSQL(ctx, permission);
  const [preview] = await query(
    `SELECT r.*,l.name AS location,p.name AS provider,
       t.name AS appointmentType
     FROM appointment_requests r
     JOIN locations l ON l.id=r.location_id
     JOIN providers p ON p.id=r.provider_id
     JOIN appointment_types t ON t.id=r.type_id
     WHERE r.id=? AND (${scope.sql})`,
    [ref, ...scope.params], c
  );

  if (!preview) throw new SafeError(404, "NOT_FOUND", "The resource is unavailable.");
  if (!lock) return preview;

  await query("SELECT id FROM providers WHERE id=? FOR UPDATE", [preview.provider_id], c);

  const [fresh] = await query(
    `SELECT r.* FROM appointment_requests r
     WHERE r.id=? AND (${scope.sql}) FOR UPDATE`,
    [ref, ...scope.params], c
  );

  if (!fresh) throw new SafeError(404, "NOT_FOUND", "The resource is unavailable.");
  return { ...preview, ...fresh };
}

export function createStaffRouter() {
  const router = express.Router();

  router.use(helmet({ referrerPolicy: { policy: "no-referrer" } }));
  router.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive"
    });
    if (config.production && !req.secure) {
      throw new SafeError(426, "HTTPS_REQUIRED", "HTTPS is required.");
    }
    next();
  });

  router.use(cors({
    origin: config.origin,
    credentials: true,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "X-Staff-CSRF"],
    exposedHeaders: ["X-Staff-Remaining-Seconds"]
  }));

  router.use(express.json({ limit: "48kb" }));

  const reads = rateLimit("staff-read", 600, 60);
  const writes = rateLimit("staff-write", 60, 60);

  router.use((req, res, next) =>
    req.method === "POST"
      ? writes(req, res, next)
      : reads(req, res, next)
  );

  const add = (method, path, handler) => {
    router[method](path, async (req, res) => {
      if (!S.enabled) {
        throw new SafeError(503, "STAFF_DISABLED", "Staff access is not configured.");
      }

      const result = await transaction(async c => {
        const ctx = await readStaff(req, c);
        if (!ctx) throw new SafeError(401, "STAFF_SESSION_REQUIRED", "Sign in again.");
        return { body: await handler(req, ctx, c), remaining: ctx.remainingSeconds };
      });

      res.set("X-Staff-Remaining-Seconds", String(result.remaining));
      res.json(result.body);
    });
  };

  mountAuth(router);
  mountOperations({ add, need, scoped, scopeSQL });
  mountManagement({ add, need, scoped, scopeSQL });

  router.use((req, res) => res.status(404).json({
    error: { code: "NOT_FOUND", message: "The staff endpoint is unavailable." }
  }));

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    const validation = error instanceof z.ZodError;
    const malformed = error.type === "entity.parse.failed";
    const large = error.type === "entity.too.large";
    const known = error instanceof SafeError;

    if (known && error.status === 401) clearCookie(res);

    if (!known && !validation && !malformed && !large) {
      console.error("STAFF_OPERATION_FAILED");
    }

    res.status(
      known ? error.status : large ? 413 : validation || malformed ? 400 : 500
    ).json({
      error: {
        code: known ? error.code : validation ? "VALIDATION_ERROR" : "STAFF_SERVICE_ERROR",
        message: known
          ? error.message
          : validation || malformed || large
            ? "Check the submitted fields."
            : "The operation could not be verified. Reload its current status before retrying."
      }
    });
  });

  return router;
}