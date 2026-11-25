import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import Button from "./Button.jsx";
import Notice from "./Notice.jsx";
import { Facts } from "./Content.jsx";

import { post, request } from "../auth/client.js";

import "../patient-details.css";

const statusLabels = {
  pending: "Requested — pending staff approval",
  approved: "Approved — confirmed",
  declined: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
  completed: "Completed",
  no_show: "No-show"
};

function dateTime(value, zone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export default function PatientAppointmentDetail({
  reference,
  patient
}) {
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [mode, setMode] = useState("");
  const [meta, setMeta] = useState(null);
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState([]);
  const [selected, setSelected] = useState("");
  const [slotLoading, setSlotLoading] = useState(false);

  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [reload, setReload] = useState(0);
  const [availabilityReload, setAvailabilityReload] = useState(0);

  const attempt = useRef(null);
  const sending = useRef(false);
  const errorRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setLoadError("");

    request(`/api/portal/appointments/${reference}`, {
      signal: controller.signal
    })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch((failure) => {
        if (failure.name !== "AbortError") {
          setLoadError(failure.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [reference, patient.reference, reload]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  useEffect(() => {
    if (mode !== "reschedule") return undefined;

    const controller = new AbortController();

    request("/api/booking/options", {
      signal: controller.signal
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        setMeta(result);
        setDate((current) => current || result.minDate);
      })
      .catch((failure) => {
        if (failure.name !== "AbortError") {
          setError(failure.message);
        }
      });

    return () => controller.abort();
  }, [mode]);

  useEffect(() => {
    if (
      mode !== "reschedule" ||
      !date ||
      !data ||
      uncertain
    ) {
      return undefined;
    }

    const controller = new AbortController();

    setSlotLoading(true);
    setSlots([]);
    setSelected("");

    const parameters = new URLSearchParams({
      locationId: String(data.locationId),
      providerId: String(data.providerId),
      typeId: String(data.typeId),
      date
    });

    request(`/api/booking/availability?${parameters}`, {
      signal: controller.signal
    })
      .then((result) => { if (!controller.signal.aborted) setSlots(result.slots); })
      .catch((failure) => {
        if (failure.name !== "AbortError") {
          setError(failure.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setSlotLoading(false);
        }
      });

    return () => controller.abort();
  }, [
    mode,
    date,
    data?.locationId,
    data?.providerId,
    data?.typeId,
    availabilityReload,
    uncertain
  ]);

  function open(nextMode) {
    attempt.current = null;
    setUncertain(false);
    setConfirmed(false);
    setError("");
    setMessage("");
    setSelected("");
    setMode(nextMode);
  }

  async function cancel(event) {
    event.preventDefault();

    if (sending.current || !confirmed) return;

    sending.current = true;
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await post(
        `/api/portal/appointments/${reference}/cancel`,
        { expectedVersion: data.version }
      );

      setMessage(result.message);
      setMode("");
    } catch (failure) {
      setError(
        !failure.status || failure.status >= 500
          ? "The cancellation outcome could not be verified. Reload the current status before trying again."
          : failure.message
      );
    } finally {
      sending.current = false;
      setBusy(false);
      setReload((value) => value + 1);
    }
  }

  async function reschedule(event) {
    event.preventDefault();

    if (sending.current) return;

    if (!attempt.current && !selected) {
      setError("Choose an available replacement time.");
      return;
    }

    if (!attempt.current) {
      attempt.current = {
        key: crypto.randomUUID(),
        body: {
          expectedVersion: data.version,
          startsAt: selected
        }
      };
    }

    sending.current = true;
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await post(
        `/api/portal/appointments/${reference}/reschedule`,
        attempt.current.body,
        { "Idempotency-Key": attempt.current.key }
      );

      navigate(`/portal/appointments/${result.reference}`, {
        replace: true
      });
    } catch (failure) {
      setError(failure.message);

      if (!failure.status || failure.status >= 500) {
        setUncertain(true);
      } else {
        attempt.current = null;
        setUncertain(false);
        setSelected("");
        setAvailabilityReload((value) => value + 1);
        setReload((value) => value + 1);
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  if (loading && !data) {
    return <p role="status">Loading appointment…</p>;
  }

  if (loadError) {
    return (
      <>
        <Notice title="Appointment unavailable">
          {loadError}
        </Notice>

        <div className="button-row">
          <Button
            type="button"
            onClick={() => setReload((value) => value + 1)}
          >
            Reload current status
          </Button>
        </div>
      </>
    );
  }

  if (!data) return null;

  const relation = data.reschedule || {};

  return (
    <div className="patient-details">
      <Notice title={statusLabels[data.status] || data.status}>
        {data.status === "pending"
          ? "This request is not a confirmed appointment."
          : "Review the current status before making changes."}
      </Notice>

      {relation.originalReference && (
        <Notice title="Related original appointment">
          <p>
            This is a replacement request. Its original appointment
            is managed separately until staff approves the replacement.
          </p>

          <Link
            to={`/portal/appointments/${relation.originalReference}`}
          >
            View original appointment and current status
          </Link>
        </Notice>
      )}

      {relation.latestReplacementReference && (
        <Notice title="Related replacement request">
          <p>
            Replacement request status:{" "}
            {relation.latestReplacementState}.
          </p>

          <Link
            to={`/portal/appointments/${relation.latestReplacementReference}`}
          >
            View replacement request
          </Link>
        </Notice>
      )}

      <Facts items={[
        ["Appointment type", data.appointmentType],
        ["Location", data.location],
        ["Provider", data.provider],
        [
          "Date and time",
          dateTime(data.startsAt, data.clinicTimeZone)
        ],
        ["Clinic time zone", data.clinicTimeZone],
        ["Contact number", data.contact.phone || "Not provided"],
        ["Reason for visit", data.contact.reason || "Not provided"],
        ["Reference", data.reference]
      ]} />

      {error && (
        <div
          ref={errorRef}
          tabIndex="-1"
          className="error-summary"
          role="alert"
        >
          <h2>Please check</h2>
          <p>{error}</p>
        </div>
      )}

      <p role="status" aria-live="polite">
        {message}
      </p>

      {!mode && (
        <div className="button-row">
          {data.canReschedule && (
            <Button
              type="button"
              disabled={busy || loading}
              onClick={() => open("reschedule")}
            >
              Request another time
            </Button>
          )}

          {data.canCancel && (
            <Button
              type="button"
              variant="outline"
              disabled={busy || loading}
              onClick={() => open("cancel")}
            >
              Cancel appointment/request
            </Button>
          )}
        </div>
      )}

      {mode === "cancel" && data.canCancel && (
        <form className="patient-action-panel" onSubmit={cancel}>
          <h2>Cancel this appointment or request?</h2>

          <p>
            Cancellation releases its reserved time. Cancelling an
            original appointment also cancels its pending replacement.
            Cancelling only a replacement leaves the original unchanged.
          </p>

          <label className="patient-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) =>
                setConfirmed(event.target.checked)
              }
            />
            <span>I want to cancel this appointment or request.</span>
          </label>

          <div className="button-row">
            <Button
              type="submit"
              disabled={!confirmed || busy || loading}
            >
              {busy ? "Cancelling…" : "Confirm cancellation"}
            </Button>

            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setMode("")}
            >
              Keep appointment
            </Button>
          </div>
        </form>
      )}

      {mode === "reschedule" && data.canReschedule && (
        <form
          className="patient-action-panel"
          onSubmit={reschedule}
        >
          <h2>Request a replacement time</h2>

          <p>
            Your original appointment stays reserved until staff
            approves this replacement. Rejection releases the replacement
            time and leaves the original unchanged.
          </p>

          <p className="help">
            Choose a currently available, non-overlapping time.
            Location, provider, and appointment type remain the same.
          </p>

          {uncertain && (
            <Notice title="Outcome not yet verified">
              Retry uses the same submission key. Do not create a
              separate replacement request while checking this outcome.
            </Notice>
          )}

          <div className="field">
            <label htmlFor="replacement-date">
              Replacement date — clinic-local
            </label>

            <input
              id="replacement-date"
              type="date"
              required
              min={meta?.minDate}
              max={meta?.maxDate}
              value={date}
              disabled={busy || uncertain}
              onChange={(event) => {
                attempt.current = null;
                setDate(event.target.value);
              }}
            />
          </div>

          <p role="status">
            {slotLoading ? "Loading available times…" : ""}
          </p>

          <fieldset
            className="time-fieldset"
            disabled={busy || uncertain}
          >
            <legend>
              Available replacement times — {data.clinicTimeZone}
            </legend>

            <div className="time-options">
              {slots.map((slot) => (
                <label key={slot.startsAt}>
                  <input
                    type="radio"
                    name="replacement-time"
                    checked={selected === slot.startsAt}
                    onChange={() => {
                      attempt.current = null;
                      setSelected(slot.startsAt);
                    }}
                  />
                  <span>{slot.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {!slotLoading && !slots.length && (
            <p>No times are available. Choose another date.</p>
          )}

          <div className="button-row">
            <Button
              type="submit"
              disabled={
                busy ||
                loading ||
                (!selected && !attempt.current)
              }
            >
              {busy
                ? "Submitting…"
                : uncertain
                  ? "Retry same request"
                  : "Submit replacement request"}
            </Button>

            <Button
              type="button"
              variant="outline"
              disabled={busy || uncertain}
              onClick={() => setMode("")}
            >
              Back
            </Button>
          </div>
        </form>
      )}

      <div className="inline-links">
        <Link to="/portal/appointments">
          Appointment history
        </Link>

        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => setReload((value) => value + 1)}
        >
          Reload current status
        </button>
      </div>
    </div>
  );
}