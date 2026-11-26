import { useState } from "react";
import { post, params } from "./client.js";
import {
  useStaff, useResource, Resource, Confirm, dateTime
} from "./ui.jsx";

const confirmations = [
  ["authenticityConfirmed", "I checked for spam, impersonation, and fabricated content. This does not verify patient identity."],
  ["permissionConfirmed", "I checked the submitter's recorded publication consent."],
  ["privacyChecked", "I checked for medical/confidential information and other people's personal details."],
  ["neutralModerationConfirmed", "I applied neutral criteria, not whether the feedback is positive or negative."]
];

export default function ReviewModeration() {
  const { pairsFor } = useStaff();
  const pairs = pairsFor("reviews_moderate");
  const [status, setStatus] = useState("pending");
  const [pair, setPair] = useState("");
  const [offset, setOffset] = useState(0);
  const [message, setMessage] = useState("");
  const selected = pairs.find(item =>
    `${item.locationId}:${item.providerId}` === pair
  );
  const state = useResource("/reviews?" + params({
    status, offset,
    locationId: selected?.locationId,
    providerId: selected?.providerId
  }));

  return (
    <section>
      <p className="staff-eyebrow">Public feedback</p>
      <h1>Review moderation</h1>
      <p>
        Submission is not publication. Approve only content suitable for public display.
        Do not reject legitimate feedback solely because it is negative.
      </p>
      <p className="staff-help">
        Reviews are open submissions, not independently verified patient identities.
        These human checks do not establish legal or privacy compliance.
      </p>

      <div className="staff-grid">
        <label>
          Status
          <select value={status} onChange={event => {
            setStatus(event.target.value); setOffset(0); setMessage("");
          }}>
            {["pending", "approved", "rejected", "withdrawn"].map(value => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Location / provider
          <select value={pair} onChange={event => {
            setPair(event.target.value); setOffset(0); setMessage("");
          }}>
            <option value="">All permitted pairs</option>
            {pairs.map(item => (
              <option key={`${item.locationId}:${item.providerId}`}
                value={`${item.locationId}:${item.providerId}`}>
                {item.location} / {item.provider}
              </option>
            ))}
          </select>
        </label>
        <button onClick={state.reload}>Refresh queue</button>
      </div>
      <p role="status">{message}</p>

      <Resource state={state}>{data => (
        <>
          {!data.items.length && <div className="staff-empty">No matching reviews.</div>}
          {data.items.map(review => (
            <ReviewItem key={`${review.id}:${review.version}`}
              review={review} zone={data.clinicTimeZone}
              reload={state.reload}
              saved={text => {
                setMessage(text);
                state.reload();
              }} />
          ))}
          <div className="staff-actions">
            <button disabled={offset === 0}
              onClick={() => setOffset(value => Math.max(0, value - 50))}>
              Previous page
            </button>
            <span>Page {Math.floor(offset / 50) + 1}</span>
            <button disabled={data.nextOffset == null}
              onClick={() => setOffset(data.nextOffset)}>
              Next page
            </button>
          </div>
        </>
      )}</Resource>
    </section>
  );
}

function ReviewItem({ review, zone, reload, saved }) {
  const [checks, setChecks] = useState(Object.fromEntries(
    confirmations.map(([name]) => [name, false])
  ));
  const [reason, setReason] = useState("");
  const [action, setAction] = useState("");
  const [busy, setBusy] = useState(false);
  const checked = confirmations.every(([name]) => checks[name]);
  const pending = review.status === "pending";

  return (
    <article className="staff-panel workspace-review-card">
      <div className="workspace-review-heading"><div><p className="staff-eyebrow">{review.status}</p><h2>{review.displayName}</h2></div><p className="staff-help">Submitted {dateTime(review.createdAt, zone)}</p></div>
      {review.rating == null ? <p className="staff-help">No rating submitted</p> : <div className="workspace-review-rating"><span role="img" aria-label={review.rating+" out of 5 stars"}>{Array.from({length:5},(_,index)=><span key={index} aria-hidden="true" className={index<review.rating?"is-filled":""}>★</span>)}</span><strong>{review.rating}/5</strong></div>}
      <blockquote className="staff-pre">{review.text}</blockquote>
      <p>Recorded publication consent: {review.publicationConsent ? "Yes" : "No"}</p>
      {review.internalReason && (
        <p className="staff-pre">Private moderation note: {review.internalReason}</p>
      )}

      {pending && (
        <fieldset disabled={busy}>
          <legend>Checks required before publication</legend>
          {confirmations.map(([name, label]) => (
            <label className="staff-check" key={name}>
              <input type="checkbox" checked={checks[name]}
                onChange={event => setChecks(current => ({
                  ...current, [name]: event.target.checked
                }))} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
      )}

      {(pending || review.status === "approved") && (
        <>
          <label>
            Reason for rejection or hiding — private
            <textarea maxLength={500} rows={3} value={reason}
              onChange={event => setReason(event.target.value)} disabled={busy} />
          </label>
          <div className="staff-actions">
            {pending && (
              <>
                <button disabled={busy || !checked || !review.publicationConsent}
                  onClick={() => setAction("approve")}>
                  Approve and publish
                </button>
                <button className="staff-button--danger" disabled={busy || reason.trim().length < 3}
                  onClick={() => setAction("reject")}>
                  Reject
                </button>
              </>
            )}
            {review.status === "approved" && (
              <button className="staff-button--danger" disabled={busy || reason.trim().length < 3}
                onClick={() => setAction("hide")}>
                Hide from public site
              </button>
            )}
          </div>
        </>
      )}

      {action && (
        <Confirm
          title={action === "approve" ? "Approve and publish this review"
            : action === "hide" ? "Hide this review" : "Reject this review"}
          acknowledgement="I reviewed this exact submission and the publication impact."
          onCancel={() => setAction("")}
          reload={reload}
          onConfirm={async () => {
            setBusy(true);
            try {
              const result = await post(`/reviews/${review.id}/action`, {
                action, expectedVersion: review.version,
                ...(action === "approve" ? checks : { reason: reason.trim() })
              });
              saved(result.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <p>
            {action === "approve"
              ? "Approval makes the submitted name, unchanged review, and optional rating public immediately."
              : "This review will not be returned by the public reviews API."}
          </p>
        </Confirm>
      )}
    </article>
  );
}