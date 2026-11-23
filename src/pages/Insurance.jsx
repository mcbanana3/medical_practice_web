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
            <ApprovedContent title="Plans and networks">{approvedContent.insurancePlans}</ApprovedContent>
            <ApprovedContent title="Benefits verification">{approvedContent.benefitsGuidance}</ApprovedContent>
            <ApprovedContent title="Self-pay fees">{approvedContent.selfPayFees}</ApprovedContent>
            <ApprovedContent title="Billing policies">{approvedContent.billingPolicies}</ApprovedContent>
            <ApprovedContent title="Estimate information">{approvedContent.estimateInformation}</ApprovedContent>
            <ApprovedContent title="Billing contact">{approvedContent.billingContact}</ApprovedContent>
          </div>
        </div>
      </section>

      <AppointmentCTA />
    </>
  );
}