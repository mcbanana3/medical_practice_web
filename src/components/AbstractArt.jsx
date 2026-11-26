
export default function AbstractArt({
  compact = false,
  image = "/potrait.png",
  priority = false
}) {
  return (
    <div
      className={`abstract-art ${
        compact ? "abstract-art--compact" : ""
      }`}
      aria-hidden="true"
    >
      <img
        className="abstract-art__image"
        src={image}
        alt=""
        loading={priority ? "eager" : "lazy"}
        fetchpriority={priority ? "high" : undefined}
        decoding="async"
      />

      <div className="abstract-art__overlay" />

      <div className="art-label">
        <span>Dedicated to your health.</span>
        <span>Internal Medicine / Odessa, TX</span>
      </div>
    </div>
  );
}
