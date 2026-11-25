import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Brand } from "../components/Header.jsx";
import Button from "../components/Button.jsx";
import { practice } from "../content.js";
import Layout from "../components/Layout.jsx";
import Notice from "../components/Notice.jsx";
import PageIntro from "../components/PageIntro.jsx";
import Recaptcha from "../components/Recaptcha.jsx";
import GoogleIdentity from "../auth/GoogleIdentity.jsx";
import { useAuth } from "../auth/AuthProvider.jsx";
import { post, request } from "../auth/client.js";
import PatientProfile from "../components/PatientProfile.jsx";
import PatientAppointmentDetail from "../components/PatientAppointmentDetail.jsx";

const statusLabels = {
  pending: "Requested — pending approval",
  approved: "Approved — confirmed",
  reschedule_requested: "Reschedule requested",
  cancel_requested: "Cancellation requested",
  declined: "Declined",
  cancelled: "Cancelled",
  completed: "Completed",
  no_show: "No-show",
  expired: "Expired — not confirmed"
};

function dateTime(value, zone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function useData(path, identity) {
  const resourceKey = `${identity}:${path}`;
  const [state, setState] = useState({ key: null, loading: true, data: null, error: "" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ key: resourceKey, loading: true, data: null, error: "" });

    request(path, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setState({ key: resourceKey, loading: false, data, error: "" }); })
      .catch((error) => {
        if (!controller.signal.aborted && error.name !== "AbortError") {
          setState({ key: resourceKey, loading: false, data: null, error: error.message });
        }
      });

    return () => controller.abort();
  }, [path, identity, version]);

  return { ...(state.key === resourceKey ? state : {loading:true,data:null,error:""}), reload: () => setVersion((value) => value + 1) };
}

function DataState({ state, children }) {
  if (state.loading) return <p role="status">Loading your information…</p>;
  if (state.error) {
    return (
      <div>
        <Notice title="Information unavailable">{state.error}</Notice>
        <div className="button-row">
          <Button type="button" variant="outline" onClick={state.reload}>Retry</Button>
        </div>
      </div>
    );
  }
  return state.data ? children(state.data) : null;
}

function AppointmentList({ data }) {
  if (!data.items.length) {
    return (
      <Notice title="Nothing to show yet">
        No matching appointments or requests are linked to this account.
        <p><Link to="/request-an-appointment">Request an appointment</Link></p>
        <p><Link to="/portal/link">Link a verified guest request</Link></p>
      </Notice>
    );
  }

  return (
    <>
      <p className="help">Clinic time zone: {data.clinicTimeZone}</p>
      <ul className="portal-appointments">
        {data.items.map((item) => (
          <li key={item.reference}>
            <span className={`portal-status portal-status--${item.status}`}>{statusLabels[item.status] || "Status unavailable"}</span>
            <h2><Link to={`/portal/appointments/${item.reference}`}>{item.appointmentType}</Link></h2>
            <p>{dateTime(item.startsAt, data.clinicTimeZone)}</p>
            <p>{item.location} · {item.provider}</p>
          </li>
        ))}
      </ul>
    </>
  );
}

function Overview({ patient }) {
  const state = useData("/api/portal/overview", patient.reference);
  return <>
    <section className="portal-welcome"><div><p className="eyebrow">Your care, in one place</p><h2>Welcome{patient.displayName ? `, ${patient.displayName}` : " back"}.</h2><p>Keep your details up to date and follow your appointment requests.</p></div><span className="portal-account-badge">Email verified</span></section>
    <div className="portal-shortcuts"><Link to="/portal/profile"><strong>Your patient profile</strong><span>Update contact and health information</span></Link><Link to="/portal/account"><strong>Account &amp; security</strong><span>Manage passwords and active sessions</span></Link><Link to="/portal/link"><strong>Link a guest request</strong><span>Use a code provided by the practice</span></Link></div>
    <div className="portal-section-heading"><h2>Upcoming appointments &amp; requests</h2><button className="text-button" disabled={state.loading} onClick={state.reload}>Refresh status</button></div>
    <DataState state={state}>{data => <AppointmentList data={data} />}</DataState><Link to="/portal/appointments">View all appointment history</Link>
  </>;
}

function History({ patient }) {
  const [page, setPage] = useState(0);
  const state = useData(`/api/portal/appointments?page=${page}`, patient.reference);

  return (
    <DataState state={state}>
      {(data) => (
        <>
          <div className="portal-section-heading"><p>Page {page + 1}</p><button className="text-button" onClick={state.reload}>Refresh history</button></div>
          <AppointmentList data={data} />
          <div className="button-row">
            <Button type="button" variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button type="button" variant="outline" disabled={!data.hasNext} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </>
      )}
    </DataState>
  );
}

function Detail({ patient, reference }) {
  return (
    <PatientAppointmentDetail
      key={reference}
      patient={patient}
      reference={reference}
    />
  );
}

function Profile() {
  return <PatientProfile />;
}

function LinkGuest() {
  const [code, setCode] = useState("");
  const [captcha, setCaptcha] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const widget = useRef(null);

  return (
    <>
      <Notice title="Independent identity verification comes first">
        Ask the practice to follow its approved verification process.
        Matching a name or email cannot grant record access.
      </Notice>
      <form onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        if (!/^[a-f0-9]{64}$/.test(code.trim())) return setMessage("Enter the complete 64-character linking code supplied by the practice.");
        if (!captcha) return setMessage("Complete the security check.");
        setBusy(true);
        try {
          const result = await post("/api/portal/link", { code: code.trim(), captchaToken: captcha });
          setCode("");
          setMessage(result.message);
        } catch (error) {
          setMessage(error.message);
        } finally {
          setBusy(false);
          setCaptcha("");
          widget.current?.reset();
        }
      }}>
        <div className="field">
          <label htmlFor="guest-link-code">Account-bound linking code</label>
          <input
            id="guest-link-code" type="password" autoComplete="off" maxLength={64} spellCheck={false}
            required value={code} onChange={(event) => setCode(event.target.value)}
          />
        </div>
        <Recaptcha ref={widget} onToken={setCaptcha} />
        <div className="button-row"><Button type="submit" disabled={busy || !captcha || !code.trim()}>Link verified request</Button></div>
        <p role="status">{message}</p>
      </form>
    </>
  );
}

function Security() {
  const auth = useAuth();
  const sessions = useData("/api/portal/sessions", auth.patient.reference);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [captcha, setCaptcha] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const widget = useRef(null);
  const sending = useRef(false);

  async function action(path, body, needsCaptcha = false) {
    if (sending.current) return;
    if (needsCaptcha && !captcha) return setMessage("Complete the security check.");
    sending.current = true;
    setBusy(true);
    setMessage("");

    try {
      const result = await post(path, {
        ...body, ...(needsCaptcha ? { captchaToken: captcha } : {})
      });
      setCurrentPassword("");
      setNewPassword("");
      await auth.refresh();
      sessions.reload();
      setMessage(result.message || "Security action completed.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      sending.current = false;
      setBusy(false);
      if (needsCaptcha) {
        setCaptcha("");
        widget.current?.reset();
      }
    }
  }

  return (
    <>
      {message && <div className="portal-feedback" role="status">{message}</div>}
      <section className="portal-block">
        <h2>{auth.patient.hasPassword ? "Change password" : "Set a password"}</h2>
        <form onSubmit={(event) => {
          event.preventDefault();
          action("/api/portal/password", { currentPassword, newPassword }, true);
        }}>
          {auth.patient.hasPassword && (
            <div className="field">
              <label htmlFor="current-password">Current password</label>
              <input id="current-password" type="password" autoComplete="current-password"
                value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor="new-password">New password — 8–128 characters</label>
            <input id="new-password" type="password" autoComplete="new-password"
              required minLength={8} maxLength={128} value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)} />
          </div>
          <Recaptcha ref={widget} onToken={setCaptcha} />
          <div className="button-row"><Button type="submit" disabled={busy || !captcha || !newPassword || (auth.patient.hasPassword && !currentPassword)}>Update password</Button></div>
        </form>

        {auth.googleClientId && (
          <>
            <GoogleIdentity
              purpose={auth.patient.googleLinked ? "reauth" : "link"}
              currentPassword={currentPassword}
            />
            {!auth.patient.googleLinked && (
              <p className="help">Enter your current password above before explicitly linking Google.</p>
            )}
            {auth.patient.googleLinked && auth.patient.hasPassword && (
              <Button type="button" variant="outline" disabled={busy}
                onClick={() => action("/api/portal/google/unlink", { currentPassword }, true)}>
                Unlink Google
              </Button>
            )}
          </>
        )}
      </section>

      <section className="portal-block">
        <h2>Active sessions</h2>
        <DataState state={sessions}>
          {(data) => (
            <ul className="portal-session-list">
              {data.items.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.current ? "This session" : "Other session"}</strong>
                    <p className="help">Last active: {new Date(item.lastSeenAt).toUTCString()}</p>
                  </div>
                  <Button type="button" variant="outline" disabled={busy}
                    onClick={() => action("/api/portal/sessions/revoke", { id: item.id })}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DataState>
        <Button type="button" variant="outline" disabled={busy}
          onClick={() => { if (window.confirm("Sign out all devices, including this one?")) action("/api/portal/sessions/revoke-all", {}); }}>
          Sign out all sessions
        </Button>
      </section>

    </>
  );
}

export default function Portal() {
  const auth = useAuth();
  const { pathname } = useLocation();
  const [logoutError, setLogoutError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const main = useRef(null);
  useEffect(() => { main.current?.focus({preventScroll:true}); window.scrollTo({top:0,behavior:"instant"}); }, [pathname, Boolean(auth.patient)]);
  async function signOut() {
    if (signingOut) return;
    setSigningOut(true); setLogoutError("");
    try { await auth.logout(); } catch (error) { setLogoutError(error.message); }
    finally { setSigningOut(false); }
  }

  if (auth.loading) {
    return <div className="container section"><p role="status">Checking your session…</p></div>;
  }

  if (!auth.patient) {
    return (
      <Layout>
        <PageIntro eyebrow="Patient portal" title="Your account. Your information.">
          <p>Sign in to access only your own linked profile and appointment information.</p>
        </PageIntro>
        <section className="section">
          <div className="container reading-width">
            {auth.error && <Notice title="Account services unavailable">{auth.error}<button className="text-button" onClick={auth.refresh}>Retry connection</button></Notice>}
            {pathname !== "/portal" && (
              <Notice title="Sign in again">
                Your session may have expired. Unsaved work may need to be entered again.
                No private record information is shown.
              </Notice>
            )}
            <div className="button-row">
              <Button to="/portal/login">Sign in</Button>
              <Button to="/portal/register" variant="outline">Create account</Button>
            </div>
            <div className="inline-links">
              <Link to="/portal/recovery">Account recovery</Link>
              <Link to="/request-an-appointment">Request as guest</Link>
            </div>
          </div>
        </section>
      </Layout>
    );
  }

  const detail = pathname.match(/^\/portal\/appointments\/([a-f0-9]{32})$/);
  const title = detail ? "Appointment / request detail"
    : pathname === "/portal/appointments" ? "Appointments and request history"
    : pathname === "/portal/profile" ? "Profile"
    : pathname === "/portal/account" ? "Account and security"
    : pathname === "/portal/link" ? "Link a guest request"
    : "Overview";

  let content = detail
    ? <Detail patient={auth.patient} reference={detail[1]} />
    : pathname === "/portal/appointments" ? <History patient={auth.patient} />
    : pathname === "/portal/profile" ? <Profile key={auth.patient.reference} />
    : pathname === "/portal/account" ? <Security key={auth.patient.reference} />
    : pathname === "/portal/link" ? <LinkGuest key={auth.patient.reference} />
    : pathname === "/portal" ? <Overview patient={auth.patient} />
    : <Notice title="Page unavailable">Return to the portal overview.</Notice>;

  return (
    <div className="patient-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="portal-header">
        <div className="container">
          <Brand />
          <span>Patient portal</span>
          <button type="button" className="text-button" disabled={signingOut} onClick={signOut}>
            {signingOut ? "Signing out�" : "Sign out"}
          </button>
        </div>
      </header>

      <nav className="portal-nav" aria-label="Patient portal">
        <div className="container">
          <NavLink to="/portal" end>Overview</NavLink>
          <NavLink to="/portal/appointments">Appointments</NavLink>
          <NavLink to="/portal/profile">Profile</NavLink>
          <NavLink to="/portal/account">Account &amp; security</NavLink>
          <NavLink to="/portal/link">Link request</NavLink>
        </div>
      </nav>

      <main id="main-content" className="container section portal-main" tabIndex="-1" ref={main}>
        <div className="section-topline">
          <div><p className="eyebrow">Patient account</p><h1>{title}</h1></div>
          <Button to="/request-an-appointment">Request an appointment</Button>
        </div>
        {logoutError && <Notice title="Sign-out could not be verified" tone="error">{logoutError}</Notice>}
        {content}
      </main>

      <footer className="portal-footer container">
        <p>Need help? <a href="tel:+14323370555">{practice.phone}</a></p><p className="help">Portal updates are not monitored for emergencies. For a medical emergency, call 911.</p>
        <div className="inline-links">
          <Link to="/privacy">Privacy</Link>
          <Link to="/accessibility">Accessibility</Link>
          <Link to="/">Public website</Link>
        </div>
      </footer>
    </div>
  );
}