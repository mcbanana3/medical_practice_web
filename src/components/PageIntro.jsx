export default function PageIntro({
  eyebrow,
  title,
  children,
  aside,
  dark = false
}) {
  return (
    <section className={`page-intro ${dark ? "page-intro--dark" : ""}`}>
      <div className={`container ${aside ? "intro-grid" : ""}`}>
        <div className="entrance">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          {children && <div className="intro-copy">{children}</div>}
        </div>
        {aside && <aside className="intro-aside">{aside}</aside>}
      </div>
    </section>
  );
}