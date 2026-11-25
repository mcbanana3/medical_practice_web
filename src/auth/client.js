const BASE = import.meta.env.VITE_API_BASE_URL || "";
let csrfToken = "";
let sessionRequest;

export async function request(path, options = {}) {
  const mutation = options.method && options.method !== "GET";

  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 20000);
  try {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    signal: controller.signal,
    credentials: "include",
    cache: "no-store",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(mutation ? { "X-CSRF-Token": csrfToken } : {}),
      ...options.headers
    }
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data) {
    if (response.status === 401 && data?.error?.code === "SESSION_REQUIRED" && path.startsWith("/api/portal/")) {
      window.dispatchEvent(new Event("patient-session-invalid"));
    }

    throw Object.assign(
      new Error(data?.error?.message || "The service is unavailable."),
      { status: response.status, code: data?.error?.code }
    );
  }

  if (data.csrfToken) csrfToken = data.csrfToken;
  return data;
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (error.status) throw error;
    throw new Error(mutation
      ? "The response could not be verified. Check the saved status before retrying this change."
      : "The connection is unavailable. Please try again.");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

export function session(force = false) {
  if (force) return request("/api/auth/session");
  if (!sessionRequest) {
    sessionRequest = request("/api/auth/session")
      .then((data) => {
        csrfToken = data.csrfToken;
        return data;
      })
      .finally(() => { sessionRequest = null; });
  }

  return sessionRequest;
}

export const post = (path, body = {}, headers = {}) =>
  request(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers
  });