import Button from "../components/Button.jsx";
import Notice from "../components/Notice.jsx";
import PageIntro from "../components/PageIntro.jsx";
import { emergency } from "../site.js";

export function Emergency() {
  return (
    <>
      <PageIntro eyebrow="Emergency & urgent information" title="For a medical emergency, call 911." dark>
        <p>{emergency}</p>
      </PageIntro>
      <section className="section">
        <div className="container reading-width">
          <section className="content-section">
            <h2>Website limitations</h2>
            <p>This website does not provide symptom triage. Appointment requests are not emergency messages.</p>
          </section>
          <section className="content-section"><h2>Non-emergency office contact</h2><p>For appointment and office questions, call <a href="tel:+14323370555">+1 (432) 337-0555</a>. Check the <a href="/contact">office hours and directions</a> before travelling. If you are experiencing an emergency, call 911 rather than waiting for an online response.</p></section>
        </div>
      </section>
    </>
  );
}

export function NotFound() {
  return (
    <section className="section">
      <div className="container not-found">
        <p className="eyebrow">Page not found</p>
        <p className="error-number" aria-hidden="true">404</p>
        <h1>Let’s find a clear way forward.</h1>
        <p>This page is unavailable. No private record information is shown.</p>
        <div className="button-row">
          <Button to="/">Return home</Button>
          <Button to="/contact" variant="outline">Contact information</Button>
        </div>
      </div>
    </section>
  );
}
