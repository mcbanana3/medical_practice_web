import HelpfulLinks from "../components/HelpfulLinks.jsx";
import AppointmentCTA from "../components/AppointmentCTA.jsx";
import ApprovedContent from "../components/ApprovedContent.jsx";
import Button from "../components/Button.jsx";
import PageIntro from "../components/PageIntro.jsx";
import { approvedContent } from "../content.js";

export default function NewPatients() {
  return (
    <>
      <PageIntro eyebrow="New patients" title="A clear beginning.">
        <p>Please confirm whether the practice is accepting new-patient requests.</p>
      </PageIntro>

      <section className="section">
        <div className="container editorial-grid">
          <div>
            <p className="eyebrow">The request process</p>
            <h2>Request first.<br />Confirmation follows approval.</h2>
          </div>

          <ol className="vertical-steps">
            <li><span>01</span><div><h3>Choose your pathway</h3><p>Continue as a guest or sign in to your patient account.</p></div></li>
            <li><span>02</span><div><h3>Select an available time</h3><p>Review appointment context, clinic-local time, and contact information.</p></div></li>
            <li><span>03</span><div><h3>Wait for staff approval</h3><p>A received request is pending, not confirmed.</p></div></li>
          </ol>
        </div>
      </section>

      <section className="section sage-section">
        <div className="container editorial-grid">
          <div><p className="eyebrow">Before a visit</p><h2>Practical information.</h2></div>
          <div>
            <div className="preparation-note"><h3>Let’s get your visit started.</h3><p>Have your name, email address, US phone number, and a short description of your appointment reason ready when you book.</p><p>Your requested time is held while staff review it. Watch your email for updates, and check your patient portal for the latest status.</p></div>
            <ApprovedContent title="Eligibility">{approvedContent.newPatientEligibility}</ApprovedContent>
            <ApprovedContent title="What to bring">{approvedContent.preparation}</ApprovedContent>
            <ApprovedContent title="Forms">{approvedContent.forms}</ApprovedContent>
            <ApprovedContent title="Insurance preparation">{approvedContent.insurancePreparation}</ApprovedContent>
            <ApprovedContent title="Arrival">{approvedContent.arrival}</ApprovedContent>
            <Button to="/contact" variant="outline">Contact information</Button>
          </div>
        </div>
      </section>

      <HelpfulLinks title="A few helpful places to start." items={[
        {to:"/insurance-fees",title:"Coverage questions",text:"Review what to confirm with the practice and your insurance provider.",icon:"shield"},
        {to:"/portal/register",title:"Create your profile",text:"Register and verify your email to access your patient account.",icon:"check"},
        {to:"/contact",title:"Plan your journey",text:"Find the office address, hours, and directions before your visit.",icon:"pin"}
      ]} />

      <AppointmentCTA />
    </>
  );
}