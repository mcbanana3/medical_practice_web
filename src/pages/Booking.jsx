import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import Button from "../components/Button.jsx";
import { Facts } from "../components/Content.jsx";
import Icon from "../components/Icon.jsx";
import Notice, { EmergencyNotice } from "../components/Notice.jsx";
import PageIntro from "../components/PageIntro.jsx";
import Recaptcha from "../components/Recaptcha.jsx";
import "./booking-live.css";

import { useAuth } from "../auth/AuthProvider.jsx";
import { post as patientPost } from "../auth/client.js";
import { validEmail } from "../../shared/contact.js";
import { practice } from "../content.js";
import PhoneField, {
  phoneError
} from "../components/PhoneField.jsx";

const API = import.meta.env.VITE_API_BASE_URL || "";
const RETRY_STORAGE_PREFIX = "appointment-submission-v3";
const steps = ["Date and time", "Contact details", "Review"];

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

export default function Booking() {
  const navigate = useNavigate();
  const auth = useAuth();
  const RETRY_STORAGE = `${RETRY_STORAGE_PREFIX}:${auth.patient?.reference || "guest"}`;
  const [step, setStep] = useState(2);
  const [metadata, setMetadata] = useState(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState([]);
  const [slot, setSlot] = useState(null);
  const [slotLoading, setSlotLoading] = useState(false);
  const [contact, setContact] = useState({ name: "", email: "", phone: "", reason: "" });
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

  useEffect(() => { if (auth.patient) setContact(current => ({ ...current, name: current.name || auth.patient.displayName || "", email: auth.patient.email })); }, [auth.patient?.reference]);
  const chosen = metadata?.options?.length === 1 ? metadata.options[0] : null;
  useEffect(() => {
    if (auth.loading) return;
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
  }, [auth.loading, RETRY_STORAGE]);

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

    if (step === 2 && !chosen) next.time = "Online booking is unavailable. Please call the practice.";
    if (step === 2) {
      if (!date) next.date = "Choose a date.";
      if (!slot) next.time = "Choose a currently available time.";
    }
    if (step === 3) {
      if (!contact.phone.trim()) next.phone = "Enter your phone number.";
      if (!contact.reason.trim()) next.reason = "Briefly describe the reason for your visit.";
      if (!contact.name.trim()) next.name = "Enter your name.";
      if (!validEmail(contact.email)) {
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
          phone: contact.phone.trim(),
          reason: contact.reason.trim()
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
        ? await (auth.patient ? patientPost("/api/portal/requests/receipt", { idempotencyKey: pending.current.key, captchaToken: captcha }) : api("/api/booking/receipt", {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: pending.current.key,
            captchaToken: captcha
          })
        }))
        : auth.patient ? await patientPost("/api/portal/requests", { ...pending.current.body, captchaToken: captcha }, { "Idempotency-Key": pending.current.key }) : await api("/api/booking/requests", {
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
        state: { receipt: result.receipt, bookingMode: auth.patient ? "patient" : "guest" }
      });
    } catch (error) {
      setMessage(error.message);

      if (
        wasUncertain ||
        !error.status ||
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
        if (serverFields.phone) contactErrors.phone = serverFields.phone;
        if (serverFields.reason) contactErrors.reason = serverFields.reason;

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

          <p className="help booking-storage-note">
            Choose a time, add your details, and send your request. We will contact you after staff review.
          </p>

          <ol className="booking-progress" aria-label="Appointment request steps">
            {steps.map((label, index) => (
              <li
                key={label}
                className={index === step - 2 ? "current" : index < step - 2 ? "complete" : ""}
                aria-current={index === step - 2 ? "step" : undefined}
              >
                <span className="progress-number" aria-hidden="true">
                  {index < step - 2 ? <Icon name="check" /> : index + 1}
                </span>
                <span>{label}</span>
              </li>
            ))}
          </ol>

          <div className="booking-shell">
            <div className="booking-main">
              <p className="eyebrow">Step {step - 1} of {steps.length}</p>
              <h2 ref={title} tabIndex="-1">{steps[step - 2]}</h2>

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

              <form noValidate onSubmit={submit}>
                  {step === 2 && (
                    <>
                      <div className="booking-practice" aria-label="Appointment details">
                        <strong>{practice.clinician}</strong>
                        <span className="booking-practice-duration">30-minute appointment</span>
                        <span className="booking-practice-address">{practice.address}</span>
                      </div>
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
                            {new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(value + "T12:00:00Z"))}{date === value && <strong>Selected</strong>}
                          </button>
                        ))}
                      </div>

                      <div aria-busy={slotLoading}>
                        <p role="status">{slotLoading ? "Loading current available times…" : ""}</p>
                        {!slotLoading && !slots.length && (
                          <Notice title="No available times for this date">
                            Choose another date, or call the practice for help.
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
                      <p>How can we reach you? All fields below are required.</p>
                      <p className="help">Briefly tell us what you would like to discuss.</p>
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
                            required
                            readOnly={field === "email" && Boolean(auth.patient)}
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

<div className="field"><label htmlFor="booking-reason">Reason for visit (required)</label><textarea id="booking-reason" aria-invalid={Boolean(errors.reason)} aria-describedby="booking-reason-help" required maxLength={1000} rows={4} value={contact.reason} onChange={event => { clearRetry(); setContact(current => ({ ...current, reason: event.target.value })); }} /><p id="booking-reason-help" className="help">For example, an annual checkup, follow-up, or a new concern. Keep this brief; do not include sensitive records. This is not monitored for emergencies.</p>{errors.reason && <p className="field-error">{errors.reason}</p>}</div>
                      <PhoneField
                        required
                        label="Phone number (required)"
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
                          ...appointmentFacts.filter(([label]) => !["Location", "Appointment type", "Provider"].includes(label)),
                          ["Clinic-local date", date],
                          ["Time with UTC offset", slot?.label || "Not selected"],
                          ["Name", contact.name],
                          ["Email", contact.email], ["Reason for visit", contact.reason]
                        ]} />
                      )}

                      {!uncertain && (
                        <div className="inline-links">

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
                      disabled={busy || uncertain || step === 2}
                      onClick={() => go(Math.max(2, step - 1))}
                    >Back</Button>
                    <Button type="submit" disabled={busy || auth.loading || (!uncertain && (!chosen || metaLoading || slotLoading))}>
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
            </div>

            <aside className="booking-aside">
              <span className="booking-duration">30 minute visit</span><p className="eyebrow">Your appointment</p>
              <h3>{practice.clinician}</h3><p>{practice.address}</p>
              <p>Only staff approval produces a confirmed appointment.</p>
              <hr />
              <p>{date || "Date not selected"}</p>
              <p>{slot?.label || "Choose a time to continue"}</p>
              <p>{metadata?.clinicTimeZone || practice.timeZone}</p>
              <hr />
              <p>{practice.phone}</p>
              <a href="tel:+14323370555">Call {practice.phone}</a>
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
  const auth = useAuth();
  const returningPatient = location.state?.bookingMode === "patient" || Boolean(auth.patient);
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
              <section className="booking-next-step" aria-labelledby="booking-next-step-title">
                <p className="eyebrow">Your next step</p>
                <h2 id="booking-next-step-title">
                  {returningPatient ? "Continue to your patient portal." : "Create your patient profile."}
                </h2>
                <p>
                  {returningPatient
                    ? "View your appointment request and follow its status in your patient portal. Staff approval is still required."
                    : "Your request has been received. Create an account to set up your patient profile and securely access the portal."}
                </p>
                {!returningPatient && <p className="help">Creating an account is optional. Your request remains saved. Linking this guest request to your profile requires the practice's identity verification process.</p>}
                <div className="button-row">
                  <Button to={returningPatient ? "/portal" : "/portal/register"}>
                    {returningPatient ? "Go to patient portal" : "Register my profile"}
                  </Button>
                  {!returningPatient && <Button to="/portal/login" variant="outline">Already have an account? Sign in</Button>}
                </div>
              </section>
              <div className="button-row">
                <Button to="/contact" variant="text">Contact the practice</Button>
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
