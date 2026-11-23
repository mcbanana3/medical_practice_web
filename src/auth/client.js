const BASE = import.meta.env.VITE_API_BASE_URL || "";
let csrfToken = "";
let sessionRequest;

export async function request(path, options = {}) {
  const mutation = options.method && options.method !== "GET";

  const response = await fetch(`${BASE}${path}`, {
    ...options,
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
    if (response.status === 401 && path.startsWith("/api/portal/")) {
      window.dispatchEvent(new Event("patient-session-invalid"));
    }

    throw Object.assign(
      new Error(data?.error?.message || "The service is unavailable."),
      { status: response.status, code: data?.error?.code }
    );
  }

  if (data.csrfToken) csrfToken = data.csrfToken;
  return data;
}

export function session() {
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