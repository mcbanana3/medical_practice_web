import { useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/Button.jsx";
import { Placeholder } from "../components/Content.jsx";
import Icon from "../components/Icon.jsx";
import Notice from "../components/Notice.jsx";
import PageIntro from "../components/PageIntro.jsx";

export default function PortalEntry() {
  return (
    <>
      <PageIntro eyebrow="Patient portal" title="Your account. Your information.">
        <p>The planned portal covers your own profile, account security, and appointment history.</p>
      </PageIntro>
      <section className="section">
        <div className="container portal-grid">
          <div className="portal-feature">
            <span className="circle-icon"><Icon name="shield" /></span>
            <h2>Secure access is a separate setup step.</h2>
            <p>No patient database or working login exists in this phase.</p>
            <p>Proxy, guardian, minor, and dependent access remain out of scope.</p>
          </div>
          <div className="portal-options">
            <Button to="/portal/login">Sign in</Button>
            <Button to="/portal/register" variant="outline">Create an account</Button>
            <Link to="/portal/recovery">Password or account recovery</Link>
            <div className="content-section">
              <h2>Just requesting an appointment?</h2>
              <p>The guest pathway is separate from portal access.</p>
              <Link to="/request-an-appointment">Continue as guest</Link>
            </div>
            <p><Placeholder>verified portal support route</Placeholder></p>
          </div>
        </div>
      </section>
    </>
  );
}

export function AccessForm({ mode = "login" }) {
  const [message, setMessage] = useState("");

  const titles = {
    login: "Welcome back.",
    register: "Create your patient account.",
    recovery: "A secure way back in.",
    staff: "Staff workspace."
  };

  const actions = {
    login: "Sign in",
    register: "Create an account",
    recovery: "Request recovery instructions",
    staff: "Staff sign in"
  };

  return (
    <>
      <PageIntro
        eyebrow={mode === "staff" ? "Separate staff entry" : "Patient account"}
        title={titles[mode]}
      >
        <p>Secure authentication and identity verification are available in a later setup step.</p>
      </PageIntro>

      <section className="section">
        <div className="container access-grid">
          <div className="access-card">
            <Notice title="Not connected">
              Fields are disabled. Do not enter account credentials into this preview.
            </Notice>

            <form onSubmit={(event) => {
              event.preventDefault();
              setMessage("Not connected. No credentials were submitted and no email was sent.");
            }}>
              <fieldset disabled className="disabled-fields">
                <legend className="sr-only">Unavailable account fields</legend>
                <div className="field">
                  <label htmlFor="account-email">Email</label>
                  <input id="account-email" type="email" autoComplete="email" />
                </div>
                {mode !== "recovery" && (
                  <div className="field">
                    <label htmlFor="account-password">Password</label>
                    <input
                      id="account-password"
                      type="password"
                      autoComplete={mode === "register" ? "new-password" : "current-password"}
                    />
                  </div>
                )}
              </fieldset>

              <Button type="submit">{actions[mode]}</Button>
              <div role="status" className="outcome">
                {message && <Notice title="Unavailable in this phase">{message}</Notice>}
              </div>
            </form>

            <div className="inline-links">
              {mode !== "staff" && <Link to="/portal">Portal entry</Link>}
              {mode === "login" && <Link to="/portal/recovery">Account recovery</Link>}
              <Link to="/privacy">Privacy information</Link>
            </div>
          </div>

          <aside>
            <p className="eyebrow">Verification protects access</p>
            <h2>Shared email does not mean shared access.</h2>
            <p className="section-copy">
              Guest requests may link to an account only through a verified
              process. Generic authentication and recovery responses must not
              reveal account existence.
            </p>
            <p><Placeholder>verified account support route</Placeholder></p>
          </aside>
        </div>
      </section>
    </>
  );
}

export function ManageRequest() {
  const [message, setMessage] = useState("");

  return (
    <>
      <PageIntro eyebrow="Appointment requests" title="Manage your request securely.">
        <p>Identity verification is required before request details or permitted actions appear.</p>
      </PageIntro>
      <section className="section">
        <div className="container reading-width">
          <Notice title="Verification is not connected">
            No request lookup is performed. This page does not reveal whether
            a private record exists.
          </Notice>

          <div className="button-row">
            <Button type="button" onClick={() => setMessage(
              "Not connected. Verified request management is available in a later setup step."
            )}>Begin verification</Button>
          </div>

          <div role="status" className="outcome">
            {message && <Notice title="Not connected">{message}</Notice>}
          </div>

          <div className="content-section">
            <h2>Changes must be explicit.</h2>
            <p>
              The connected system must distinguish proposed changes,
              cancellation requests, and final outcomes. An existing confirmed
              appointment must remain while a replacement is pending.
            </p>
          </div>

          <Button to="/contact" variant="outline">Contact information</Button>
        </div>
      </section>
    </>
  );
}