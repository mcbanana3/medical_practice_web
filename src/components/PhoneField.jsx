import { normalizeUsPhone } from "../../shared/contact.js";
export function phoneError(input) {
  return !String(input || "").trim() || normalizeUsPhone(input) ? "" : "Enter a valid US phone number, including its area code.";
}

export default function PhoneField({
  id,
  label = "Contact number",
  value,
  onChange,
  error = "",
  disabled = false,
  required = false
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>

      <input
        id={id}
        type="tel"
        required={required}
        inputMode="tel"
        autoComplete="tel"
        maxLength={32}
        value={value || ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
      />

      <p id={`${id}-help`} className="help">
        US numbers only. Enter 10 digits, or include +1.
      </p>

      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}