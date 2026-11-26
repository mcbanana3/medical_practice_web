import { Link } from "react-router-dom";
import AbstractArt from "../components/AbstractArt.jsx";
import AppointmentCTA from "../components/AppointmentCTA.jsx";
import Button from "../components/Button.jsx";
import { Facts } from "../components/Content.jsx";
import Icon from "../components/Icon.jsx";
import ReviewsTeaser from "../components/ReviewsTeaser.jsx";
import { practice, approvedContent } from "../content.js";

export default function Home() {
  const contact = [
    ["Address", practice.address],
    ["Hours", practice.hours],
    ["Phone", practice.phone]
  ].filter(([, value]) => Boolean(value));

  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy entrance">
            <p className="eyebrow">{practice.name}</p>
            {practice.specialty && <p className="hero-specialty">{practice.specialty}</p>}

            <h1>A clear next step.<br /><span>Space to begin.</span></h1>

            <p className="hero-description">
              Request an appointment, find practical information, or securely access your patient account.
            </p>

            <div className="button-row">
              <Button to="/request-an-appointment">Request an appointment</Button>
              <Button to="/about" variant="text">About the practice</Button>
            </div>

            <p className="hero-note">
              <span aria-hidden="true" />
              Requests need staff approval before the appointment starts.
            </p>
          </div>

          <div className="hero-art entrance entrance-delay">
            <AbstractArt />
          </div>
        </div>
      </section>

      <section className="orientation">
        <div className="container orientation-grid">
          {[
            ["/care", "01", "Explore care information"],
            ["/new-patients", "02", "New-patient information"],
            ["/portal", "03", "Access your patient account"]
          ].map(([route, number, text]) => (
            <Link key={route} to={route}>
              <span className="index">{number}</span>
              <span>{text}</span><Icon />
            </Link>
          ))}
        </div>
      </section>

      {approvedContent.careOverview && (
        <section className="section">
          <div className="container editorial-grid">
            <div><p className="eyebrow">Care</p><h2>Information that helps you prepare.</h2></div>
            <div className="ruled-panel">
              <p className="lead">{approvedContent.careOverview}</p>
              <Button to="/care" variant="text">Explore care information</Button>
            </div>
          </div>
        </section>
      )}

      <section className="section sage-section">
        <div className="container clinician-grid">
          <div className="portrait-art"><AbstractArt compact /></div>
          <div>
            <p className="eyebrow">About</p>
            <h2>{practice.clinician}</h2>
            {approvedContent.biography && <p className="lead">{approvedContent.biography}</p>}
            <Button to="/about" variant="outline">About the practice</Button>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-topline">
            <div><p className="eyebrow">Appointments</p><h2>Know what happens next.</h2></div>
            <Link className="inline-link" to="/new-patients">New-patient information <Icon /></Link>
          </div>

          <ol className="process-grid">
            {[
              ["01", "Choose your pathway", "Continue as a guest or sign in to your patient account."],
              ["02", "Submit your request", "Choose a currently available time and review the details."],
              ["03", "Wait for staff approval", "The time is reserved while pending. Only approval confirms the appointment."]
            ].map(([number, title, text]) => (
              <li key={number}>
                <span className="process-number">{number}</span>
                <h3>{title}</h3><p>{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section ivory-section">
        <div className="container visit-grid">
          <div className="visit-card">
            <p className="eyebrow">Location and contact</p>
            <h2>Plan your next step.</h2>
            {contact.length > 0 && <Facts items={contact} />}
            <Button to="/contact" variant="text">Contact information</Button>
          </div>

          <div className="insurance-signpost">
            <span className="circle-icon"><Icon name="info" /></span>
            <h2>Insurance and fees</h2>
            <p>Please confirm coverage and payment information with the practice.</p>
            <Button to="/insurance-fees" variant="outline">Insurance information</Button>
          </div>
        </div>
      </section>

      <ReviewsTeaser />
      <AppointmentCTA />
    </>
  );
}