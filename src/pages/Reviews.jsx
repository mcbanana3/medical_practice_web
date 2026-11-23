import AppointmentCTA from "../components/AppointmentCTA.jsx";
import Button from "../components/Button.jsx";
import Icon from "../components/Icon.jsx";
import Notice from "../components/Notice.jsx";
import PageIntro from "../components/PageIntro.jsx";
import ReviewCard from "../components/ReviewCard.jsx";
import ReviewForm from "../components/ReviewForm.jsx";
import { publishedReviews } from "../data/publicReviews.js";

export default function Reviews() {
  return (
    <>
      <PageIntro
        eyebrow="Reviews"
        title="Perspectives, shared thoughtfully."
        aside={
          <div className="reviews-intro-note">
            <span className="circle-icon">
              <Icon name="info" />
            </span>
            <p>
              Authentic feedback only. Doctor approval is required in the
              planned publication workflow.
            </p>
          </div>
        }
      >
        <p>
          Published feedback belongs here only after authenticity, source,
          permission, and privacy checks.
        </p>
      </PageIntro>

      <section className="section">
        <div className="container">
          <div className="section-topline">
            <div>
              <p className="eyebrow">Published feedback</p>
              <h2>Real words. Clear context.</h2>
            </div>
            <a className="inline-link" href="#share-feedback">
              Explore the feedback form <Icon />
            </a>
          </div>

          {publishedReviews.length > 0 ? (
            <div className="reviews-grid">
              {publishedReviews.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
            </div>
          ) : (
            <div className="reviews-empty">
              <div className="reviews-empty-symbol" aria-hidden="true">“</div>
              <div>
                <h3>No approved reviews have been supplied.</h3>
                <p>
                  This preview contains no fabricated quotes, identities,
                  ratings, or review counts.
                </p>
                <Button to="/about" variant="outline">
                  About the practice
                </Button>
              </div>
            </div>
          )}

          <div className="reviews-disclosure">
            <Notice title="How feedback is presented">
              Selected testimonials and third-party reviews must be labeled
              distinctly. Individual experiences do not establish clinical
              outcomes or guarantee what another person will experience.
            </Notice>
          </div>
        </div>
      </section>

      <section className="section review-process-section">
        <div className="container editorial-grid">
          <div>
            <p className="eyebrow">Planned review process</p>
            <h2>Considered before it becomes public.</h2>
            <p className="section-copy">
              No public submission will publish itself. Moderation and
              publication must be enforced by the later server.
            </p>
          </div>

          <ol className="vertical-steps">
            <li>
              <span>01</span>
              <div>
                <h3>Secure submission</h3>
                <p>
                  Collect only approved information and required publication
                  permission.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Doctor review</h3>
                <p>
                  An authorized doctor checks the submission within the
                  approved moderation workflow.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Approved publication</h3>
                <p>
                  Only eligible, permission-cleared content may appear on
                  the public website.
                </p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <section className="section" id="share-feedback">
        <div className="container reading-width">
          <ReviewForm />
        </div>
      </section>

      <AppointmentCTA />
    </>
  );
}