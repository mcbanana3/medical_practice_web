import AppointmentCTA from "../components/AppointmentCTA.jsx";
import ApprovedContent from "../components/ApprovedContent.jsx";
import Button from "../components/Button.jsx";
import HelpfulLinks from "../components/HelpfulLinks.jsx";
import Icon from "../components/Icon.jsx";
import { practice, approvedContent } from "../content.js";

export default function About() {
  return <>
    <section className="physician-hero"><div className="container physician-hero-grid">
      <div className="physician-intro"><p className="eyebrow">Meet your physician · Odessa, Texas</p><h1>{practice.clinician}</h1><p className="physician-specialty">{practice.specialty}</p><p className="lead">Thoughtful care begins with understanding the person behind every health concern.</p><div className="button-row"><Button to="/request-an-appointment">Request an appointment</Button><Button to="/contact" variant="text">Get in touch</Button></div><p className="physician-note"><Icon name="pin" /> Adult healthcare in Odessa, Texas</p></div>
      <figure className="physician-portrait"><img src="/potrait.png" alt="Dr. Harika Thummala" /><figcaption><span>{practice.clinician}</span><span>{practice.specialty}</span></figcaption></figure>
    </div></section>
    <section className="section"><div className="container physician-story">
      <aside className="physician-index"><p className="eyebrow">Getting to know us</p><h2>A personal introduction.</h2><nav aria-label="About page sections"><a href="#physician-background">Background <Icon /></a><a href="#physician-approach">Approach to care <Icon /></a><a href="#physician-details">Professional information <Icon /></a></nav><div className="physician-location"><Icon name="pin" /><p>{practice.address}</p></div></aside>
      <div className="physician-content"><div id="physician-background"><ApprovedContent title="Experience and background">{approvedContent.biography}</ApprovedContent></div><div id="physician-approach"><ApprovedContent title="Care that starts with you">{approvedContent.careApproach}</ApprovedContent></div><div id="physician-details"><ApprovedContent title="Professional information">{approvedContent.professionalInformation}</ApprovedContent></div><ApprovedContent title="The practice">{approvedContent.team}</ApprovedContent></div>
    </div></section>
    <HelpfulLinks title="Feel prepared for what comes next." items={[
      {to:"/care",title:"Explore our care",text:"Learn about Internal Medicine and contact the practice with your questions.",icon:"shield"},
      {to:"/new-patients",title:"Your first visit",text:"Understand the request process before choosing an available appointment.",icon:"check"},
      {to:"/contact",title:"Find the practice",text:"Office hours, contact details, and directions, together in one place.",icon:"pin"}
    ]} />
    <AppointmentCTA />
  </>;
}
