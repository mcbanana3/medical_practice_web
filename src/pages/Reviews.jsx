import PageIntro from "../components/PageIntro.jsx";
import AppointmentCTA from "../components/AppointmentCTA.jsx";
import { PublishedReviews, ReviewForm } from "../components/PracticeReviews.jsx";

export default function Reviews() {
  return (
    <>
      <PageIntro eyebrow="Community voices" title="Your experience matters.">
        <p>Individual experiences do not guarantee clinical outcomes.</p>
      </PageIntro>
      <section className="section reviews-page">
        <div className="container">
          <div className="reviews-section-heading"><div><p className="eyebrow">Shared experiences</p><h2>Reviews of our practice</h2></div><a className="button button--outline" href="#share-review">Write a review</a></div>
          <p className="help">
            These are moderated website submissions, not independently verified
            patient identities or a comprehensive review feed.
          </p>
          <PublishedReviews />
          <div><ReviewForm /></div>
        </div>
      </section>
      <AppointmentCTA />
    </>
  );
}