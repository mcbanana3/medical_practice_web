import { useEffect, useRef, useState } from "react";

import Button from "./Button.jsx";
import Notice from "./Notice.jsx";
import PhoneField, { phoneError } from "./PhoneField.jsx";

import { useAuth } from "../auth/AuthProvider.jsx";
import { post, request } from "../auth/client.js";

import "../patient-details.css";

const generalFields = [
  ["displayName", "Name — self-reported", "text", 100],
  ["dateOfBirth", "Date of birth", "date"],
  ["address", "Mailing address", "text", 300],
  ["heightCm", "Height (cm)", "number"],
  ["weightKg", "Weight (kg)", "number"]
];

const emergencyFields = [
  ["emergencyContactName", "Emergency contact name", "text", 100],
  [
    "emergencyContactRelationship",
    "Relationship to emergency contact",
    "text",
    50
  ]
];

const medicalFields = [
  ["allergies", "Allergies"],
  ["medications", "Current medications"],
  ["conditions", "Medical conditions"],
  ["medicalHistory", "Relevant medical history"]
];

export default function PatientProfile() {
  const auth = useAuth();

  const [form, setForm] = useState(null);
  const [savedForm, setSavedForm] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [version, setVersion] = useState(0);
  const [editable, setEditable] = useState(false);
  const [email, setEmail] = useState("");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const sending = useRef(false);
  const errorRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setError("");
    setForm(null);

    request("/api/portal/profile", {
      signal: controller.signal
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        const initial = {
          ...data.details,
          heightCm: data.details.heightCm ?? "",
          weightKg: data.details.weightKg ?? ""
        };
        setForm(initial);
        setSavedForm(JSON.stringify(initial));
        setUpdatedAt(data.updatedAt);

        setVersion(data.version);
        setEditable(data.editable);
        setEmail(data.email);
      })
      .catch((failure) => {
        if (failure.name !== "AbortError") {
          setError(failure.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [auth.patient.reference, reload]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const dirty = Boolean(form && JSON.stringify(form) !== savedForm);
  useEffect(() => {
    if (!dirty) return;
    const warn = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function change(key, value) {
    setForm((current) => ({
      ...current,
      [key]: value
    }));

    setMessage("");
  }

  async function save(event) {
    event.preventDefault();

    if (sending.current || !editable) return;

    setError("");
    setMessage("");

    const invalidPhone =
      phoneError(form.phone) ||
      phoneError(form.emergencyContactPhone);

    if (invalidPhone) {
      setError(invalidPhone);
      return;
    }

    sending.current = true;
    setBusy(true);

    try {
      const result = await post("/api/portal/profile", {
        version,
        details: {
          ...form,
          heightCm:
            form.heightCm === ""
              ? null
              : Number(form.heightCm),
          weightKg:
            form.weightKg === ""
              ? null
              : Number(form.weightKg)
        }
      });

      setVersion(result.version);
      setSavedForm(JSON.stringify(form));
      setUpdatedAt(new Date().toISOString());
      await auth.refresh();
      setMessage(result.message);
    } catch (failure) {
      setError(failure.message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  function field([key, label, type, maxLength]) {
    return (
      <div className="field" key={key}>
        <label htmlFor={`profile-${key}`}>
          {label} (optional)
        </label>

        <input
          id={`profile-${key}`}
          type={type}
          maxLength={maxLength}
          autoComplete={key === "displayName" ? "name" : key === "address" ? "street-address" : key === "dateOfBirth" ? "bday" : "off"}
          step={type === "number" ? "0.1" : undefined}
          min={type === "number" ? "0.1" : undefined}
          max={
            key === "heightCm"
              ? 300
              : key === "weightKg"
                ? 1000
                : undefined
          }
          value={form[key] ?? ""}
          onChange={(event) =>
            change(key, event.target.value)
          }
        />
      </div>
    );
  }

  if (loading) {
    return <p role="status">Loading your profile…</p>;
  }

  return (
    <div className="patient-details">
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

      {!form ? (
        <Button
          type="button"
          onClick={() => setReload((value) => value + 1)}
        >
          Retry loading profile
        </Button>
      ) : (
        <>
          <Notice title="Your information">
            Medical information entered here is patient-reported,
            not clinically verified. Profile updates are not medical
            messages and are not monitored for emergencies.
            If you are experiencing a medical emergency, call 911.
          </Notice>

          <p>
            Verified account email: <strong>{email}</strong>
          </p>

          <p className="help">
            Editing this profile does not change your verified sign-in
            email or rewrite contact details on existing appointments.
            Do not enter Social Security numbers or payment details.
          </p>

          {!editable && (
            <Notice title="Editing unavailable">
              Profile editing is currently unavailable.
            </Notice>
          )}

          <p className="help" role="status">{dirty ? "You have unsaved changes." : updatedAt ? `Last saved: ${new Date(updatedAt).toLocaleString()}` : "Complete any details you would like to share."}</p>
          <form onSubmit={save}>
            <fieldset disabled={busy || !editable}>
              <legend>General and contact information</legend>

              <div className="patient-form-grid">
                {generalFields.map(field)}

                <PhoneField
                  id="profile-phone"
                  value={form.phone}
                  onChange={(value) => change("phone", value)}
                />
              </div>
            </fieldset>

            <fieldset disabled={busy || !editable}>
              <legend>Emergency contact</legend>

              <div className="patient-form-grid">
                {emergencyFields.map(field)}

                <PhoneField
                  id="profile-emergency-phone"
                  label="Emergency contact number"
                  value={form.emergencyContactPhone}
                  onChange={(value) =>
                    change("emergencyContactPhone", value)
                  }
                />
              </div>
            </fieldset>

            <fieldset disabled={busy || !editable}>
              <legend>Medical information</legend>

              <p className="help">
                All fields are optional. An empty field means no
                information was provided; it does not mean “none.”
              </p>

              {medicalFields.map(([key, label]) => (
                <div className="field" key={key}>
                  <label htmlFor={`profile-${key}`}>
                    {label} (optional)
                  </label>

                  <textarea
                    id={`profile-${key}`}
                    rows={4}
                    maxLength={2000}
                    value={form[key] || ""}
                    onChange={(event) =>
                      change(key, event.target.value)
                    }
                  />
                </div>
              ))}
            </fieldset>

            <div className="button-row">
              <Button
                type="submit"
                disabled={busy || !editable || !dirty}
              >
                {busy ? "Saving…" : "Save my details"}
              </Button>

              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (dirty && !window.confirm("Discard unsaved profile changes and reload the saved profile?")) return;
                  setMessage("");
                  setReload((value) => value + 1);
                }}
              >
                Reload saved profile
              </Button>
            </div>

            <p role="status" aria-live="polite">
              {message}
            </p>
          </form>
        </>
      )}
    </div>
  );
}