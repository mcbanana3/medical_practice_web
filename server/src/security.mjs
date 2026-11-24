import ipaddr from "ipaddr.js";
import { config } from "./config.mjs";
import { digest, query, SafeError } from "./db.mjs";

export async function verifyCaptcha(token, fetchImplementation = fetch) {
  let response;
  let result;

  try {
    response = await fetchImplementation(
      "https://www.google.com/recaptcha/api/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret: config.captchaSecret,
          response: token
        }),
        signal: AbortSignal.timeout(5000)
      }
    );

    if (!response.ok) throw new Error("Provider unavailable");
    result = await response.json();
  } catch {
    throw new SafeError(
      503, "SECURITY_UNAVAILABLE",
      "The security check is temporarily unavailable. Please try again."
    );
  }

  const age = Date.now() - Date.parse(result.challenge_ts);
  const hostname = String(result.hostname || "").toLowerCase();

  if (
    result.success !== true ||
    !config.captchaHosts.includes(hostname) ||
    !Number.isFinite(age) ||
    age < -10000 ||
    age > 120000
  ) {
    throw new SafeError(
      400, "SECURITY_CHECK_FAILED",
      "Complete a new security check and try again."
    );
  }
}

export async function verifyStaff() {
  throw new SafeError(
    401, "STAFF_SESSION_REQUIRED", "Use the staff sign-in page."
  );
}

export function requireStaff(scope, verifier = verifyStaff) {
  return async (request, response, next) => {
    request.staff = await verifier(request);

    const scopes = typeof request.staff.scope === "string"
      ? request.staff.scope.split(" ")
      : [];

    if (!scopes.includes(scope)) {
      throw new SafeError(403, "ACCESS_DENIED", "This action is not permitted.");
    }

    next();
  };
}

export function rateLimit(group, maximum, windowSeconds) {
  return async (request, response, next) => {
    let normalized = "unknown";

    try {
      const address = ipaddr.process(request.ip);
      const bytes = address.toByteArray();
      normalized = `${address.kind()}:${(
        address.kind() === "ipv6" ? bytes.slice(0, 8) : bytes
      ).join(".")}`;
    } catch {
      // Invalid addresses share one restricted bucket.
    }

    const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
    const key = digest(`${group}:${normalized}:${bucket}`);
    const expires = new Date((bucket + 1) * windowSeconds * 1000 + 60000);

    await query(
      `INSERT INTO rate_buckets VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE hits = hits + 1`,
      [key, expires]
    );

    const [row] = await query(
      "SELECT hits FROM rate_buckets WHERE bucket_hash = ?",
      [key]
    );

    if (row.hits > maximum) {
      response.set("Retry-After", String(windowSeconds));
      throw new SafeError(
        429, "RATE_LIMITED",
        "Too many attempts. Please wait before trying again."
      );
    }

    next();
  };
}