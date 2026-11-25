import {
  useCallback, useEffect, useId, useRef, useState
} from "react";
import Recaptcha from "./Recaptcha.jsx";
import "./reviews-live.css";

const BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

async function request(path = "", body, externalSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (externalSignal?.aborted) abort();
  else externalSignal?.addEventListener("abort", abort, { once: true });
  const timer = window.setTimeout(abort, 15000);

  try {
    const response = await fetch(BASE + "/api/public/reviews" + path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      throw new Error(data?.error?.message || "The reviews response could not be verified.");
    }
    return data;
  } catch (error) {
    if (externalSignal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (error.name === "AbortError") {
      throw new Error("The request timed out. A submission may have succeeded; retry the same review after another security check.");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abort);
  }
}

function ErrorMessage({ error }) {
  const ref = useRef(null);
  useEffect(() => { if (error) ref.current?.focus(); }, [error]);
  return error ? (
    <div className="reviews-live-error" role="alert" tabIndex={-1} ref={ref}>
      {error.message || String(error)}
    </div>
  ) : null;
}

export function PublishedReviews({ limit = 12, paginated = true }) {
  const size = Math.max(1, Math.min(24, Number(limit) || 12));
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState({ items: [], nextOffset: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    request(`?limit=${size}&offset=${offset}`, undefined, controller.signal)
      .then(result => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch(failure => {
        if (!controller.signal.aborted) setError(failure);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [size, offset, revision]);

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    const timer = window.setInterval(() => {
      if (!document.hidden) refresh();
    }, 30000);
    window.addEventListener("practice-reviews-updated", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("practice-reviews-updated", refresh);
    };
  }, []);

  return (
    <div className="live-reviews" aria-busy={loading}>
      <div className="reviews-live-toolbar">
        <p className="help">Only administrator-approved submissions appear here.</p>
        <button type="button" disabled={loading}
          onClick={() => setRevision(value => value + 1)}>
          Refresh reviews
        </button>
      </div>
      <p role="status">{loading ? "Loading approved reviews…" : ""}</p>
      <ErrorMessage error={error} />
      {!error && (
        <>
          {!loading && !data.items.length && (
            <div className="reviews-empty">
              <h3>No approved reviews are available on this page.</h3>
            </div>
          )}
          <div className="reviews-grid">
            {data.items.map(review => (
              <article className="review-card" key={review.id}>
                <div className="review-card-top">
                  <span className="review-type">Website review</span>
                </div>
                <blockquote><p>{review.text}</p></blockquote>
                <footer className="review-card-footer">
                  <strong>{review.displayName}</strong>
                  {review.rating !== null && (
                    <span>Submitted rating: {review.rating} out of 5</span>
                  )}
                  <span className="help">{review.sourceLabel}</span>
                </footer>
              </article>
            ))}
          </div>
          {paginated && (
            <div className="reviews-live-toolbar">
              <button disabled={loading || offset === 0}
                onClick={() => setOffset(value => Math.max(0, value - size))}>
                Previous
              </button>
              <span>Page {Math.floor(offset / size) + 1}</span>
              <button disabled={loading || data.nextOffset == null}
                onClick={() => setOffset(data.nextOffset)}>
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function ReviewForm() {
  const prefix = useId();
  const captcha = useRef(null);
  const submissionKey = useRef("");
  const [pairs, setPairs] = useState([]);
  const [pair, setPair] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [revision, setRevision] = useState(0);
  const onToken = useCallback(value => setToken(value || ""), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    request("/options", undefined, controller.signal)
      .then(data => {
        if (controller.signal.aborted) return;
        setPairs(data.items);
        setPair(data.items.length === 1
          ? `${data.items[0].locationId}:${data.items[0].providerId}` : "");
      })
      .catch(failure => {
        if (!controller.signal.aborted) setError(failure);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);

  return (
    <div className="live-reviews">
      <section className="review-form-panel reviews-live-form">
        <p className="eyebrow">Share feedback</p>
        <h2>Your experience, in your words.</h2>
        <p>
          No account is required. Your submission stays private until an
          administrator approves it. Positive and negative feedback are welcome.
        </p>
        <p className="help">
          Do not include medical records, diagnoses, contact details, or information
          about other people. A public review may reveal an association with the practice.
          This form is not for medical advice or urgent requests.
        </p>
        <ErrorMessage error={error} />

        {saved ? (
          <div role="status">
            <p>{saved.message}</p>
            <label htmlFor={prefix + "-saved"}>Save your private withdrawal code</label>
            <input id={prefix + "-saved"} readOnly autoComplete="off"
              value={saved.withdrawalCode} onFocus={e => e.target.select()} />
            <p className="help">
              Anyone with this code can withdraw the review after a security check.
              Save it privately; it is not stored in your browser.
            </p>
            <button type="button" onClick={() => {
              submissionKey.current = "";
              setSaved(null);
              setError(null);
            }}>Write another review</button>
          </div>
        ) : loading ? <p role="status">Loading review form…</p> : !pairs.length ? (
          <div>
            <p>Review submission is temporarily unavailable.</p>
            <button type="button" onClick={() => setRevision(value => value + 1)}>Retry</button>
          </div>
        ) : (
          <form aria-busy={busy} onSubmit={async event => {
            event.preventDefault();
            const form = event.currentTarget;
            const fields = Object.fromEntries(new FormData(form));
            const selected = pairs.find(item =>
              `${item.locationId}:${item.providerId}` === pair
            );
            if (!selected || !token || busy) return;
            setBusy(true);
            setError(null);
            try {
              if (!submissionKey.current) submissionKey.current = crypto.randomUUID();
              const result = await request("", {
                idempotencyKey: submissionKey.current,
                locationId: Number(selected.locationId),
                providerId: Number(selected.providerId),
                displayName: fields.displayName || "",
                text: fields.text,
                rating: fields.rating ? Number(fields.rating) : null,
                publicationConsent: true,
                captchaToken: token
              });
              setSaved(result);
              form.reset();
            } catch (failure) {
              setError(failure);
            } finally {
              setBusy(false);
              setToken("");
              captcha.current?.reset();
            }
          }}>
            <fieldset disabled={busy}>
              <legend>Review details</legend>
              <label htmlFor={prefix + "-pair"}>Location / provider</label>
              <select id={prefix + "-pair"} required value={pair}
                onChange={e => setPair(e.target.value)}>
                <option value="">Choose a location and provider</option>
                {pairs.map(item => (
                  <option key={`${item.locationId}:${item.providerId}`}
                    value={`${item.locationId}:${item.providerId}`}>
                    {item.location} — {item.provider}
                  </option>
                ))}
              </select>
              <label htmlFor={prefix + "-name"}>Public display name — optional</label>
              <input id={prefix + "-name"} name="displayName" maxLength={80}
                autoComplete="off" placeholder="Anonymous if left blank" />
              <label htmlFor={prefix + "-rating"}>Rating — optional</label>
              <select id={prefix + "-rating"} name="rating" defaultValue="">
                <option value="">No rating</option>
                {[1, 2, 3, 4, 5].map(value => (
                  <option key={value} value={value}>{value} out of 5</option>
                ))}
              </select>
              <label htmlFor={prefix + "-text"}>Your review</label>
              <textarea id={prefix + "-text"} name="text" required
                minLength={10} maxLength={3000} rows={6} />
              <label className="reviews-live-check">
                <input type="checkbox" required />
                <span>
                  I consent to public display of my submitted name, review, and
                  optional rating if approved.
                </span>
              </label>
              <Recaptcha ref={captcha} onToken={onToken} />
              <button disabled={!token || !pair || busy}>
                {busy ? "Submitting…" : "Submit for approval"}
              </button>
            </fieldset>
          </form>
        )}
      </section>
      <WithdrawalForm />
    </div>
  );
}

function WithdrawalForm() {
  const captcha = useRef(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState("");
  const onToken = useCallback(value => setToken(value || ""), []);

  return (
    <details className="reviews-live-form">
      <summary>Withdraw a review using your private code</summary>
      <ErrorMessage error={error} />
      <p role="status">{message}</p>
      <form onSubmit={async event => {
        event.preventDefault();
        const form = event.currentTarget;
        if (busy || !token) return;
        setBusy(true);
        setError(null);
        try {
          const fields = new FormData(form);
          const result = await request("/withdraw", {
            code: String(fields.get("code") || "").trim(),
            captchaToken: token
          });
          form.reset();
          setMessage(result.message);
          window.dispatchEvent(new Event("practice-reviews-updated"));
        } catch (failure) {
          setError(failure);
        } finally {
          setBusy(false);
          setToken("");
          captcha.current?.reset();
        }
      }}>
        <fieldset disabled={busy}>
          <legend>Review withdrawal</legend>
          <label>
            Private withdrawal code
            <input name="code" required maxLength={64}
              pattern="[a-f0-9]{64}" autoComplete="off" spellCheck={false} />
          </label>
          <Recaptcha ref={captcha} onToken={onToken} />
          <button disabled={!token || busy}>
            {busy ? "Withdrawing…" : "Withdraw review"}
          </button>
          <p className="help">
            Withdrawal removes website publication, not copies already saved elsewhere.
          </p>
        </fieldset>
      </form>
    </details>
  );
}