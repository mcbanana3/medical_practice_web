import { randomUUID } from "node:crypto";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { z } from "zod";
import { phoneSchema } from "./phone.mjs";

import { config } from "./config.mjs";
import { query, SafeError } from "./db.mjs";
import {
  databaseNow, bookingOptions, findOption, slotsFor
} from "./scheduling.mjs";
import {
  createRequest, lookupSubmissionReceipt,
  readStaffRequest, decideRequest
} from "./requests.mjs";
import {
  rateLimit, requireStaff, verifyCaptcha, verifyStaff
} from "./security.mjs";

const contextSchema = z.object({
  locationId: z.number().int().positive(),
  providerId: z.number().int().positive(),
  typeId: z.number().int().positive()
});

const requestSchema = contextSchema.extend({
  startsAt: z.string().datetime(),
  name: z.string().trim().min(1).max(100),
  phone: phoneSchema,
  email: z.string().trim().email().max(254),
  captchaToken: z.string().min(1).max(4096)
}).strict();

const receiptSchema = z.object({
  idempotencyKey: z.string().uuid(),
  captchaToken: z.string().min(1).max(4096)
}).strict();

const decisionSchema = z.object({
  action: z.enum(["approve", "decline"]),
  expectedVersion: z.number().int().positive()
}).strict();

export function createApp({
  captchaVerifier = verifyCaptcha,
  staffVerifier = verifyStaff
} = {}) {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", config.proxyHops);

  app.use(helmet());
  app.use(cors({
    origin: config.origin,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Idempotency-Key", "Authorization"],
    credentials: false
  }));

  app.use((request, response, next) => {
    request.requestId = randomUUID();
    response.set("X-Request-ID", request.requestId);
    response.set("Cache-Control", "no-store");
    next();
  });

  app.use(express.json({ limit: "16kb", strict: true }));

  app.get("/api/health", async (request, response) => {
    await query("SELECT 1");
    response.json({ ok: true });
  });

  app.use("/api/booking", rateLimit("booking-read", 120, 60));

  app.use("/api/booking", (request, response, next) => {
    if (!config.enabled) {
      throw new SafeError(
        503, "BOOKING_UNAVAILABLE",
        "Appointment requests are temporarily unavailable. This does not mean the practice is closed."
      );
    }

    if (
      request.method === "POST" &&
      request.get("origin") !== config.origin
    ) {
      throw new SafeError(403, "ORIGIN_DENIED", "This request is not permitted.");
    }

    next();
  });

  const protectedBooking = rateLimit(
    "booking-write", config.rateLimit, config.rateWindowSeconds
  );

  app.get("/api/booking/options", async (request, response) => {
    const options = await bookingOptions();
    const now = (await databaseNow()).setZone(config.zone);

    response.json({
      options,
      clinicTimeZone: config.zone,
      minDate: now.toISODate(),
      maxDate: now.plus({ days: config.horizonDays }).toISODate(),
      dateChoices: Array.from(
        { length: Math.min(7, config.horizonDays + 1) },
        (_, index) => now.plus({ days: index }).toISODate()
      ),
      fixtureData: options.some((option) => Boolean(option.demo)),
      supportContact: config.support
    });
  });

  app.get("/api/booking/availability", async (request, response) => {
    const input = contextSchema.parse({
      locationId: Number(request.query.locationId),
      providerId: Number(request.query.providerId),
      typeId: Number(request.query.typeId)
    });

    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
      .parse(request.query.date);

    const option = await findOption(input);
    const slots = await slotsFor(option, date, await databaseNow());

    response.json({ date, clinicTimeZone: config.zone, slots });
  });

  app.post("/api/booking/requests", protectedBooking, async (request, response) => {
    const parsed = requestSchema.parse(request.body);
    const key = z.string().uuid().parse(request.get("idempotency-key"))
      .toLowerCase();

    await captchaVerifier(parsed.captchaToken);

    const { captchaToken, ...input } = parsed;
    const result = await createRequest(input, key);

    response.status(result.replayed ? 200 : 201).json(result);
  });

  app.post("/api/booking/receipt", protectedBooking, async (request, response) => {
    const input = receiptSchema.parse(request.body);
    await captchaVerifier(input.captchaToken);

    response.json({
      receipt: await lookupSubmissionReceipt(
        input.idempotencyKey.toLowerCase()
      )
    });
  });

  app.get(
    "/api/staff/requests/:reference",
    requireStaff("appointments:read", staffVerifier),
    async (request, response) => {
      if (!/^[a-f0-9]{32}$/.test(request.params.reference)) {
        throw new SafeError(404, "NOT_FOUND", "The resource is unavailable.");
      }

      response.json(await readStaffRequest(
        request.params.reference, request.staff.sub
      ));
    }
  );

  app.post(
    "/api/staff/requests/:reference/actions",
    requireStaff("appointments:decide", staffVerifier),
    async (request, response) => {
      if (!/^[a-f0-9]{32}$/.test(request.params.reference)) {
        throw new SafeError(404, "NOT_FOUND", "The resource is unavailable.");
      }

      const input = decisionSchema.parse(request.body);

      response.json(await decideRequest(
        request.params.reference,
        request.staff.sub,
        input.action,
        input.expectedVersion
      ));
    }
  );

  app.use((request, response) => {
    response.status(404).json({
      error: { code: "NOT_FOUND", message: "The resource is unavailable." }
    });
  });

  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);

    if (error instanceof z.ZodError) {
      const fields = {};

      for (const issue of error.issues) {
        const field = issue.path[0];
        if (["name", "email", "captchaToken"].includes(field)) {
          fields[field] = "Please check this field.";
        }
      }

      return response.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Please check the submitted information.",
          fields
        },
        requestId: request.requestId
      });
    }

    const malformed = error.type === "entity.parse.failed";
    const tooLarge = error.type === "entity.too.large";
    const known = error instanceof SafeError;

    response.status(
      known ? error.status : malformed ? 400 : tooLarge ? 413 : 500
    ).json({
      error: {
        code: known
          ? error.code
          : malformed ? "INVALID_JSON"
          : tooLarge ? "PAYLOAD_TOO_LARGE"
          : "SERVICE_ERROR",
        message: known
          ? error.message
          : "The operation could not be verified. Please retry safely."
      },
      requestId: request.requestId
    });

    // No bodies, email addresses, captcha tokens, SQL, or provider errors logged.
    if (!known && !malformed && !tooLarge) {
      console.error("API_OPERATION_FAILED", request.requestId);
    }
  });

  return app;
}