import {
  LocalAuthPage, LocalAccount, LocalAccess, isLocalAuthPath
} from "./LocalAuth.jsx";
import {
    useCallback, useEffect, useRef, useState
} from "react";
import {
    Link, NavLink, Navigate, Route, Routes,
    useLocation
} from "react-router-dom";

import { practice } from "../content.js";
import { api, post, params, loginUrl, setStaffCsrf } from "./client.js";
import {
    StaffContext, useStaff, permissions, useResource,
    Resource, Problem, Confirm, PairSelect,
    pairKey, dateTime, clinicDate, AppointmentTable, Value
} from "./ui.jsx";
import { Queue, Availability } from "./Schedules.jsx";
import RequestDetail from "./RequestDetail.jsx";
import "./staff.css";

function Gate({ permission, children }) {
    const { can } = useStaff();
    return can(permission) ? children : (
        <section>
            <h1>Access unavailable</h1>
            <p>Your assigned resource grants do not permit this page.</p>
            <Link to="/staff/account">Staff account</Link>
        </section>
    );
}

function Patients() {
    const { search: locationSearch } = useLocation();
    const initial = new URLSearchParams(locationSearch).get("q") || "";

    const [input, setInput] = useState(initial);
    const [search, setSearch] = useState(initial);
    const [selected, setSelected] = useState("");
    const [error, setError] = useState(null);

    const state = useResource(
        search ? "/patients?" + params({ q: search }) : null
    );

    useEffect(() => {
        setInput(initial);
        setSearch(initial);
        setSelected("");
    }, [initial]);

    return (
        <section>
            <p className="staff-eyebrow">Purpose-limited access</p>
            <h1>Patient lookup</h1>
            <p>
                Enter an exact registered email or full patient reference.
                No patient directory is loaded.
            </p>

            <form className="staff-actions" onSubmit={event => {
                event.preventDefault();
                setSelected("");
                setError(null);
                const value = input.trim();

                if (
                    !/^[a-f0-9]{32}$/.test(value) &&
                    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
                ) {
                    setError(new Error("Enter the full patient reference or exact registered email."));
                    return;
                }

                if (value === search) state.reload();
                else setSearch(value);
            }}>
                <label>
                    Exact account email / patient reference
                    <input
                        autoComplete="off" required maxLength={254}
                        value={input} onChange={e => setInput(e.target.value)}
                    />
                </label>
                <button>Find authorized patient</button>
                <button type="button" onClick={() => {
                    setInput(""); setSearch(""); setSelected(""); setError(null);
                }}>Clear</button>
            </form>

            <Problem error={error} />

            <Resource state={state}>{data => (
                <>
                    {!data.items.length && (
                        <div className="staff-empty">
                            No exact match is available within your authorized scope.
                        </div>
                    )}
                    {data.items.map(item => (
                        <article className="staff-panel" key={item.reference}>
                            <h2>{item.displayName || "Patient account"}</h2>
                            <p className="staff-reference">{item.reference}</p>
                            <button onClick={() => setSelected(item.reference)}>
                                Open limited summary
                            </button>
                        </article>
                    ))}
                </>
            )}</Resource>

            {selected && <PatientSummary key={selected} reference={selected} />}
        </section>
    );
}

function PatientSummary({ reference }) {
    const state = useResource("/patients/" + reference);
    return (
        <Resource state={state}>
            {data => <PatientRecord data={data} />}
        </Resource>
    );
}

function PatientRecord({ data }) {
    const { can } = useStaff();
    const [showMedical, setShowMedical] = useState(false);

    const medical = useResource(showMedical
        ? "/patients/" + data.patient.reference + "/medical"
        : null);

    const medicalAllowed = data.appointments.some(item =>
        can("medical", item.locationId, item.providerId)
    );

    return (
        <section className="staff-panel">
            <h2>{data.patient.displayName || "Patient summary"}</h2>
            <Value value={{
                Reference: data.patient.reference,
                Email: data.patient.email,
                Phone: data.patient.phone
            }} />

            <p className="staff-help">
                This is a limited summary, not a complete medical record.
                Appointment history below contains at most the latest 25 authorized records.
            </p>

            <AppointmentTable
                items={data.appointments}
                zone={data.clinicTimeZone}
            />

            {medicalAllowed && (
                <section>
                    <h3>Patient-reported medical information</h3>
                    <p>
                        Load only when necessary for your assigned work.
                        Administrative access alone does not grant this permission.
                    </p>
                    <button onClick={() => setShowMedical(value => !value)}>
                        {showMedical ? "Hide medical information" : "Load authorized medical information"}
                    </button>
                    {showMedical && (
                        <Resource state={medical}>
                            {result => <Value value={result.details} />}
                        </Resource>
                    )}
                </section>
            )}
        </section>
    );
}

function Audit() {
    const { options } = useStaff();
    const today = clinicDate(new Date(), options.clinicTimeZone);
    const initial = { from: today, to: today, event: "" };

    const [draft, setDraft] = useState(initial);
    const [filters, setFilters] = useState(initial);
    const [offsets, setOffsets] = useState([0]);

    const state = useResource("/audit?" + params({
        ...filters, offset: offsets.at(-1)
    }));

    return (
        <section>
            <p className="staff-eyebrow">Accountability</p>
            <h1>Authorized audit history</h1>
            <p>
                Events are limited to your audit grants.
                Passwords, tokens, private notes, and medical narratives are not shown.
            </p>

            <form className="staff-grid" onSubmit={event => {
                event.preventDefault();
                setFilters({ ...draft });
                setOffsets([0]);
                if (JSON.stringify(draft) === JSON.stringify(filters)) state.reload();
            }}>
                <label>
                    From
                    <input type="date" required value={draft.from}
                        onChange={e => setDraft(s => ({ ...s, from: e.target.value }))} />
                </label>
                <label>
                    Through
                    <input type="date" required min={draft.from} value={draft.to}
                        onChange={e => setDraft(s => ({ ...s, to: e.target.value }))} />
                </label>
                <label>
                    Event prefix — optional
                    <input
                        value={draft.event}
                        pattern="[a-zA-Z0-9_.:\-]*" maxLength={64}
                        onChange={e => setDraft(s => ({ ...s, event: e.target.value }))}
                    />
                </label>
                <button>Apply audit filters</button>
            </form>

            <Resource state={state}>{data => (
                <>
                    <p className="staff-help">Clinic time zone: {data.clinicTimeZone}</p>
                    {!data.items.length && <div className="staff-empty">No authorized events match.</div>}
                    {data.items.map(item => (
                        <article className="staff-panel" key={item.id}>
                            <h2>{item.event}</h2>
                            <p>{item.actor} · {dateTime(item.createdAt, data.clinicTimeZone)}</p>
                            {item.reference && <p>Request reference: {item.reference}</p>}
                            <details>
                                <summary>Safe event metadata</summary>
                                <Value value={item.details} />
                            </details>
                        </article>
                    ))}
                    <div className="staff-actions">
                        <button disabled={offsets.length === 1}
                            onClick={() => setOffsets(v => v.slice(0, -1))}>
                            Previous page
                        </button>
                        <span>Page {offsets.length}</span>
                        <button disabled={data.nextOffset == null}
                            onClick={() => setOffsets(v => [...v, data.nextOffset])}>
                            Next page
                        </button>
                    </div>
                </>
            )}</Resource>
        </section>
    );
}

function Account() {
    const { session, options, endSession, askLogout } = useStaff();
    const state = useResource("/sessions");
    const [target, setTarget] = useState(null);
    const [message, setMessage] = useState("");

    return (
        <section>
            <p className="staff-eyebrow">Your staff identity</p>
            <h1>Account and sessions</h1>
            <h2>{session.name}</h2>

            <ul>
                {session.grants.map((g, index) => (
                    <li key={index}>
                        Location {g.locationId} / provider {g.providerId}: {g.role}
                    </li>
                ))}
            </ul>

            <div className="staff-actions">
                <a href={loginUrl + "?fresh=1"}>Fresh staff authentication</a>
                <button onClick={askLogout}>Sign out of staff</button>
            </div>

            <h2>Active sessions</h2>
            <p role="status">{message}</p>

            <Resource state={state}>{data => (
                <>
                    {!data.items.length && <p>No active sessions.</p>}
                    {data.items.map(item => (
                        <article className="staff-panel" key={item.id}>
                            <h3>{item.current ? "Current session" : "Other session"}</h3>
                            <Value value={{
                                Created: dateTime(item.createdAt, options.clinicTimeZone),
                                "Last seen": dateTime(item.lastSeenAt, options.clinicTimeZone),
                                "Absolute expiry": dateTime(item.expiresAt, options.clinicTimeZone)
                            }} />
                            <button onClick={() => setTarget(item)}>
                                Revoke {item.current ? "current session" : "session"}
                            </button>
                        </article>
                    ))}
                </>
            )}</Resource>

            {target && (
                <Confirm
                    title="Revoke staff session"
                    onCancel={() => setTarget(null)}
                    reload={state.reload}
                    onConfirm={async () => {
                        const result = await post("/sessions/revoke", { id: target.id });
                        if (target.current) endSession();
                        else {
                            setMessage(result.message);
                            state.reload();
                        }
                    }}
                >
                    <p>
                        {target.current
                            ? "This ends the staff session you are currently using."
                            : "The selected session will no longer be authorized."}
                    </p>
                </Confirm>
            )}
        </section>
    );
}

function StaffRoutes() {
    const { can } = useStaff();

    return (
        <Routes>
            <Route path="/staff" element={
                can("read")
                    ? <Queue key="queue" />
                    : <Navigate replace to={can("audit") ? "/staff/audit" : "/staff/account"} />
            } />
            <Route path="/staff/calendar" element={
                <Gate permission="read"><Queue key="calendar" calendar /></Gate>
            } />
            <Route path="/staff/requests/:ref" element={
                <Gate permission="read"><RequestDetail /></Gate>
            } />
            <Route path="/staff/patients" element={
                <Gate permission="patients"><Patients /></Gate>
            } />
            <Route path="/staff/availability" element={
                <Gate permission="availability"><Availability /></Gate>
            } />
            <Route path="/staff/audit" element={
                <Gate permission="audit"><Audit /></Gate>
            } />
            <Route path="/staff/access" element={
                <Gate permission="access"><LocalAccess /></Gate>
            } />
            <Route path="/staff/account" element={<><Account /><LocalAccount /></>} />
            <Route path="/staff/login" element={<Navigate replace to="/staff" />} />
            <Route path="*" element={
                <section>
                    <h1>Private page not found</h1>
                    <Link to="/staff">Return to staff workspace</Link>
                </section>
            } />
        </Routes>
    );
}

function Workspace({ session, endSession }) {
    const state = useResource("/options");
    const [logout, setLogout] = useState(false);

    const can = (permission, locationId, providerId) =>
        session.grants.some(g =>
            permissions[g.role]?.includes(permission) &&
            (
                locationId === undefined && providerId === undefined ||
                Number(g.locationId) === Number(locationId) &&
                Number(g.providerId) === Number(providerId)
            )
        );

    return (
        <Resource state={state}>{options => (
            <StaffContext.Provider value={{
                session, options, can, endSession,
                askLogout: () => setLogout(true),
                pairsFor: permission => options.pairs.filter(p =>
                    can(permission, p.locationId, p.providerId)
                )
            }}>
                <header className="staff-header">
                    <div>
                        <Link className="staff-brand" to="/staff">
                            {practice.name || "Practice"} <span>Staff</span>
                        </Link>
                        <p>{session.name} · Private workspace</p>
                    </div>
                    <button onClick={() => setLogout(true)}>Sign out</button>
                    <nav aria-label="Private staff navigation">
                        {[
                            ["read", "/staff", "Queue"],
                            ["read", "/staff/calendar", "Calendar"],
                            ["patients", "/staff/patients", "Patients"],
                            ["availability", "/staff/availability", "Availability"],
                            ["audit", "/staff/audit", "Audit"],
                            ["access", "/staff/access", "Access"],
                            [null, "/staff/account", "Account"]
                        ].filter(([permission]) => !permission || can(permission))
                            .map(([, path, label]) => (
                                <NavLink key={path} to={path} end={path === "/staff"}>
                                    {label}
                                </NavLink>
                            ))}
                    </nav>
                </header>

                <p className="staff-privacy-hint">
                    Switching away hides private records and may discard unsaved edits.
                    Do not use shared staff identities.
                </p>

                <StaffRoutes />

                {logout && (
                    <Confirm
                        title="Sign out of staff"
                        onCancel={() => setLogout(false)}
                        onConfirm={async () => {
                            await post("/auth/logout");
                            endSession();
                        }}
                    >
                        <p>
                            This ends this application’s staff session.
                            Patient sign-in is separate. The identity provider may retain its own session.
                        </p>
                    </Confirm>
                )}
            </StaffContext.Provider>
        )}</Resource>
    );
}

export default function StaffApp() {
    const location = useLocation();
    const main = useRef(null);
    const deadline = useRef(0);
    const timer = useRef(null);
    const active = useRef(false);
    const sessionRef = useRef(null);
    const sequence = useRef(0);

    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(true);
    const [shield, setShield] = useState(false);
    const [error, setError] = useState(null);
    const [message, setMessage] = useState("");

    const endSession = useCallback(() => {
        sequence.current += 1;
        window.clearTimeout(timer.current);
        deadline.current = 0;
        sessionRef.current = null;
        setStaffCsrf("");
        setSession(null);
        setError(null);
        setLoading(false);
        setShield(false);
        setMessage("Your staff session ended. Sign in again.");
    }, []);

    const checkSession = useCallback(async (touch = false, cover = false) => {
        const requestNumber = ++sequence.current;
        if (cover) setShield(true);
        setError(null);

        try {
            const data = await api(
                "/auth/session" + (touch ? "" : "?probe=1")
            );
            if (requestNumber !== sequence.current) return;

            setStaffCsrf(data.csrfToken);
            sessionRef.current = data;
            setSession(data);
            setLoading(false);
            setShield(false);
        } catch (failure) {
            if (failure.status === 401) {
                endSession();
            } else if (requestNumber === sequence.current) {
                setError(failure);
                setLoading(false);
                setShield(true);
            }
        }
    }, [endSession]);

    useEffect(() => {
        const clock = event => {
            const seconds = Number(event.detail?.seconds);
            if (!Number.isFinite(seconds)) return;

            window.clearTimeout(timer.current);
            deadline.current = performance.now() + Math.max(0, seconds) * 1000;
            timer.current = window.setTimeout(
                endSession, Math.max(0, seconds) * 1000
            );
        };

        const activity = () => { active.current = true; };

        const visibility = () => {
            if (!sessionRef.current?.configured) return;

            if (document.hidden) {
                setShield(true);
            } else if (deadline.current && performance.now() >= deadline.current) {
                endSession();
            } else {
                checkSession(false, true);
            }
        };

        window.addEventListener("staff-session-clock", clock);
        window.addEventListener("staff-session-ended", endSession);
        window.addEventListener("pointerdown", activity);
        window.addEventListener("keydown", activity);
        document.addEventListener("visibilitychange", visibility);

        checkSession(false, true);

        const interval = window.setInterval(() => {
            if (!sessionRef.current?.configured || document.hidden) return;
            const touch = active.current;
            active.current = false;
            checkSession(touch, false);
        }, 30000);

        return () => {
            sequence.current += 1;
            window.clearTimeout(timer.current);
            window.clearInterval(interval);
            window.removeEventListener("staff-session-clock", clock);
            window.removeEventListener("staff-session-ended", endSession);
            window.removeEventListener("pointerdown", activity);
            window.removeEventListener("keydown", activity);
            document.removeEventListener("visibilitychange", visibility);
            setStaffCsrf("");
        };
    }, [checkSession, endSession]);

    useEffect(() => {
        const oldTitle = document.title;
        document.querySelectorAll("[data-site-meta]").forEach(node => node.remove());

        const meta = document.createElement("meta");
        meta.name = "robots";
        meta.content = "noindex, nofollow, noarchive";
        document.head.appendChild(meta);
        document.title = "Private staff workspace";

        return () => {
            meta.remove();
            document.title = oldTitle;
        };
    }, []);

    useEffect(() => {
        main.current?.focus({ preventScroll: true });
        window.scrollTo({ top: 0, behavior: "instant" });
    }, [location.pathname, Boolean(session?.configured)]);

  let content;

    if (isLocalAuthPath(location.pathname)) {
    content = <LocalAuthPage
      key={location.pathname}
      signedIn={Boolean(session?.configured)}
      onLogin={async () => {
        setLoading(true);
        await checkSession(false, true);
      }}
    />;
  } else if (loading) {
        content = <p role="status">Checking staff access…</p>;
    } else if (error || shield) {
        content = (
            <section className="staff-login">
                <h1>Private workspace hidden</h1>
                <p>Verify the current staff session before returning to records.</p>
                <Problem error={error} />
                <button onClick={() => checkSession(false, true)}>Verify session / retry</button>
                <button onClick={endSession}>Clear this screen</button>
            </section>
        );
    } else if (session && !session.configured) {
        content = (
            <section className="staff-login">
                <h1>Staff access is not configured</h1>
                <p>Enable local staff access and create the first administrator before use.</p>
            </section>
        );
    } else if (!session) {
      content = <Navigate replace to="/staff/login" />;
    } else {
      content = <Workspace session={session} endSession={endSession} />;
    }

    return (
        <div className="staff">
            <a className="staff-skip" href="#staff-main">Skip to private content</a>
            <main id="staff-main" className="staff-main" tabIndex={-1} ref={main}>
                {content}
            </main>
        </div>
    );
}