import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../components/Button.jsx";
import { Facts } from "../components/Content.jsx";
import Notice, { EmergencyNotice } from "../components/Notice.jsx";
import PageIntro from "../components/PageIntro.jsx";
import Recaptcha from "../components/Recaptcha.jsx";
import { useAuth } from "../auth/AuthProvider.jsx";
import { post, request } from "../auth/client.js";
import GuestBooking from "./Booking.jsx";

import PhoneField, {
  phoneError
} from "../components/PhoneField.jsx";

const STORAGE = "patient-appointment-retry-key";

export default function BookingEntry() {
  const auth = useAuth();
  const [mode, setMode] = useState("");

  if (auth.loading) {
    return <section className="section container"><p role="status">Checking account access…</p></section>;
  }

  if (!auth.patient || mode === "guest") return <GuestBooking />;
  if (mode === "patient") return <PatientBooking />;

  return (
    <>
      <PageIntro eyebrow="Appointments" title="Request an appointment.">
        <p>You are signed in. Choose whether this is your own account request or a guest request.</p>
      </PageIntro>
      <section className="section">
        <div className="container reading-width">
          <EmergencyNotice />
          <Notice title="One account represents one patient">
            Account requests belong to the authenticated patient. Proxy and dependent access are not supported.
          </Notice>
          <div className="button-row">
            <Button type="button" onClick={() => setMode("patient")}>Continue with my account</Button>
            <Button type="button" variant="outline" onClick={() => setMode("guest")}>Continue as guest</Button>
          </div>
        </div>
      </section>
    </>
  );
}

function PatientBooking() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [meta, setMeta] = useState(null);
  const [context, setContext] = useState({ locationId: "", typeId: "", providerId: "" });
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState([]);
  const [slot, setSlot] = useState(null);
  const [name, setName] = useState(auth.patient.displayName || "");
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [captcha, setCaptcha] = useState("");
  const [message, setMessage] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const widget = useRef(null);
  const attempt = useRef(null);
  const sending = useRef(false);
  const alert = useRef(null);
  const heading = useRef(null);
  const [phone, setPhone] = useState("");
  const phoneEdited = useRef(false);

  useEffect(() => {
    try {
      const key = sessionStorage.getItem(STORAGE);
      if (/^[a-f0-9-]{36}$/i.test(key || "")) {
        attempt.current = { key, body: null };
        setUncertain(true);
        setStep(3);
      }
    } catch { }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    request("/api/portal/contact", {
      signal: controller.signal
    })
      .then((data) => {
        if (!phoneEdited.current) {
          setPhone(data.phone || "");
        }
      })
      .catch(() => {
        // Prefilling is optional. The field remains manually editable.
      });

    return () => controller.abort();
  }, [auth.patient.reference]);

  useEffect(() => {
    let active = true;
    request("/api/booking/options").then((data) => {
      if (active) {
        setMeta(data);
        setDate((current) => current || data.minDate);
      }
    }).catch((error) => active && setMessage(error.message));
    return () => { active = false; };
  }, [refresh]);

  const rows = meta?.options || [];
  const optionsFor = (key, nameKey, source) =>
    [...new Map(source.map((item) => [
      String(item[key]), { value: String(item[key]), label: item[nameKey] }
    ])).values()];

  const locationOptions = optionsFor("locationId", "locationName", rows);
  const locationRows = rows.filter((item) => String(item.locationId) === context.locationId);
  const typeOptions = optionsFor("typeId", "typeName", locationRows);
  const providerRows = locationRows.filter((item) => String(item.typeId) === context.typeId);
  const providerOptions = optionsFor("providerId", "providerName", providerRows);
  const chosen = providerRows.find((item) => String(item.providerId) === context.providerId);

  useEffect(() => {
    setContext((current) => {
      const pick = (options, value) =>
        options.some((item) => item.value === value) ? value
          : options.length === 1 ? options[0].value : "";

      const locationId = pick(locationOptions, current.locationId);
      const types = rows.filter((item) => String(item.locationId) === locationId);
      const typeId = pick(optionsFor("typeId", "typeName", types), current.typeId);
      const providers = types.filter((item) => String(item.typeId) === typeId);
      const providerId = pick(optionsFor("providerId", "providerName", providers), current.providerId);

      return locationId === current.locationId && typeId === current.typeId && providerId === current.providerId
        ? current : { locationId, typeId, providerId };
    });
  }, [meta, context.locationId, context.typeId, context.providerId]);

  useEffect(() => {
    if (!chosen || !date || uncertain) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setSlot(null);

    const query = new URLSearchParams({
      locationId: context.locationId, providerId: context.providerId,
      typeId: context.typeId, date
    });

    request(`/api/booking/availability?${query}`, { signal: controller.signal })
      .then((data) => setSlots(data.slots))
      .catch((error) => {
        if (error.name !== "AbortError") setMessage(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [chosen?.locationId, chosen?.providerId, chosen?.typeId, date, refresh, uncertain]);

  useEffect(() => { if (message) alert.current?.focus(); }, [message]);
  useEffect(() => { heading.current?.focus(); }, [step]);

  function clearAttempt() {
    attempt.current = null;
    try { sessionStorage.removeItem(STORAGE); } catch { }
  }

  async function submit(event) {
    event.preventDefault();
    if (sending.current) return;
    setMessage("");

    if (step === 0 && !chosen) return setMessage("Choose a valid appointment combination.");
    if (step === 1 && !slot) return setMessage("Choose an available time.");
    if (step === 2 && !name.trim()) return setMessage("Enter your name.");
    if (step === 2) {
      const invalidPhone = phoneError(phone);

      if (invalidPhone) {
        setMessage(invalidPhone);
        return;
      }
    }
    if (step < 3) return setStep(step + 1);
    if (!captcha) return setMessage("Complete the security check.");

    if (!attempt.current) {
      attempt.current = {
        key: crypto.randomUUID(),
        body: {
          locationId: chosen.locationId,
          providerId: chosen.providerId,
          typeId: chosen.typeId,
          startsAt: slot.startsAt,
          name: name.trim(),
          phone: phone.trim()
        }
      };
    }

    try { sessionStorage.setItem(STORAGE, attempt.current.key); } catch { }

    const recovering = !attempt.current.body;
    const wasUncertain = uncertain;
    sending.current = true;
    setLoading(true);

    try {
      const result = recovering
        ? await post("/api/portal/requests/receipt", {
          idempotencyKey: attempt.current.key, captchaToken: captcha
        })
        : await post("/api/portal/requests", {
          ...attempt.current.body, captchaToken: captcha
        }, { "Idempotency-Key": attempt.current.key });

      clearAttempt();
      navigate("/request-an-appointment/received", {
        replace: true, state: { receipt: result.receipt }
      });
    } catch (error) {
      setMessage(error.message);

      if (
        wasUncertain || !error.status || error.status >= 500 ||
        error.code === "IDEMPOTENCY_MISMATCH"
      ) {
        setUncertain(true);
        if (error.code === "IDEMPOTENCY_MISMATCH") attempt.current.body = null;
      } else {
        clearAttempt();
        if (error.code === "SLOT_UNAVAILABLE") {
          setStep(1);
          setRefresh((value) => value + 1);
        }
      }
    } finally {
      sending.current = false;
      setLoading(false);
      setCaptcha("");
      widget.current?.reset();
    }
  }

  const facts = [
    ["Location", chosen?.locationName || "Not selected"],
    ["Appointment type", chosen?.typeName || "Not selected"],
    ["Provider", chosen?.providerName || "Not selected"],
    ["Clinic time zone", meta?.clinicTimeZone || "Loading"],
    ["Date", date || "Not selected"],
    ["Time with UTC offset", slot?.label || "Not selected"],
    ["Contact number", phone || "Not provided"],
  ];

  return (
    <>
      <PageIntro eyebrow="Appointments" title="Request an appointment.">
        <p>This request will belong to your authenticated patient account. Staff approval is required.</p>
      </PageIntro>
      <section className="section section-tight booking-live">
        <div className="container">
          <EmergencyNotice />
          {meta?.fixtureData && <Notice title="Development schedule">Use invented test information only.</Notice>}
          <ol className="booking-progress" aria-label="Account request steps">
            {["Appointment context", "Date and time", "Contact details", "Review"].map((label, index) => (
              <li key={label} className={index === step ? "current" : index < step ? "complete" : ""}
                aria-current={index === step ? "step" : undefined}>
                <span className="progress-number" aria-hidden="true">{index + 1}</span>{label}
              </li>
            ))}
          </ol>

          <div className="booking-shell">
            <div className="booking-main">
              <h2 ref={heading} tabIndex="-1">
                {["Appointment context", "Date and time", "Contact details", "Review"][step]}
              </h2>

              {message && (
                <div ref={alert} tabIndex="-1" className="error-summary" role="alert">
                  <h3>Please check</h3><p>{message}</p>
                  <a href="#patient-booking-fields">Return to the current step</a>
                </div>
              )}

              {uncertain && (
                <Notice title="Do not create another request">
                  The outcome needs checking. Complete a fresh security check.
                  The same account-bound retry key will be used.
                </Notice>
              )}

              <form id="patient-booking-fields" tabIndex="-1" onSubmit={submit}>
                {step === 0 && [
                  ["locationId", "Location", locationOptions],
                  ["typeId", "Appointment type", typeOptions],
                  ["providerId", "Provider", providerOptions]
                ].map(([key, label, options]) => options.length === 1
                  ? <Facts key={key} items={[[label, options[0].label]]} />
                  : (
                    <div className="field" key={key}>
                      <label htmlFor={`patient-${key}`}>{label}</label>
                      <select id={`patient-${key}`} value={context[key]} required
                        onChange={(event) => {
                          clearAttempt();
                          setContext((current) => ({
                            ...current, [key]: event.target.value,
                            ...(key === "locationId" ? { typeId: "", providerId: "" } : {}),
                            ...(key === "typeId" ? { providerId: "" } : {})
                          }));
                        }}>
                        <option value="">Choose {label.toLowerCase()}</option>
                        {options.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                      </select>
                    </div>
                  ))}

                {step === 1 && (
                  <>
                    <div className="field">
                      <label htmlFor="patient-date">Clinic-local date</label>
                      <input id="patient-date" type="date" value={date}
                        min={meta?.minDate} max={meta?.maxDate}
                        onChange={(event) => { clearAttempt(); setDate(event.target.value); }} />
                    </div>
                    <div className="date-list" aria-label="Equivalent date navigation">
                      {meta?.dateChoices.map((value) => (
                        <button type="button" key={value} aria-pressed={date === value}
                          className={date === value ? "selected" : ""}
                          onClick={() => { clearAttempt(); setDate(value); }}>{value}</button>
                      ))}
                    </div>
                    <p role="status">{loading ? "Loading available times…" : ""}</p>
                    {!loading && !slots.length && <Notice title="No available times">Choose another date or context.</Notice>}
                    <fieldset className="time-fieldset">
                      <legend>Available times — {meta?.clinicTimeZone}</legend>
                      <div className="time-options">
                        {slots.map((item) => (
                          <label key={item.startsAt}>
                            <input type="radio" name="patient-slot" checked={slot?.startsAt === item.startsAt}
                              onChange={() => { clearAttempt(); setSlot(item); }} />
                            <span>{item.label}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </>
                )}

                {step === 2 && (
                  <>
                    <div className="field">
                      <label htmlFor="patient-booking-name">Name</label>
                      <input
                        id="patient-booking-name"
                        required
                        autoComplete="name"
                        maxLength={100}
                        value={name}
                        onChange={(event) => {
                          clearAttempt();
                          setName(event.target.value);
                        }}
                      />
                    </div>

                    <Facts items={[["Verified account email", auth.patient.email]]} />

                    <PhoneField
                      id="patient-booking-phone"
                      value={phone}
                      onChange={(value) => {
                        phoneEdited.current = true;
                        clearAttempt();
                        setPhone(value);
                      }}
                    />

                    <p className="help">
                      No symptom narrative is collected. <a href="/privacy">Privacy notice</a>.
                    </p>
                  </>
                )}

                {step === 3 && (
                  <>
                    <Notice title="Pending until staff approval">Submission never confirms an appointment.</Notice>
                    {!uncertain && <Facts items={[...facts, ["Name", name], ["Contact email", auth.patient.email]]} />}
                    <Recaptcha ref={widget} onToken={setCaptcha} />
                    <p className="help">An opaque retry key—not contact details—is held in session storage.</p>
                  </>
                )}

                <div className="form-actions">
                  <Button type="button" variant="outline" disabled={!step || loading || uncertain}
                    onClick={() => { setMessage(""); setStep(step - 1); }}>Back</Button>
                  <Button type="submit" disabled={loading || (!meta && !uncertain)}>
                    {loading ? "Please wait…" : step === 3 ? "Submit appointment request" : "Continue"}
                  </Button>
                </div>
              </form>
            </div>
            <aside className="booking-aside">
              <p className="eyebrow">Your account request</p>
              <h3>Staff approval comes next.</h3>
              <Facts items={facts} />
              <p>{meta?.supportContact}</p>
            </aside>
          </div>
        </div>
      </section>
    </>
  );
}