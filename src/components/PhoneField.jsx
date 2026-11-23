export function phoneError(input) {
  const value = String(input || "").trim();

  if (!value) return "";

  const digits = value.replace(/\D/g, "");

  if (
    value.length > 32 ||
    !/^\+?[\d(). -]+$/.test(value) ||
    digits.length < 7 ||
    digits.length > 15
  ) {
    return "Enter a valid contact number.";
  }

  return "";
}

export default function PhoneField({
  id,
  label = "Contact number",
  value,
  onChange,
  error = "",
  disabled = false
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label} (optional)</label>

      <input
        id={id}
        type="tel"
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
        Include the country code if outside the US.
      </p>

      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}