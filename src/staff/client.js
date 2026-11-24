const BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
let csrfToken = "";

// Compatibility with the existing account page's fresh-auth link.
// This now points to the local password-confirmation form.
export const loginUrl = "/staff/account";

export function setStaffCsrf(value) {
  csrfToken = value || "";
}

async function request(path, options = {}, authenticated = true) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  const timer = window.setTimeout(abort, 20000);

  try {
    const response = await fetch(BASE + "/api/staff" + path, {
      method: options.body === undefined ? "GET" : "POST",
      credentials: "include",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.body === undefined ? {} : {
          "Content-Type": "application/json",
          ...(authenticated ? { "X-Staff-CSRF": csrfToken } : {})
        })
      },
      ...(options.body === undefined ? {} : {
        body: JSON.stringify(options.body)
      })
    });
    const data = await response.json().catch(() => null);

    if (authenticated && response.status === 401) {
      csrfToken = "";
      window.dispatchEvent(new Event("staff-session-ended"));
    }
    if (!response.ok || !data) {
      throw Object.assign(
        new Error(data?.error?.message || "The service response could not be verified."),
        {
          status: response.status,
          code: data?.error?.code,
          uncertain: !data || response.status >= 500
        }
      );
    }

    if (authenticated) {
      if (data.csrfToken) csrfToken = data.csrfToken;
      const seconds = Number(response.headers.get("X-Staff-Remaining-Seconds"));
      if (response.headers.has("X-Staff-Remaining-Seconds") && Number.isFinite(seconds)) {
        window.dispatchEvent(new CustomEvent("staff-session-clock", {
          detail: { seconds }
        }));
      }
      if (data.signedOut) {
        csrfToken = "";
        window.dispatchEvent(new Event("staff-session-ended"));
      }
    }
    return data;
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (error.status !== undefined) throw error;
    throw Object.assign(
      new Error("The connection was interrupted. A change may have succeeded; check its current status before retrying."),
      { uncertain: true }
    );
  } finally {
    window.clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

export const api = (path, options = {}) => request(path, options, true);
export const post = (path, body = {}) => api(path, { body });

export async function publicPost(path, body) {
  const bootstrap = await request("/auth/bootstrap", {}, false);
  return request(path, {
    body: { ...body, loginToken: bootstrap.loginToken }
  }, false);
}

export function params(values) {
  return new URLSearchParams(
    Object.entries(values).filter(([, value]) => value !== "" && value != null)
  ).toString();
}