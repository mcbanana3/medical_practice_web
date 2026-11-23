import { Link } from "react-router-dom";
import { Brand } from "./Header.jsx";
import Icon from "./Icon.jsx";
import { emergency, site } from "../site.js";
import { practice } from "../content.js";

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <Brand />
            <p>Practice information.<br />Clear next steps.</p>
          </div>

          <div>
            <h2>Contact</h2>
            {practice.address && <p>{practice.address}</p>}
            {practice.phone && <p>{practice.phone}</p>}
            <Link to="/contact">Location and contact information</Link>
          </div>

          <div>
            <h2>Patient information</h2>
            <Link to="/new-patients">New patients</Link>
            <Link to="/insurance-fees">Insurance and fees</Link>
            <Link to="/reviews">Reviews</Link>
            <Link to="/portal">Patient portal</Link>
            <Link to="/manage-request">Manage a request</Link>
          </div>

          <div>
            <h2>Policies and support</h2>
            <Link to="/privacy">Website Privacy Notice</Link>
            <Link to="/terms">Website Terms</Link>
            <Link to="/accessibility">Accessibility</Link>
            <Link to="/emergency">Emergency information</Link>
            {site.notices.privacyPractices && <Link to="/privacy-practices">Notice of Privacy Practices</Link>}
            {site.notices.nondiscrimination && <Link to="/nondiscrimination">Non-Discrimination</Link>}
            {site.notices.languageAssistance && <Link to="/language-assistance">Language assistance</Link>}
          </div>
        </div>

        <div className="footer-emergency">
          <Icon name="info" /><p>{emergency}</p>
        </div>

        <div className="footer-bottom">
          <p>© {practice.name}</p>
          <a href="#top">Back to top ↑</a>
        </div>
      </div>
    </footer>
  );
}