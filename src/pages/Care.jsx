import HelpfulLinks from "../components/HelpfulLinks.jsx";
import AppointmentCTA from "../components/AppointmentCTA.jsx";
import ApprovedContent from "../components/ApprovedContent.jsx";
import Button from "../components/Button.jsx";
import PageIntro from "../components/PageIntro.jsx";
import { approvedContent } from "../content.js";

export default function Care() {
  return (
    <>
      <PageIntro eyebrow="Care" title="Internal Medicine in Odessa, TX.">
        <p>Explore adult healthcare and prepare for an appointment with Dr. Harika Thummala in Odessa.</p>
      </PageIntro>

      <section className="section">
        <div className="container directory-grid">
          <div>
            <p className="eyebrow">Care information</p>
            <h2>Adult healthcare, with a fuller picture.</h2>
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

      <section className="section helpful-section"><div className="container reading-width"><p className="eyebrow">Questions before a visit</p><h2>Internal Medicine and appointment questions</h2>
        <details><summary>What does an Internal Medicine physician do?</summary><p>Internal Medicine physicians care for adults. Their work can include evaluating symptoms, discussing prevention, and managing ongoing health conditions. Your individual concerns determine the conversation and next steps at your appointment.</p></details>
        <details><summary>Is Internal Medicine the same as family medicine?</summary><p>Internal Medicine focuses on adult healthcare. If you are arranging a visit for a child or have a question about patient eligibility, call the office before requesting a time.</p></details>
        <details><summary>Can I book without a patient account?</summary><p>Yes. You can request an appointment as a guest. Name, email, a valid US phone number, and a short visit reason are required. A guest booking can be linked to a patient account after identity verification.</p></details>
        <details><summary>When is my appointment confirmed?</summary><p>Submitting a request holds the available 30-minute slot while staff review it. Only staff approval confirms the appointment. An unapproved request expires at its scheduled start time.</p></details>
        <details><summary>How do I change or cancel an appointment?</summary><p>Sign in to your patient portal to manage linked appointments, or call the office for help with a guest request. If you request a replacement time, the original is kept until the replacement is approved.</p></details>
        <p className="help">General specialty information: <a href="https://www.acponline.org/about-acp/about-internal-medicine" target="_blank" rel="noreferrer">American College of Physicians: About Internal Medicine</a>. For questions about services at this office, call +1 (432) 337-0555.</p>
      </div></section>
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