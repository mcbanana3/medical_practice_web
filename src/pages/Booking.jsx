import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import Button from "../components/Button.jsx";
import { Facts } from "../components/Content.jsx";
import Icon from "../components/Icon.jsx";
import Notice, { EmergencyNotice } from "../components/Notice.jsx";
import PageIntro from "../components/PageIntro.jsx";
import Recaptcha from "../components/Recaptcha.jsx";
import "./booking-live.css";

import PhoneField, {
  phoneError
} from "../components/PhoneField.jsx";

const API = import.meta.env.VITE_API_BASE_URL || "";
const RETRY_STORAGE = "appointment-submission-retry-key";
const steps = ["Patient pathway", "Appointment context", "Date and time", "Contact details", "Review"];

async function api(path, options = {}) {
  let response;

  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      cache: "no-store",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers
      }
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw Object.assign(new Error("The connection was interrupted."), {
      status: 0,
      code: "NETWORK_ERROR"
    });
  }

  const data = await response.json().catch(() => null);

  if (!response.ok || !data) {
    throw Object.assign(
      new Error(data?.error?.message || "The operation could not be verified."),
      {
        status: data ? response.status : 500,
        code: data?.error?.code || "UNKNOWN_OUTCOME",
        fields: data?.error?.fields || {}
      }
    );
  }

  return data;
}

function uniqueOptions(rows, idKey, nameKey) {
  return [...new Map(
    rows.map((row) => [String(row[idKey]), {
      id: String(row[idKey]),
      name: row[nameKey]
    }])
  ).values()];
}

function resolveChoice(options, current) {
  if (options.some((option) => option.id === current)) return current;
  return options.length === 1 ? options[0].id : "";
}

function Choice({ id, label, options, value, onChange }) {
  if (options.length === 1) {
    return <Facts items={[[label, options[0].name]]} />;
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label} (required)</label>
      <select
        id={id}
        value={value}
        disabled={!options.length}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Choose {label.toLowerCase()}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>{option.name}</option>
        ))}
      </select>
    </div>
  );
}

export default function Booking() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [metadata, setMetadata] = useState(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [context, setContext] = useState({ location: "", type: "", provider: "" });
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState([]);
  const [slot, setSlot] = useState(null);
  const [slotLoading, setSlotLoading] = useState(false);
  const [contact, setContact] = useState({ name: "", email: "", phone: "" });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [captcha, setCaptcha] = useState("");

  const captchaWidget = useRef(null);
  const pending = useRef(null);
  const submitting = useRef(false);
  const summary = useRef(null);
  const title = useRef(null);
  const previousStep = useRef(0);

  const rows = metadata?.options || [];
  const locations = uniqueOptions(rows, "locationId", "locationName");
  const locationRows = rows.filter((row) => String(row.locationId) === context.location);
  const types = uniqueOptions(locationRows, "typeId", "typeName");
  const typeRows = locationRows.filter((row) => String(row.typeId) === context.type);
  const providers = uniqueOptions(typeRows, "providerId", "providerName");
  const chosen = typeRows.find((row) => String(row.providerId) === context.provider);

  useEffect(() => {
    try {
      const key = sessionStorage.getItem(RETRY_STORAGE);
      if (/^[a-f0-9-]{36}$/i.test(key || "")) {
        pending.current = { key, body: null };
        setUncertain(true);
        setStep(4);
        setMessage(
          "A previous submission needs an outcome check. Contact details were not retained. Complete the security check to recover its receipt."
        );
      }
    } catch {
      // The active page can still retain its retry key in memory.
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setMetaLoading(true);

    api("/api/booking/options", { signal: controller.signal })
      .then((data) => {
        setMetadata(data);
        setDate((current) => current || data.minDate);
      })
      .catch((error) => {
        if (error.name !== "AbortError") setMessage(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setMetaLoading(false);
      });

    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    setContext((current) => {
      const location = resolveChoice(locations, current.location);
      const matchingLocation = rows.filter((row) => String(row.locationId) === location);
      const type = resolveChoice(
        uniqueOptions(matchingLocation, "typeId", "typeName"),
        current.type
      );
      const matchingType = matchingLocation.filter((row) => String(row.typeId) === type);
      const provider = resolveChoice(
        uniqueOptions(matchingType, "providerId", "providerName"),
        current.provider
      );

      return (
        location === current.location &&
        type === current.type &&
        provider === current.provider
      ) ? current : { location, type, provider };
    });
  }, [metadata, context.location, context.type, context.provider]);

  useEffect(() => {
    setSlot(null);
    setSlots([]);

    if (!chosen || !date || uncertain) {
      setSlotLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setSlotLoading(true);

    const parameters = new URLSearchParams({
      locationId: String(chosen.locationId),
      typeId: String(chosen.typeId),
      providerId: String(chosen.providerId),
      date
    });

    api(`/api/booking/availability?${parameters}`, { signal: controller.signal })
      .then((data) => setSlots(data.slots))
      .catch((error) => {
        if (error.name !== "AbortError") setMessage(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSlotLoading(false);
      });

    return () => controller.abort();
  }, [chosen?.locationId, chosen?.providerId, chosen?.typeId, date, reload, uncertain]);

  useEffect(() => {
    if (previousStep.current !== step) {
      title.current?.focus({ preventScroll: true });
      title.current?.scrollIntoView({ block: "start", behavior: "instant" });
    }
    previousStep.current = step;
  }, [step]);

  useEffect(() => {
    if (Object.keys(errors).length) summary.current?.focus();
  }, [errors]);

  useEffect(() => {
    if (!uncertain) return undefined;

    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uncertain]);

  function go(next) {
    if (busy || uncertain) return;
    setErrors({});
    setMessage("");
    setStep(next);
  }

  function clearRetry() {
    pending.current = null;
    try { sessionStorage.removeItem(RETRY_STORAGE); } catch { }
  }

  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;

    const next = {};

    if (step === 1 && !chosen) next.context = "Choose a valid appointment combination.";
    if (step === 2) {
      if (!date) next.date = "Choose a date.";
      if (!slot) next.time = "Choose a currently available time.";
    }
    if (step === 3) {
      if (!contact.name.trim()) next.name = "Enter your name.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim())) {
        next.email = "Enter a valid email address.";
      }
      const invalidPhone = phoneError(contact.phone);
      if (invalidPhone) {
        next.phone = invalidPhone;
      }
    }
    if (step === 4 && !captcha) next.captcha = "Complete the security check.";

    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }

    if (step < 4) {
      go(step + 1);
      return;
    }

    const wasUncertain = uncertain;
    const recovering = wasUncertain && !pending.current?.body;

    if (!recovering && !pending.current) {
      if (!chosen || !slot) {
        setMessage("Choose current availability before submitting.");
        return;
      }

      pending.current = {
        key: crypto.randomUUID(),
        body: {
          locationId: chosen.locationId,
          providerId: chosen.providerId,
          typeId: chosen.typeId,
          startsAt: slot.startsAt,
          name: contact.name.trim(),
          email: contact.email.trim(),
          phone: contact.phone.trim()
        }
      };
    }

    try {
      sessionStorage.setItem(RETRY_STORAGE, pending.current.key);
    } catch { }

    submitting.current = true;
    setBusy(true);
    setErrors({});
    setMessage("");

    try {
      const result = recovering
        ? await api("/api/booking/receipt", {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: pending.current.key,
            captchaToken: captcha
          })
        })
        : await api("/api/booking/requests", {
          method: "POST",
          headers: { "Idempotency-Key": pending.current.key },
          body: JSON.stringify({
            ...pending.current.body,
            captchaToken: captcha
          })
        });

      clearRetry();

      navigate("/request-an-appointment/received", {
        replace: true,
        state: { receipt: result.receipt }
      });
    } catch (error) {
      setMessage(error.message);

      if (
        wasUncertain ||
        error.status === 0 ||
        error.status >= 500 ||
        error.code === "IDEMPOTENCY_MISMATCH"
      ) {
        setUncertain(true);
        if (error.code === "IDEMPOTENCY_MISMATCH") {
          pending.current.body = null;
        }
      } else {
        clearRetry();

        if (error.code === "SLOT_UNAVAILABLE") {
          setStep(2);
          setSlot(null);
          setReload((value) => value + 1);
        }

        const serverFields = error.fields || {};
        const contactErrors = {};

        if (serverFields.name) contactErrors.name = serverFields.name;
        if (serverFields.email) contactErrors.email = serverFields.email;

        if (Object.keys(contactErrors).length) {
          setErrors(contactErrors);
          setStep(3);
        }
      }
    } finally {
      submitting.current = false;
      setBusy(false);
      setCaptcha("");
      captchaWidget.current?.reset();
    }
  }

  const appointmentFacts = chosen ? [
    ["Location", chosen.locationName],
    ["Appointment type", chosen.typeName],
    ["Provider", chosen.providerName],
    ["Clinic time zone", metadata.clinicTimeZone],
    ["Contact number", contact.phone || "Not provided"],
  ] : [];

  return (
    <>
      <PageIntro eyebrow="Appointments" title="Request an appointment.">
        <p>Requests remain pending until staff approval. Submission is not confirmation.</p>
      </PageIntro>

      <section className="section section-tight booking-live">
        <div className="container">
          <EmergencyNotice />

          {metadata?.fixtureData && (
            <Notice title="Development fixtures — not a real practice schedule">
              Use invented test contact details only. These location, provider,
              appointment-type, and schedule records are development fixtures.
            </Notice>
          )}

          <p className="help booking-storage-note">
            Contact fields stay in page memory. An opaque retry key is kept
            in session storage to help verify an interrupted submission.
            No contact details are stored there.
          </p>

          <ol className="booking-progress" aria-label="Appointment request steps">
            {steps.map((label, index) => (
              <li
                key={label}
                className={index === step ? "current" : index < step ? "complete" : ""}
                aria-current={index === step ? "step" : undefined}
              >
                <span className="progress-number" aria-hidden="true">
                  {index < step ? <Icon name="check" /> : index + 1}
                </span>
                <span>{label}</span>
              </li>
            ))}
          </ol>

          <div className="booking-shell">
            <div className="booking-main">
              <p className="eyebrow">Step {step + 1} of {steps.length}</p>
              <h2 ref={title} tabIndex="-1">{steps[step]}</h2>

              {metaLoading && <p role="status">Loading appointment options…</p>}

              {message && (
                <div className="booking-message" role="alert">
                  <Notice title={uncertain ? "Submission outcome needs checking" : "Please note"}>
                    {message}
                  </Notice>
                </div>
              )}

              {uncertain && (
                <Notice title="Do not start a second request">
                  Complete a new security check and use the same submission
                  button to check or safely retry the original request.
                  The retry key will be reused.
                </Notice>
              )}

              {Object.keys(errors).length > 0 && (
                <div className="error-summary" ref={summary} tabIndex="-1" role="alert">
                  <h3>Please check the following</h3>
                  <ul>
                    {Object.entries(errors).map(([field, error]) => (
                      <li key={field}>
                        <a href={`#booking-${field}`} onClick={(event) => {
                          event.preventDefault();
                          document.getElementById(`booking-${field}`)?.focus();
                        }}>{error}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {step === 0 ? (
                <>
                  <p className="lead">Choose the path that works for you.</p>
                  <div className="pathway-card">
                    <h3>Continue without an account</h3>
                    <p>You can request an appointment as a guest.</p>
                    <Button
                      type="button"
                      disabled={!metadata || !rows.length}
                      onClick={() => go(1)}
                    >
                      Continue as guest
                    </Button>
                  </div>
                  <div className="pathway-card secondary">
                    <h3>Returning patient</h3>
                    <p>Secure portal access is a separate setup step. Guest requests remain available.</p>
                    <Button to="/portal/login" variant="outline">Sign in</Button>
                  </div>
                  {!metaLoading && !rows.length && (
                    <div className="booking-message">
                      <Notice title="No request options are currently available">
                        This does not mean the practice is closed.
                        Use the verified practice contact for assistance.
                      </Notice>
                      <Button type="button" variant="outline" onClick={() => setReload((v) => v + 1)}>
                        Retry availability setup
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <form noValidate onSubmit={submit}>
                  {step === 1 && (
                    <div id="booking-context" tabIndex="-1">
                      <Choice
                        id="booking-location" label="Location"
                        options={locations} value={context.location}
                        onChange={(location) => {
                          clearRetry();
                          setContext({ location, type: "", provider: "" });
                        }}
                      />
                      <Choice
                        id="booking-type" label="Appointment type"
                        options={types} value={context.type}
                        onChange={(type) => {
                          clearRetry();
                          setContext((value) => ({ ...value, type, provider: "" }));
                        }}
                      />
                      <Choice
                        id="booking-provider" label="Provider"
                        options={providers} value={context.provider}
                        onChange={(provider) => {
                          clearRetry();
                          setContext((value) => ({ ...value, provider }));
                        }}
                      />
                      {errors.context && <p className="field-error">{errors.context}</p>}
                    </div>
                  )}

                  {step === 2 && (
                    <>
                      <Facts items={appointmentFacts} />
                      <div className="field">
                        <label htmlFor="booking-date">Clinic-local date (required)</label>
                        <input
                          id="booking-date" type="date"
                          min={metadata?.minDate} max={metadata?.maxDate}
                          value={date}
                          onChange={(event) => {
                            clearRetry();
                            setMessage("");
                            setDate(event.target.value);
                          }}
                          aria-invalid={Boolean(errors.date)}
                          aria-describedby={errors.date ? "booking-date-error" : undefined}
                        />
                        {errors.date && <p id="booking-date-error" className="field-error">{errors.date}</p>}
                      </div>

                      <div className="date-list" aria-label="Equivalent clinic-local date navigation">
                        {metadata?.dateChoices.map((value) => (
                          <button
                            type="button" key={value}
                            aria-pressed={date === value}
                            className={date === value ? "selected" : ""}
                            onClick={() => {
                              clearRetry();
                              setMessage("");
                              setDate(value);
                            }}
                          >
                            {value}{date === value && <strong>Selected</strong>}
                          </button>
                        ))}
                      </div>

                      <div aria-busy={slotLoading}>
                        <p role="status">{slotLoading ? "Loading current available times…" : ""}</p>
                        {!slotLoading && !slots.length && (
                          <Notice title="No available times for this date">
                            Choose another date or appointment context.
                          </Notice>
                        )}

                        <fieldset className="time-fieldset" aria-describedby={errors.time ? "booking-time-error" : undefined}>
                          <legend>Available clinic-local times (required)</legend>
                          <div className="time-options live-time-options">
                            {slots.map((item, index) => (
                              <label key={item.startsAt}>
                                <input
                                  id={index === 0 ? "booking-time" : undefined}
                                  type="radio" name="available-time"
                                  checked={slot?.startsAt === item.startsAt}
                                  onChange={() => {
                                    clearRetry();
                                    setSlot(item);
                                  }}
                                />
                                <span>{item.label}</span>
                              </label>
                            ))}
                          </div>
                          {!slots.length && <div id="booking-time" tabIndex="-1" />}
                          {errors.time && <p id="booking-time-error" className="field-error">{errors.time}</p>}
                        </fieldset>
                      </div>

                      <p className="help">
                        Time zone: {metadata?.clinicTimeZone}. Availability is
                        checked again during submission. Selecting a time does not hold it.
                      </p>
                    </>
                  )}

                  {step === 3 && (
                    <>
                      <p>We need your name and email for this approved request pathway.</p>
                      <p className="help">Do not include medical details.</p>
                      <p><Link to="/privacy">Website Privacy Notice</Link></p>

                      {[
                        ["name", "Name", "text", "name"],
                        ["email", "Email", "email", "email"]
                      ].map(([field, label, type, autoComplete]) => (
                        <div className="field" key={field}>
                          <label htmlFor={`booking-${field}`}>{label} (required)</label>
                          <input
                            id={`booking-${field}`}
                            type={type}
                            autoComplete={autoComplete}
                            maxLength={field === "name" ? 100 : 254}
                            value={contact[field]}
                            onChange={(event) => {
                              clearRetry();
                              setContact((value) => ({
                                ...value,
                                [field]: event.target.value
                              }));
                            }}
                            aria-invalid={Boolean(errors[field])}
                            aria-describedby={
                              errors[field] ? `booking-${field}-error` : undefined
                            }
                          />
                          {errors[field] && (
                            <p id={`booking-${field}-error`} className="field-error">
                              {errors[field]}
                            </p>
                          )}
                        </div>
                      ))}

                      {/* Add PhoneField here, after Email */}
                      <PhoneField
                        id="booking-phone"
                        value={contact.phone}
                        error={errors.phone}
                        onChange={(value) => {
                          clearRetry();
                          setContact((current) => ({
                            ...current,
                            phone: value
                          }));
                        }}
                      />
                    </>
                  )}

                  {step === 4 && (
                    <>
                      <Notice title="Staff approval is required">
                        Submitting creates a pending request, not a confirmed appointment.
                      </Notice>

                      {pending.current?.body === null && uncertain ? (
                        <p className="help">
                          Recovering a previous submission receipt. No contact details were retained.
                        </p>
                      ) : (
                        <Facts items={[
                          ...appointmentFacts,
                          ["Clinic-local date", date],
                          ["Time with UTC offset", slot?.label || "Not selected"],
                          ["Name", contact.name],
                          ["Contact channel", contact.email]
                        ]} />
                      )}

                      {!uncertain && (
                        <div className="inline-links">
                          <button type="button" className="text-button" onClick={() => go(1)}>Edit context</button>
                          <button type="button" className="text-button" onClick={() => go(2)}>Edit date and time</button>
                          <button type="button" className="text-button" onClick={() => go(3)}>Edit contact details</button>
                        </div>
                      )}

                      <Recaptcha
                        ref={captchaWidget}
                        onToken={(token) => {
                          setCaptcha(token);
                          if (token) {
                            setErrors((current) => {
                              const next = { ...current };
                              delete next.captcha;
                              return next;
                            });
                          }
                        }}
                      />
                      {errors.captcha && <p className="field-error">{errors.captcha}</p>}
                    </>
                  )}

                  <div className="form-actions">
                    <Button
                      type="button" variant="outline" arrow={false}
                      disabled={busy || uncertain}
                      onClick={() => go(step - 1)}
                    >Back</Button>
                    <Button type="submit" disabled={busy}>
                      {busy
                        ? "Checking request…"
                        : step === 4
                          ? "Submit appointment request"
                          : "Continue"}
                    </Button>
                  </div>

                  <p role="status" className="help">
                    {busy ? "Please wait. Do not submit another request." : ""}
                  </p>
                </form>
              )}
            </div>

            <aside className="booking-aside">
              <p className="eyebrow">At a glance</p>
              <h3>A request is the first step.</h3>
              <p>Only staff approval produces a confirmed appointment.</p>
              <hr />
              <p>{date || "Date not selected"}</p>
              <p>{slot?.label || "Time not selected"}</p>
              <p>{metadata?.clinicTimeZone || "[PLACEHOLDER: clinic time zone]"}</p>
              <hr />
              <p>{metadata?.supportContact || "[PLACEHOLDER: verified booking support]"}</p>
              <Link to="/contact">Contact information</Link>
            </aside>
          </div>
        </div>
      </section>
    </>
  );
}

export function ReceiptPreview() {
  // Export name retained so existing App.jsx does not need replacement.
  const location = useLocation();
  const [receipt, setReceipt] = useState(null);

  useEffect(() => {
    const value = location.state?.receipt;

    if (
      value?.submissionStatus === "pending" &&
      /^[a-f0-9]{32}$/.test(value.reference)
    ) {
      setReceipt(value);
    }
  }, [location.state]);

  return (
    <>
      <PageIntro
        eyebrow="Appointment requests"
        title={receipt ? "Request received — not confirmed." : "Submission receipt"}
      >
        <p>
          {receipt
            ? "Your request was saved and entered the pending staff-review workflow."
            : "No verified submission receipt is available in this page state."}
        </p>
      </PageIntro>

      <section className="section">
        <div className="container reading-width">
          {receipt ? (
            <>
              <Notice title="Received — staff approval still required">
                This receipt records submission. It is not a current-status
                lookup and does not confirm an appointment.
              </Notice>
              <Facts items={[
                ["Safe request reference", receipt.reference],
                ["Status at submission", "Pending staff approval"],
                ["Clinic time zone", receipt.clinicTimeZone],
                ["Support", receipt.supportContact]
              ]} />
              <p>
                Notifications are handled separately. An email delay or
                failure does not erase the saved request. Email delivery
                itself is not approval.
              </p>
              <p>
                No response time is promised here. Guest identity verification
                and portal access are separate setup steps.
              </p>
              <div className="button-row">
                <Button to="/manage-request">Manage-request entry</Button>
                <Button to="/contact" variant="outline">Contact information</Button>
              </div>
            </>
          ) : (
            <>
              <Notice title="Do not assume a request was submitted">
                Return to the request page to check an interrupted submission.
                Do not start a duplicate request if its outcome is uncertain.
              </Notice>
              <div className="button-row">
                <Button to="/request-an-appointment">Return to request pathway</Button>
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}