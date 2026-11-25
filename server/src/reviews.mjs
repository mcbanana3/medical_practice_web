import express from "express";
import cors from "cors";
import helmet from "helmet";
import { z } from "zod";

import { config } from "./config.mjs";
import {
  query, transaction, digest, encrypt, decrypt, newId, SafeError, audit
} from "./db.mjs";
import { rateLimit, verifyCaptcha } from "./security.mjs";
import { S } from "./staff/auth.mjs";
import { queue } from "./staff/mail.mjs";

const id = z.number().int().positive();
const queryId = z.coerce.number().int().positive();
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const statuses = ["pending", "approved", "rejected", "withdrawn"];
const checkNames = [
  "authenticityConfirmed", "permissionConfirmed",
  "privacyChecked", "neutralModerationConfirmed"
];
const text = z.string().trim().min(10).max(3000)
  .refine(value => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value));
const displayName = z.string().trim().max(80)
  .refine(value => !/[\x00-\x1f\x7f]/.test(value));

const submissionSchema = z.object({
  idempotencyKey: z.string().uuid(),
  locationId: id,
  providerId: id,
  displayName: displayName.default(""),
  text,
  rating: z.number().int().min(1).max(5).nullable().default(null),
  publicationConsent: z.literal(true),
  captchaToken: z.string().min(1).max(4096)
}).strict();

function fail(status, code, message) {
  throw new SafeError(status, code, message);
}

function parseJson(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

const withdrawalCode = key =>
  digest("public-review-withdrawal-secret:" + key);

const publicFields = z.object({
  displayName: z.string().min(1).max(80),
  text,
  rating: z.number().int().min(1).max(5).nullable()
}).strict();

async function availablePairs(connection) {
  return query(
    `SELECT DISTINCT
       b.location_id AS locationId,b.provider_id AS providerId,
       l.name AS location,p.name AS provider
     FROM booking_options b
     JOIN locations l ON l.id=b.location_id
     JOIN providers p ON p.id=b.provider_id
     WHERE b.enabled=1
       AND ((b.verified=1 AND b.is_demo=0) OR (?=1 AND b.is_demo=1))
       AND EXISTS (
         SELECT 1 FROM staff_grants g
         JOIN staff_users u ON u.subject=g.subject
         JOIN staff_local_credentials c ON c.subject=u.subject
         WHERE g.location_id=b.location_id AND g.provider_id=b.provider_id
           AND g.role='administrator' AND u.enabled=1
           AND u.issuer=? AND c.password_hash IS NOT NULL
       )
     ORDER BY l.name,p.name`,
    [config.fixtures ? 1 : 0, S.issuer],
    connection
  );
}

async function notifyAdministrators(connection, reviewId, input) {
  const recipients = await query(
    `SELECT DISTINCT u.subject,c.email_enc
     FROM staff_grants g
     JOIN staff_users u ON u.subject=g.subject
     JOIN staff_local_credentials c ON c.subject=u.subject
     WHERE g.location_id=? AND g.provider_id=?
       AND g.role='administrator' AND u.enabled=1
       AND u.issuer=? AND c.password_hash IS NOT NULL`,
    [input.locationId, input.providerId, S.issuer],
    connection
  );

  for (const recipient of recipients) {
    await queue(connection, `public-review:${reviewId}:${recipient.subject}`, {
      to: decrypt(recipient.email_enc).email,
      subject: "A public review needs approval",
      text: [
        "A new public review is waiting in the private moderation queue.",
        "It is not published.",
        `${config.origin}/staff/reviews`,
        "After signing in, open Reviews to approve or reject the submission."
      ].join("\n\n")
    });
  }
}

function receipt(key) {
  return {
    message: "Thank you. Your review was received and is awaiting administrator approval. It is not public yet.",
    withdrawalCode: withdrawalCode(key)
  };
}

export function createPublicReviewsRouter({
  captchaVerifier = verifyCaptcha
} = {}) {
  const router = express.Router();
  router.use(helmet({ referrerPolicy: { policy: "no-referrer" } }));
  router.use(cors({
    origin: config.origin,
    credentials: false,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"]
  }));
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (config.production && !req.secure) {
      fail(426, "HTTPS_REQUIRED", "HTTPS is required.");
    }
    next();
  });
  router.use(express.json({ limit: "24kb", strict: true }));
  router.use(rateLimit("public-review-requests", 120, 60));
  router.use((req, res, next) => {
    if (req.method === "POST" && (
      req.get("origin") !== config.origin ||
      !req.is("application/json")
    )) fail(403, "ORIGIN_DENIED", "This request is not permitted.");
    next();
  });

  router.get("/options", async (req, res) => {
    res.json({ items: await availablePairs() });
  });

  router.get("/", async (req, res) => {
    const input = z.object({
      limit: z.coerce.number().int().min(1).max(24).default(12),
      offset: z.coerce.number().int().min(0).max(10000).default(0),
      sort: z.enum(["newest", "oldest", "highest", "lowest"]).default("newest")
    }).strict().parse(req.query);

    const order = {
      newest: "created_at DESC,id DESC",
      oldest: "created_at ASC,id ASC",
      highest: "(JSON_EXTRACT(public_json,'$.rating') IS NULL OR JSON_TYPE(JSON_EXTRACT(public_json,'$.rating'))='NULL') ASC, CAST(JSON_UNQUOTE(JSON_EXTRACT(public_json,'$.rating')) AS UNSIGNED) DESC,created_at DESC,id DESC",
      lowest: "(JSON_EXTRACT(public_json,'$.rating') IS NULL OR JSON_TYPE(JSON_EXTRACT(public_json,'$.rating'))='NULL') ASC, CAST(JSON_UNQUOTE(JSON_EXTRACT(public_json,'$.rating')) AS UNSIGNED) ASC,created_at DESC,id DESC"
    }[input.sort];
    const rows = await query(
      `SELECT id,public_json,approved_at,created_at
       FROM public_review_submissions
       WHERE status='approved' AND publication_consent=1
         AND public_json IS NOT NULL
       ORDER BY ${order}
       LIMIT ? OFFSET ?`,
      [input.limit + 1, input.offset]
    );

    res.json({
      items: rows.slice(0, input.limit).map(row => {
        const published = publicFields.parse(parseJson(row.public_json));
        return {
          id: row.id,
          displayName: published.displayName,
          text: published.text,
          rating: published.rating,
          approvedAt: row.approved_at.toISOString(),
          createdAt: row.created_at.toISOString(),
          sourceLabel: "Website submission · administrator approved"
        };
      }),
      nextOffset: rows.length > input.limit && input.offset + input.limit <= 10000
        ? input.offset + input.limit : null
    });
  });

  router.post("/", rateLimit("public-review-submit", 5, 900),
    async (req, res) => {
      const body = submissionSchema.parse(req.body);

      // External security verification must happen before row locks.
      await captchaVerifier(body.captchaToken);

      const key = body.idempotencyKey.toLowerCase();
      const storedKey = digest("public-review-submission:" + key);
      const raw = {
        displayName: body.displayName || "Anonymous",
        text: body.text,
        rating: body.rating
      };
      const payloadHash = digest(JSON.stringify({
        ...raw, locationId: body.locationId,
        providerId: body.providerId, publicationConsent: true
      }));

      function replay(existing) {
        if (existing.payload_hash !== payloadHash) {
          fail(409, "SUBMISSION_CHANGED",
            "An earlier submission used this key with different details. Do not submit a duplicate.");
        }
        return receipt(key);
      }

      let result;
      try {
        result = await transaction(async connection => {
          const [existing] = await query(
            "SELECT payload_hash FROM public_review_submissions WHERE submission_key=?",
            [storedKey], connection
          );
          if (existing) return replay(existing);

          const pairs = await availablePairs(connection);
          if (!pairs.some(pair =>
            Number(pair.locationId) === body.locationId &&
            Number(pair.providerId) === body.providerId
          )) fail(400, "REVIEW_OPTION_UNAVAILABLE",
            "Review submission is unavailable for that selection.");

          const reviewId = newId();
          await query(
            `INSERT INTO public_review_submissions
             (id,submission_key,payload_hash,location_id,provider_id,
              status,version,submission_enc,publication_consent,withdraw_hash,
              created_at,updated_at)
             VALUES(?,?,?,?,?,'pending',1,?,1,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
            [
              reviewId, storedKey, payloadHash, body.locationId, body.providerId,
              encrypt(raw), digest("public-review-withdraw:" + withdrawalCode(key))
            ], connection
          );
          await audit(connection, null, "public-review", "review.submitted", {
            locationId: body.locationId, providerId: body.providerId,
            reviewReference: reviewId, version: 1
          });
          await notifyAdministrators(connection, reviewId, body);
          return receipt(key);
        });
      } catch (error) {
        if (error.code !== "ER_DUP_ENTRY") throw error;
        const [existing] = await query(
          "SELECT payload_hash FROM public_review_submissions WHERE submission_key=?",
          [storedKey]
        );
        if (!existing) throw error;
        result = replay(existing);
      }

      res.status(201).json(result);
    });

  router.post("/withdraw", rateLimit("public-review-withdraw", 10, 900),
    async (req, res) => {
      const body = z.object({
        code: hex,
        captchaToken: z.string().min(1).max(4096)
      }).strict().parse(req.body);
      await captchaVerifier(body.captchaToken);
      await transaction(async connection => {
        const [row] = await query(
          `SELECT * FROM public_review_submissions
           WHERE withdraw_hash=? FOR UPDATE`,
          [digest("public-review-withdraw:" + body.code)], connection
        );
        if (!row || row.status === "withdrawn") return;
        await query(
          `UPDATE public_review_submissions
           SET status='withdrawn',public_json=NULL,
             version=version+1,updated_at=UTC_TIMESTAMP(3)
           WHERE id=?`, [row.id], connection
        );
        await audit(connection, null, "review-owner", "review.withdrawn", {
          locationId: row.location_id, providerId: row.provider_id,
          reviewReference: row.id, version: row.version + 1
        });
      });
      res.json({
        message: "If the code matched a review, that review has been withdrawn."
      });
    });

  // Never fall through into an older public review implementation.
  router.use((req, res) => res.status(404).json({
    error: { code: "NOT_FOUND", message: "Review endpoint unavailable." }
  }));

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const known = error instanceof SafeError;
    const validation = error instanceof z.ZodError ||
      error.type === "entity.parse.failed";
    const large = error.type === "entity.too.large";
    if (!known && !validation && !large) {
      console.error("PUBLIC_REVIEWS_FAILED", {
        code: error?.code, errno: error?.errno, sqlState: error?.sqlState
      });
    }
    res.status(known ? error.status : large ? 413 : validation ? 400 : 500).json({
      error: {
        code: known ? error.code : "REVIEWS_UNAVAILABLE",
        message: known ? error.message : validation || large
          ? "Check the review fields and try again."
          : "The review response could not be verified. Retry the same submission after another security check."
      }
    });
  });
  return router;
}

export function mountReviewModeration({ add, need, scopeSQL }) {
  add("get", "/reviews", async (req, ctx, connection) => {
    need(ctx, "access");
    const input = z.object({
      status: z.enum(statuses).default("pending"),
      locationId: queryId.optional(),
      providerId: queryId.optional(),
      offset: z.coerce.number().int().min(0).max(10000).default(0)
    }).strict().parse(req.query);
    const scope = scopeSQL(ctx, "access", "r");
    const where = ["r.status=?", `(${scope.sql})`];
    const values = [input.status, ...scope.params];

    if (input.locationId) {
      where.push("r.location_id=?"); values.push(input.locationId);
    }
    if (input.providerId) {
      where.push("r.provider_id=?"); values.push(input.providerId);
    }
    const rows = await query(
      `SELECT r.*,l.name AS location,p.name AS provider
       FROM public_review_submissions r
       JOIN locations l ON l.id=r.location_id
       JOIN providers p ON p.id=r.provider_id
       WHERE ${where.join(" AND ")}
       ORDER BY r.created_at DESC,r.id DESC LIMIT 51 OFFSET ?`,
      [...values, input.offset], connection
    );
    return {
      items: rows.slice(0, 50).map(row => {
        const raw = publicFields.parse(decrypt(row.submission_enc));
        return {
          id: row.id, status: row.status, version: row.version,
          location: row.location, provider: row.provider,
          locationId: row.location_id, providerId: row.provider_id,
          displayName: raw.displayName, text: raw.text, rating: raw.rating,
          publicationConsent: Boolean(row.publication_consent),
          createdAt: row.created_at.toISOString(),
          internalReason: row.internal_note_enc
            ? decrypt(row.internal_note_enc).reason : ""
        };
      }),
      nextOffset: rows.length > 50 && input.offset < 10000
        ? input.offset + 50 : null,
      clinicTimeZone: config.zone
    };
  });

  add("post", "/reviews/:id/action", async (req, ctx, connection) => {
    const reviewId = z.string().regex(/^[a-f0-9]{32}$/).parse(req.params.id);
    const body = z.object({
      action: z.enum(["approve", "reject", "hide"]),
      expectedVersion: z.number().int().positive(),
      authenticityConfirmed: z.boolean().optional(),
      permissionConfirmed: z.boolean().optional(),
      privacyChecked: z.boolean().optional(),
      neutralModerationConfirmed: z.boolean().optional(),
      reason: z.string().trim().max(500).optional()
    }).strict().parse(req.body);

    const scope = scopeSQL(ctx, "access", "r");
    const [row] = await query(
      `SELECT r.* FROM public_review_submissions r
       WHERE r.id=? AND (${scope.sql}) FOR UPDATE`,
      [reviewId, ...scope.params], connection
    );
    if (!row) fail(404, "NOT_FOUND", "Review unavailable.");
    need(ctx, "access", Number(row.location_id), Number(row.provider_id));

    if (row.version !== body.expectedVersion ||
        row.status === "withdrawn" ||
        (body.action === "hide" ? row.status !== "approved" : row.status !== "pending")) {
      fail(409, "REVIEW_CHANGED", "The review changed. Refresh before acting.");
    }
    if (body.action === "approve" && (
      !row.publication_consent || !checkNames.every(key => body[key] === true)
    )) fail(400, "CHECKS_REQUIRED", "Complete all four publication checks.");
    if (body.action !== "approve" && (body.reason || "").length < 3) {
      fail(400, "REASON_REQUIRED", "Enter a brief private moderation reason.");
    }

    const raw = publicFields.parse(decrypt(row.submission_enc));
    const status = body.action === "approve" ? "approved"
      : body.action === "reject" ? "rejected" : "pending";

    await query(
      `UPDATE public_review_submissions
       SET status=?,version=version+1,public_json=?,checks_json=?,
         internal_note_enc=?,moderated_by=?,
         approved_at=CASE WHEN ?='approved' THEN UTC_TIMESTAMP(3) ELSE NULL END,
         updated_at=UTC_TIMESTAMP(3)
       WHERE id=?`,
      [
        status,
        status === "approved" ? JSON.stringify(raw) : null,
        body.action === "approve"
          ? JSON.stringify(Object.fromEntries(checkNames.map(key => [key, true])))
          : null,
        body.reason ? encrypt({ reason: body.reason }) : null,
        ctx.subject, status, reviewId
      ], connection
    );
    await audit(connection, null, ctx.subject, "review." + (
      body.action === "hide" ? "hidden" : status
    ), {
      locationId: row.location_id, providerId: row.provider_id,
      reviewReference: row.id, version: row.version + 1
    });

    return {
      message: body.action === "approve"
        ? "Approved. This review is now public."
        : body.action === "hide"
          ? "Hidden from the public site and returned to pending."
          : "Rejected. This review is not public."
    };
  });
}