import AppointmentCTA from "../components/AppointmentCTA.jsx";
import ApprovedContent from "../components/ApprovedContent.jsx";
import Button from "../components/Button.jsx";
import PageIntro from "../components/PageIntro.jsx";
import { approvedContent } from "../content.js";

export default function Care() {
  return (
    <>
      <PageIntro eyebrow="Care" title="Information about available care.">
        <p>Please confirm services and patient eligibility with the practice.</p>
      </PageIntro>

      <section className="section">
        <div className="container directory-grid">
          <div>
            <p className="eyebrow">Care information</p>
            <h2>A clearer next step.</h2>
          </div>

          <div>
            <ApprovedContent title="Overview">{approvedContent.careOverview}</ApprovedContent>

            {approvedContent.services.map((service) => (
              <ApprovedContent key={service.title} title={service.title}>
                {service.description}
              </ApprovedContent>
            ))}

            <ApprovedContent title="Scope and limitations">
              {approvedContent.careLimitations}
            </ApprovedContent>

            <Button to="/contact" variant="outline">Contact information</Button>
          </div>
        </div>
      </section>

      <AppointmentCTA />
    </>
  );
}

export function ServiceDetail() {
  return <Care />;
}