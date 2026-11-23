export function Placeholder() {
  return null;
}

export function Facts({ items }) {
  const visible = items.filter(([, value]) =>
    value !== null &&
    value !== undefined &&
    value !== "" &&
    !(typeof value === "string" && value.includes("[PLACEHOLDER:"))
  );

  return (
    <dl className="facts">
      {visible.map(([label, value]) => (
        <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  );
}

export function ContentSections() {
  // Legacy draft sections are intentionally not published.
  // Approved public pages now use ApprovedContent and src/content.js.
  return null;
}