export default function ApprovedContent({ title, children }) {
  if (!children || !String(children).trim()) return null;

  return (
    <section className="content-section">
      <h2>{title}</h2>
      <p style={{ whiteSpace: "pre-line" }}>{children}</p>
    </section>
  );
}