import HelpfulLinks from "../components/HelpfulLinks.jsx";
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

      <HelpfulLinks title="Find the right information for your visit." items={[
        {to:"/about",title:"Meet your physician",text:"Get to know Dr. Harika Thummala and her approach to adult healthcare.",icon:"shield"},
        {to:"/request-an-appointment",title:"Request a time",text:"Choose an available 30-minute slot. Staff approval confirms your appointment.",icon:"check"},
        {to:"/contact",title:"Have a question?",text:"Call the practice to confirm available services and discuss the next step.",icon:"pin"}
      ]} />

      <AppointmentCTA />
    </>
  );
}

export function ServiceDetail() {
  return <Care />;
}