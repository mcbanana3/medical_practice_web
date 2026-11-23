import { Link } from "react-router-dom";
import Button from "../components/Button.jsx";
import { Facts } from "../components/Content.jsx";
import Notice from "../components/Notice.jsx";
import { ph, site } from "../site.js";

export const contextItems = [
  ["Location", ph("verified location")],
  ["Appointment type", ph("verified appointment type")],
  ["Provider, if applicable", ph("verified provider")]
];

export function displayDate(value) {
  if (!value) return "Not selected";
  const [year, month, day] = value.split("-").map(Number);

  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(new Date(year, month - 1, day));
}

export const displayTime = (value) => ({
  "09:00": "9:00 AM",
  "11:30": "11:30 AM",
  "14:00": "2:00 PM"
})[value] || "Not selected";

export function PathwayStep({ go }) {
  return (
    <>
      <p className="lead">Choose the path that works for you.</p>
      <p>An account is not required for the planned guest-request journey.</p>
      <div className="pathway-card">
        <h3>Continue without an account</h3>
        <p>Explore the guest pathway. Nothing will be submitted.</p>
        <Button type="button" onClick={() => go(1)}>Continue as guest</Button>
      </div>
      <div className="pathway-card secondary">
        <h3>Returning patient</h3>
        <p>Secure sign-in and verified prefilling require a later setup step.</p>
        <Button to="/portal/login" variant="outline">Sign in</Button>
      </div>
      <div className="inline-links">
        <Link to="/portal/register">Register</Link>
        <Link to="/contact">Contact information</Link>
      </div>
    </>
  );
}

export function ContextStep() {
  return (
    <>
      <p>Location, appointment type, and provider come before date and time.</p>
      <Facts items={contextItems} />
      <Notice title="Practice configuration needed">
        This single-context preview has no verified choices. Unnecessary
        selectors are omitted. A connected system must reveal valid dependent
        choices in order.
      </Notice>
    </>
  );
}

export function DateStep({ values, update, errors, dates, minimum }) {
  return (
    <>
      <Notice title="Demonstration choices—not live availability">
        No slot is held. Clinic-local time zone: {site.timeZone}.
        The server phase must enforce capacity, expiration, and concurrency.
      </Notice>

      <div className="field">
        <label htmlFor="date">Proposed date — demonstration (required)</label>
        <input
          id="date"
          type="date"
          min={minimum || undefined}
          value={values.date}
          onChange={(event) => update("date", event.target.value)}
          aria-invalid={Boolean(errors.date)}
          aria-describedby={errors.date ? "date-error" : "date-help"}
        />
        <p id="date-help" className="help">Use the date input or equivalent date buttons below.</p>
        {errors.date && <p id="date-error" className="field-error">Error: {errors.date}</p>}
      </div>

      <div className="date-list" aria-label="Demonstration date choices">
        {dates.map((date) => (
          <button
            type="button"
            key={date}
            className={date === values.date ? "selected" : ""}
            aria-pressed={date === values.date}
            onClick={() => update("date", date)}
          >
            {displayDate(date)}
            {date === values.date && <strong>Selected</strong>}
          </button>
        ))}
      </div>

      <fieldset className="time-fieldset" aria-describedby={errors.time ? "time-error" : undefined}>
        <legend>Demonstration time (required)</legend>
        <div className="time-options">
          {["09:00", "11:30", "14:00"].map((time, index) => (
            <label key={time}>
              <input
                id={index === 0 ? "time" : undefined}
                type="radio"
                name="demo-time"
                checked={values.time === time}
                onChange={() => update("time", time)}
                aria-invalid={Boolean(errors.time)}
              />
              <span>{displayTime(time)}</span>
              <small>Demonstration only</small>
            </label>
          ))}
        </div>
        {errors.time && <p id="time-error" className="field-error">Error: {errors.time}</p>}
      </fieldset>
    </>
  );
}

export function ContactStep({ values, update, errors }) {
  return (
    <>
      <Notice title="Use invented test details only">
        Do not enter real patient information or medical details.
        These are illustrative fields—not approved identity requirements.
      </Notice>
      <p className="privacy-link"><Link to="/privacy">Website Privacy Notice</Link></p>

      {[
        ["name", "Test name", "text"],
        ["email", "Test email", "email"]
      ].map(([field, label, type]) => (
        <div className="field" key={field}>
          <label htmlFor={field}>{label} (required)</label>
          <input
            id={field}
            type={type}
            autoComplete="off"
            spellCheck="false"
            maxLength={field === "name" ? 100 : 254}
            value={values[field]}
            onChange={(event) => update(field, event.target.value)}
            aria-invalid={Boolean(errors[field])}
            aria-describedby={errors[field] ? `${field}-error` : undefined}
          />
          {errors[field] && (
            <p id={`${field}-error`} className="field-error">Error: {errors[field]}</p>
          )}
        </div>
      ))}

      <p className="help">Example test email: alex@example.com. No email is sent.</p>
    </>
  );
}

export function ReviewStep({ values, go }) {
  return (
    <>
      <Notice title="Review only—submission is not connected">
        A connected submission creates a pending request, not a confirmed appointment.
      </Notice>
      <Facts items={[
        ...contextItems,
        ["Demonstration date", displayDate(values.date)],
        ["Demonstration time", displayTime(values.time)],
        ["Clinic time zone", site.timeZone],
        ["Test name", values.name],
        ["Test email", values.email],
        ["Contact channel — preview", "Email; delivery is not connected"]
      ]} />

      <div className="inline-links">
        <button className="text-button" type="button" onClick={() => go(1)}>Edit context</button>
        <button className="text-button" type="button" onClick={() => go(2)}>Edit date and time</button>
        <button className="text-button" type="button" onClick={() => go(3)}>Edit test details</button>
      </div>
    </>
  );
}