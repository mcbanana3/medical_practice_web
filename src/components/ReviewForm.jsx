import { useEffect, useRef, useState } from "react";
import Button from "./Button.jsx";
import Notice from "./Notice.jsx";

const initialValues = {
  displayName: "",
  text: "",
  previewAcknowledged: false
};

export default function ReviewForm() {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const summary = useRef(null);

  useEffect(() => {
    if (Object.keys(errors).length) {
      summary.current?.focus();
    }
  }, [errors]);

  function update(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
    setMessage("");

    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function submit(event) {
    event.preventDefault();

    const next = {};

    if (!values.displayName.trim()) {
      next.displayName = "Enter an invented test display name.";
    }

    if (values.text.trim().length < 10) {
      next.text = "Enter at least 10 characters of non-medical test text.";
    }

    if (!values.previewAcknowledged) {
      next.previewAcknowledged = "Acknowledge the demonstration limitations.";
    }

    setErrors(next);

    if (Object.keys(next).length) return;

    setMessage(
      "Not submitted. This preview cannot send, store, approve, or publish " +
      "reviews. No review is waiting for the doctor. Secure submission and " +
      "doctor moderation are available in the later backend setup."
    );
  }

  return (
    <div className="review-form-panel">
      <div className="review-form-heading">
        <p className="eyebrow">Share feedback</p>
        <h2>A thoughtful space for feedback.</h2>
        <p>
          The planned workflow requires doctor approval before anything
          appears publicly.
        </p>
      </div>

      <Notice title="Demonstration only — use invented test details">
        Do not enter real patient information, symptoms, diagnoses, treatment
        details, or information about other people. Entries stay only in this
        page’s memory and disappear when you leave or refresh.
      </Notice>

      {Object.keys(errors).length > 0 && (
        <div
          className="error-summary"
          ref={summary}
          tabIndex="-1"
          role="alert"
        >
          <h3>Please check the following</h3>
          <ul>
            {Object.entries(errors).map(([field, error]) => (
              <li key={field}>
                <a
                  href={`#review-${field}`}
                  onClick={(event) => {
                    event.preventDefault();
                    document.getElementById(`review-${field}`)?.focus();
                  }}
                >
                  {error}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form noValidate onSubmit={submit}>
        <div className="field">
          <label htmlFor="review-displayName">
            Test display name (required)
          </label>
          <input
            id="review-displayName"
            type="text"
            autoComplete="off"
            maxLength={80}
            value={values.displayName}
            onChange={(event) => update("displayName", event.target.value)}
            aria-invalid={Boolean(errors.displayName)}
            aria-describedby={
              errors.displayName ? "review-name-error" : undefined
            }
          />
          {errors.displayName && (
            <p id="review-name-error" className="field-error">
              Error: {errors.displayName}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="review-text">
            Non-medical test feedback (required)
          </label>
          <textarea
            id="review-text"
            rows="6"
            maxLength={2000}
            value={values.text}
            onChange={(event) => update("text", event.target.value)}
            aria-invalid={Boolean(errors.text)}
            aria-describedby={[
              "review-text-help",
              errors.text ? "review-text-error" : ""
            ].filter(Boolean).join(" ")}
          />
          <p id="review-text-help" className="help">
            Interface demonstration limit: 2,000 characters.
            Do not include private or clinical information.
          </p>
          {errors.text && (
            <p id="review-text-error" className="field-error">
              Error: {errors.text}
            </p>
          )}
        </div>

        <div className="review-acknowledgement">
          <label>
            <input
              id="review-previewAcknowledged"
              type="checkbox"
              checked={values.previewAcknowledged}
              onChange={(event) => update(
                "previewAcknowledged",
                event.target.checked
              )}
              aria-invalid={Boolean(errors.previewAcknowledged)}
              aria-describedby={
                errors.previewAcknowledged
                  ? "review-acknowledgement-error"
                  : "review-permission-help"
              }
            />
            <span>
              I understand this demonstration sends and publishes nothing.
            </span>
          </label>

          {errors.previewAcknowledged && (
            <p id="review-acknowledgement-error" className="field-error">
              Error: {errors.previewAcknowledged}
            </p>
          )}
        </div>

        <p id="review-permission-help" className="help">
          This checkbox is not publication permission. Final permission
          wording and evidence collection require practice/privacy review.
        </p>

        <div className="button-row">
          <Button type="submit">Submit review for approval</Button>
          <Button
            type="button"
            variant="outline"
            arrow={false}
            onClick={() => {
              setValues(initialValues);
              setErrors({});
              setMessage("");
            }}
          >
            Clear test fields
          </Button>
        </div>

        <div role="status" aria-live="polite" className="outcome">
          {message && <Notice title="Not submitted">{message}</Notice>}
        </div>
      </form>
    </div>
  );
}