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

function Stars({ rating }) {
 return <span className="review-stars" role="img" aria-label={`${rating} out of 5 stars`}>{[1,2,3,4,5].map(n => <span key={n} aria-hidden="true" className={n <= rating ? "is-filled" : ""}>&#9733;</span>)}</span>;
}
export function PublishedReviews({ limit = 12, paginated = true }) {
  const size = Math.max(1, Math.min(24, Number(limit) || 12));
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState("newest");
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState({ items: [], nextOffset: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    request(`?limit=${size}&offset=${offset}&sort=${sort}`, undefined, controller.signal)
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
  }, [size, offset, revision, sort]);

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
        <p className="help">Feedback shared by our community</p>
 {paginated && <label className="review-sort">Sort by<select value={sort} onChange={e => { setSort(e.target.value); setOffset(0); }}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="highest">Highest rated</option><option value="lowest">Lowest rated</option></select></label>}
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
                <header className="review-card-top"><span className="review-avatar" aria-hidden="true">{review.displayName.trim().slice(0,1).toUpperCase()}</span><div className="review-identity"><strong>{review.displayName}</strong><time dateTime={review.createdAt || review.approvedAt}>{new Intl.DateTimeFormat("en-US", {month:"long",day:"numeric",year:"numeric",timeZone:"America/Chicago"}).format(new Date(review.createdAt || review.approvedAt))}</time></div></header>
                {review.rating !== null ? <Stars rating={review.rating} /> : <span className="help">No rating provided</span>}
                <blockquote><p>{review.text}</p></blockquote>
                <footer className="review-card-footer"><span className="review-published-badge">Administrator approved</span><span className="help">Website review</span></footer>
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
  const [rating, setRating] = useState(0);
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
      <section id="share-review" className="review-form-panel reviews-live-form">
        <p className="eyebrow">Share feedback</p>
        <h2>Your experience, in your words.</h2>
        <p>
          No account is required. Your submission stays private until the
          practice approves it. Positive and negative feedback are welcome.
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
        ) : loading ? <p role="status">Loading review form…</p> : pairs.length !== 1 ? (
          <div>
            <p>Review submission is temporarily unavailable.</p>
            <button type="button" onClick={() => setRevision(value => value + 1)}>Retry</button>
          </div>
        ) : (
          <form aria-busy={busy} onSubmit={async event => {
            event.preventDefault();
            const form = event.currentTarget;
            const fields = Object.fromEntries(new FormData(form));
            const selected = pairs.length === 1 ? pairs[0] : null;
            if (!selected || !token || busy || !rating) return;
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
                rating,
                publicationConsent: true,
                captchaToken: token
              });
              setSaved(result);
              form.reset();
              setRating(0);
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
              <label htmlFor={prefix + "-name"}>Public display name — optional</label>
              <input id={prefix + "-name"} name="displayName" maxLength={80}
                autoComplete="off" />
              <fieldset className="review-rating-picker"><legend>Your rating (required)</legend><div className="review-rating-options">{[1,2,3,4,5].map(n => <label key={n} className={n <= rating ? "is-filled" : ""}><input type="radio" name="rating" value={n} required checked={rating === n} onChange={() => setRating(n)} /><span aria-hidden="true">&#9733;</span><span className="sr-only">{n} {n === 1 ? "star" : "stars"}</span></label>)}</div><p className="help" aria-live="polite">{rating ? `${rating} out of 5 stars` : "Select a star to rate your experience"}</p></fieldset>
              <label htmlFor={prefix + "-text"}>Your review</label>
              <textarea id={prefix + "-text"} name="text" required
                minLength={10} maxLength={3000} rows={6} />
              <label className="reviews-live-check">
                <input type="checkbox" required />
                <span>
                  I consent to public display of my submitted name, review, and
                  rating if approved.
                </span>
              </label>
              <Recaptcha ref={captcha} onToken={onToken} />
              <button disabled={!token || !rating || busy}>
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