import AppointmentCTA from "../components/AppointmentCTA.jsx";
import ApprovedContent from "../components/ApprovedContent.jsx";
import { Facts } from "../components/Content.jsx";
import LocationMap from "../components/LocationMap.jsx";
import { EmergencyNotice } from "../components/Notice.jsx";
import PageIntro from "../components/PageIntro.jsx";
import { practice, approvedContent } from "../content.js";

export default function Contact() {
  const details = [
    ["Phone", practice.phone],
    ["Administrative email", practice.administrativeEmail],
    ["Address", practice.address],
    ["Hours", practice.hours],
    ["Clinic time zone", practice.timeZone]
  ].filter(([, value]) => Boolean(value));

  return (
    <>
      <PageIntro eyebrow="Locations and contact" title="Find the practical details." />

      <section className="section section-tight">
        <div className="container">
          <EmergencyNotice />

          <div className="contact-grid">
            <div>
              <p className="eyebrow">Contact</p>
              <h2>{practice.name}</h2>

              {details.length
                ? <Facts items={details} />
                : <p className="section-copy">Contact details are not currently published here.</p>}

              <p className="help">
                Do not include medical details in ordinary email or administrative inquiries.
              </p>

              <ApprovedContent title="Arrival information">{approvedContent.arrival}</ApprovedContent>
              <ApprovedContent title="After-hours information">{approvedContent.afterHours}</ApprovedContent>
            </div>

            {practice.address && practice.map.verified && <LocationMap />}
          </div>
        </div>
      </section>

      <AppointmentCTA />
    </>
  );
}