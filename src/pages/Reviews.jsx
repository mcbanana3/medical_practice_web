import PageIntro from "../components/PageIntro.jsx";
import AppointmentCTA from "../components/AppointmentCTA.jsx";
import { PublishedReviews, ReviewForm } from "../components/PracticeReviews.jsx";

export default function Reviews() {
  return (
    <>
      <PageIntro eyebrow="Reviews" title="Experiences, shared thoughtfully.">
        <p>Individual experiences do not guarantee clinical outcomes.</p>
      </PageIntro>
      <section className="section">
        <div className="container">
          <h2>Approved feedback</h2>
          <p className="help">
            These are moderated website submissions, not independently verified
            patient identities or a comprehensive review feed.
          </p>
          <PublishedReviews />
          <ReviewForm />
        </div>
      </section>
      <AppointmentCTA />
    </>
  );
}