import { useEffect, useRef, useState } from "react";
import Button from "../components/Button.jsx";
import { ContentSections } from "../components/Content.jsx";
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
          <ContentSections sections={[
            ["Non-emergency contact", "verified non-emergency contact method"],
            ["After-hours instructions", "practice-approved after-hours instructions"]
          ]} />
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

export function StatePreview() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const timer = useRef(null);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function demonstrate() {
    window.clearTimeout(timer.current);
    setLoading(true);
    setMessage("");
    timer.current = window.setTimeout(() => {
      setLoading(false);
      setMessage("Preview finished. No service was contacted.");
    }, 1000);
  }

  return (
    <>
      <PageIntro eyebrow="Unpublished quality-review tools" title="Interface states.">
        <p>Demonstrations only—not reports about a live service.</p>
      </PageIntro>
      <section className="section">
        <div className="container reading-width state-stack">
          <Notice title="Empty-state example">No matching requests. Change the filters or return to a safe starting page.</Notice>
          <Notice title="Error-state example" tone="error">The service is temporarily unavailable. This does not mean the practice is closed.</Notice>
          <Notice title="Session-expiry example">Your session ended. Unsaved work may need to be entered again. No real session exists here.</Notice>
          <Notice title="Uncertain-outcome example">A connected system must verify the saved request before inviting a duplicate submission.</Notice>
          <div className="loading-demo" aria-busy={loading}>
            <Button type="button" onClick={demonstrate} disabled={loading} arrow={false}>
              {loading && <span className="spinner" aria-hidden="true" />}
              {loading ? "Demonstrating loading…" : "Preview loading feedback"}
            </Button>
            <p role="status">{loading ? "Please wait. This is a loading demonstration." : message}</p>
          </div>
        </div>
      </section>
    </>
  );
}