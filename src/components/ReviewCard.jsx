function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export default function ReviewCard({ review }) {
  const sourceUrl = safeSourceUrl(review.sourceUrl);

  return (
    <article className="review-card">
      <div className="review-card-top">
        <span className="review-type">
          {review.type === "testimonial"
            ? "Selected testimonial"
            : "Third-party review"}
        </span>
        <span className="review-quote" aria-hidden="true">“</span>
      </div>

      <blockquote>
        <p>{review.text}</p>
      </blockquote>

      <footer className="review-card-footer">
        <strong>{review.displayName}</strong>

        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {review.sourceLabel} — opens a new tab
          </a>
        ) : (
          <span>{review.sourceLabel}</span>
        )}
      </footer>
    </article>
  );
}