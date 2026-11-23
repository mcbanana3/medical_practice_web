export default function AbstractArt({ compact = false }) {
  return (
    <div
      className={`abstract-art ${compact ? "abstract-art--compact" : ""}`}
      aria-hidden="true"
    >
      <div className="art-orbit" />
      <div className="art-sun" />
      <div className="art-arch arch-one" />
      <div className="art-arch arch-two" />
      <div className="art-arch arch-three" />
      <div className="art-platform" />
      <div className="art-label">
        <span>Space to begin.</span>
        <span>Abstract study / 01</span>
      </div>
    </div>
  );
}