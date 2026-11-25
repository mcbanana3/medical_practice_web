import Button from "./Button.jsx";
import { PublishedReviews, ReviewForm } from "./PracticeReviews.jsx";

export default function ReviewsTeaser() {
  return (
    <>
      <section className="reviews-teaser">
        <div className="container reviews-teaser-inner">
          <div>
            <p className="eyebrow">Reviews</p>
            <h2>Perspectives,<br />with context.</h2>
          </div>
          <div>
            <p>Read approved feedback or share your own experience.</p>
            <Button to="/reviews" variant="light">Explore reviews</Button>
          </div>
          <span className="teaser-decoration" aria-hidden="true">“</span>
        </div>
      </section>
      <section className="section">
        <div className="container">
          <PublishedReviews limit={3} paginated={false} />
          <ReviewForm />
        </div>
      </section>
    </>
  );
}