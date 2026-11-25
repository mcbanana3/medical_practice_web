import HelpfulLinks from "../components/HelpfulLinks.jsx";
import AppointmentCTA from "../components/AppointmentCTA.jsx";
import ApprovedContent from "../components/ApprovedContent.jsx";
import Button from "../components/Button.jsx";
import PageIntro from "../components/PageIntro.jsx";
import { approvedContent } from "../content.js";

export default function Insurance() {
  return (
    <>
      <PageIntro eyebrow="Insurance and fees" title="Practical questions. Clear next steps.">
        <p>Coverage is not guaranteed by this website. Please confirm with the practice and your insurer.</p>
      </PageIntro>

      <section className="section">
        <div className="container finance-grid">
          <aside className="finance-note">
            <p className="eyebrow">Before an appointment</p>
            <h2>Please confirm with the practice.</h2>
            <p>Plan acceptance, network participation, benefits, and patient responsibility require verification.</p>
            <Button to="/contact" variant="outline">Contact information</Button>
          </aside>

          <div>
            <div className="coverage-checklist"><p className="eyebrow">A useful checklist</p><h2>Make your coverage conversation easier.</h2><p>When you contact your insurer, have your plan details and the physician’s name ready.</p><ul><li><strong>Network status</strong><span>Confirm participation for your specific plan.</span></li><li><strong>Visit costs</strong><span>Ask about your copay, deductible, and coinsurance.</span></li><li><strong>Plan requirements</strong><span>Ask whether a referral or prior authorization is needed.</span></li></ul><p className="help">Your insurer and the practice can help clarify costs before you book.</p></div>
            <ApprovedContent title="Plans and networks">{approvedContent.insurancePlans}</ApprovedContent>
            <ApprovedContent title="Benefits verification">{approvedContent.benefitsGuidance}</ApprovedContent>
            <ApprovedContent title="Self-pay fees">{approvedContent.selfPayFees}</ApprovedContent>
            <ApprovedContent title="Billing policies">{approvedContent.billingPolicies}</ApprovedContent>
            <ApprovedContent title="Estimate information">{approvedContent.estimateInformation}</ApprovedContent>
            <ApprovedContent title="Billing contact">{approvedContent.billingContact}</ApprovedContent>
          </div>
        </div>
      </section>

      <HelpfulLinks title="Know what to ask before your visit." items={[
        {to:"/contact",title:"Check with the practice",text:"Ask whether your specific plan is accepted and which payment options are available.",icon:"pin"},
        {to:"/new-patients",title:"Prepare for your visit",text:"Understand how to request an appointment and what happens after submission.",icon:"check"},
        {to:"/portal",title:"Your patient account",text:"Keep your contact information current and follow your appointment requests.",icon:"shield"}
      ]} />

      <AppointmentCTA />
    </>
  );
}