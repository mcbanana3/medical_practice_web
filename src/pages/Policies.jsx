import { Link } from "react-router-dom";
import PageIntro from "../components/PageIntro.jsx";
import { approvedContent } from "../content.js";

const entries = {
  privacy: ["Website Privacy Notice", "privacy"],
  "privacy-practices": ["Notice of Privacy Practices", "privacyPractices"],
  terms: ["Website Terms", "terms"],
  accessibility: ["Accessibility", "accessibility"],
  nondiscrimination: ["Notice of Non-Discrimination", "nondiscrimination"],
  "language-assistance": ["Language assistance", "languageAssistance"]
};

export default function Policies({ type }) {
  const [title, key] = entries[type];

  return (
    <>
      <PageIntro eyebrow="Policies and support" title={title} />
      <section className="section">
        <div className="container reading-width">
          {approvedContent[key]
            ? <p style={{ whiteSpace: "pre-line" }}>{approvedContent[key]}</p>
            : <p>Call the practice at +1 (432) 337-0555 for assistance with this information.</p>}
          <div className="button-row"><Link to="/contact">Contact information</Link></div>
        </div>
      </section>
    </>
  );
}