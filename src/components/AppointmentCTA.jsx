import Button from "./Button.jsx";

export default function AppointmentCTA() {
  return (
    <section className="appointment-cta">
      <div className="container cta-inner">
        <div>
          <p className="eyebrow">Your next step</p>
          <h2>Request an appointment.</h2>
          <p>A request is the beginning. Staff approval is required for confirmation.</p>
        </div>
        <Button to="/request-an-appointment" variant="light">
          Request an appointment
        </Button>
      </div>
    </section>
  );
}