import AbstractArt from "../components/AbstractArt.jsx";
import AppointmentCTA from "../components/AppointmentCTA.jsx";
import ApprovedContent from "../components/ApprovedContent.jsx";
import PageIntro from "../components/PageIntro.jsx";
import { practice, approvedContent } from "../content.js";

export default function About() {
  return (
    <>
      <PageIntro eyebrow="About" title={practice.clinician} />

      <section className="section">
        <div className="container about-grid">
          <AbstractArt compact />
          <div>
            <p className="eyebrow">An introduction</p>
            <h2>{practice.clinician}</h2>
            <ApprovedContent title="Biography">{approvedContent.biography}</ApprovedContent>
            <ApprovedContent title="Care approach">{approvedContent.careApproach}</ApprovedContent>
            <ApprovedContent title="Professional information">
              {approvedContent.professionalInformation}
            </ApprovedContent>
            <ApprovedContent title="Practice and team">{approvedContent.team}</ApprovedContent>
          </div>
        </div>
      </section>

      <AppointmentCTA />
    </>
  );
}