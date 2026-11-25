export default function ApprovedContent({ title, children }) {
  if (!children || !String(children).trim()) return null;

  const paragraphs = String(children).trim().split(/\n\s*\n/).map(text => text.replace(/\s*\n\s*/g, " ").trim());

  return (
    <section className="content-section">
      <h2>{title}</h2>
      {paragraphs.map((text, index) => <p key={index}>{text}</p>)}
    </section>
  );
}