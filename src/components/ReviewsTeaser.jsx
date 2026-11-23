import Button from "./Button.jsx";

export default function ReviewsTeaser() {
  return (
    <section className="reviews-teaser">
      <div className="container reviews-teaser-inner">
        <div><p className="eyebrow">Reviews</p><h2>Perspectives,<br />with context.</h2></div>
        <div>
          <p>Explore published feedback and its source information.</p>
          <Button to="/reviews" variant="light">Explore reviews</Button>
        </div>
        <span className="teaser-decoration" aria-hidden="true">“</span>
      </div>
    </section>
  );
}