import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { post, publicPost, params } from "./client.js";
import {
  useStaff, useResource, Resource, Problem, PairSelect, pairKey, Confirm, Value
} from "./ui.jsx";

const authPaths = new Set([
  "/staff/login", "/staff/forgot-password", "/staff/reset-password",
  "/staff/activate", "/staff/recover", "/staff/verify-email"
]);
export const isLocalAuthPath = path => authPaths.has(path);

function Password({ name = "password", label = "New password", current = false }) {
  return (
    <label>
      {label}
      <input
        name={name} type="password" required
        minLength={current ? undefined : 8}
        maxLength={current ? 1024 : 256}
        autoComplete={current ? "current-password" : "new-password"}
      />
    </label>
  );
}

export function LocalAuthPage({ onLogin, signedIn }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const tokenRef = useRef(null);
  if (tokenRef.current === null) {
    tokenRef.current = new URLSearchParams(window.location.hash.slice(1))
      .get("token") || "";
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState("");
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(
        window.history.state, "", window.location.pathname + window.location.search
      );
    }
  }, []);
  useEffect(() => {
    if (pathname === "/staff/login" && signedIn) navigate("/staff", { replace: true });
  }, [pathname, signedIn, navigate]);

  const mode = pathname.split("/").at(-1);
  const titles = {
    login: "Staff sign in",
    "forgot-password": "Reset your password",
    "reset-password": "Choose a new password",
    activate: "Set up your staff password",
    recover: "Use an offline recovery code",
    "verify-email": "Verify your new email"
  };
  const endpoint = {
    login: "/auth/login",
    "forgot-password": "/auth/forgot",
    "reset-password": "/auth/reset",
    activate: "/auth/activate",
    recover: "/auth/recover",
    "verify-email": "/auth/verify-email"
  }[mode];
  const needsToken = ["reset-password", "activate", "verify-email"].includes(mode);
  const changesPassword = ["reset-password", "activate", "recover"].includes(mode);

  return (
    <section className="staff-login">
      <p className="staff-eyebrow">Private staff access</p>
      <h1>{titles[mode]}</h1>
      {mode === "login" && <p>Use your staff email and password. Patient accounts are separate.</p>}
      {mode === "forgot-password" && <p>Enter your staff email to request a single-use reset link.</p>}
      {mode === "recover" && (
        <p>Use one of your saved offline codes. Successful recovery revokes all old codes and sessions.</p>
      )}
      {needsToken && !tokenRef.current && (
        <p role="alert">Open the complete link from your email. Reloading after the link is opened removes its token from this screen.</p>
      )}
      <Problem error={error} />
      <p role="status">{message}</p>

      {!finished && (
        <form aria-busy={busy} onSubmit={async event => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = Object.fromEntries(new FormData(form));
          if (changesPassword && data.password !== data.confirmation) {
            setError(new Error("The two passwords do not match."));
            return;
          }
          delete data.confirmation;
          if (needsToken) data.token = tokenRef.current;
          setBusy(true);
          setError(null);
          try {
            const result = await publicPost(endpoint, data);
            form.reset();
            if (mode === "login") {
              await onLogin();
              navigate("/staff", { replace: true });
            } else {
              tokenRef.current = "";
              setFinished(true);
              setMessage(result.message);
            }
          } catch (failure) {
            setError(failure);
            form.querySelectorAll('input[type="password"]').forEach(input => {
              input.value = "";
            });
          } finally {
            setBusy(false);
          }
        }}>
          <fieldset disabled={busy || (needsToken && !tokenRef.current)}>
            <legend>Account verification</legend>
            {["login", "forgot-password", "recover"].includes(mode) && (
              <label>
                Staff email
                <input name="email" type="email" required maxLength={254}
                  autoComplete={mode === "login" ? "username" : "email"} />
              </label>
            )}
            {mode === "login" && <Password current label="Password" />}
            {mode === "recover" && (
              <label>
                Backup recovery code
                <input name="code" required maxLength={100} autoComplete="off" spellCheck={false} />
              </label>
            )}
            {changesPassword && (
              <>
                <Password />
                <Password name="confirmation" label="Confirm new password" />
                <p className="staff-help">Use 8–128 characters. A longer, unique password is recommended.</p>
              </>
            )}
            <button>
              {busy ? "Working…" : mode === "login" ? "Sign in"
                : mode === "forgot-password" ? "Send reset instructions"
                  : mode === "verify-email" ? "Verify email" : "Save password"}
            </button>
          </fieldset>
        </form>
      )}

      <div className="staff-actions">
        {mode !== "login" && <Link to="/staff/login">Back to sign in</Link>}
        {mode === "login" && <Link to="/staff/forgot-password">Forgot password?</Link>}
        {["login", "forgot-password"].includes(mode) && (
          <Link to="/staff/recover">Use a backup code</Link>
        )}
      </div>
      <p className="staff-help">There is no public staff registration.</p>
    </section>
  );
}

function MutationForm({ title, path, children, button, confirmPassword, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState("");

  return (
    <form className="staff-panel" aria-busy={busy} onSubmit={async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const body = Object.fromEntries(new FormData(form));
      if (confirmPassword && body.password !== body.confirmation) {
        setError(new Error("The two passwords do not match."));
        return;
      }
      delete body.confirmation;
      setBusy(true);
      setError(null);
      setMessage("");
      try {
        const result = await post(path, body);
        form.reset();
        setMessage(result.message || "Saved.");
        onDone?.(result);
      } catch (failure) {
        setError(failure);
        form.querySelectorAll('input[type="password"]').forEach(input => {
          input.value = "";
        });
      } finally {
        setBusy(false);
      }
    }}>
      <h2>{title}</h2>
      <Problem error={error} />
      <p role="status">{message}</p>
      <fieldset disabled={busy}>
        <legend>{title}</legend>
        {children}
        <button>{busy ? "Working…" : button || "Save"}</button>
      </fieldset>
    </form>
  );
}

export function LocalAccount() {
  const state = useResource("/account");
  const [codes, setCodes] = useState([]);

  return (
    <section>
      <Resource state={state}>{data => (
        <div className="staff-panel">
          <h2>Local staff profile</h2>
          <Value value={{
            Name: data.displayName, Email: data.email,
            "Doctor designation": data.isDoctor ? "Assigned" : "Not assigned"
          }} />
        </div>
      )}</Resource>

      <MutationForm title="Confirm identity" path="/auth/reauth"
        button="Confirm for sensitive changes">
        <p>Required before access-management changes if your last password confirmation was over five minutes ago.</p>
        <Password current name="currentPassword" label="Current password" />
      </MutationForm>

      <MutationForm title="Edit your display name" path="/account/name"
        onDone={() => state.reload()}>
        <label>
          Display name
          <input name="displayName" required maxLength={100} autoComplete="name" />
        </label>
      </MutationForm>

      <MutationForm title="Change password" path="/auth/change-password"
        confirmPassword button="Change password and sign out">
        <Password current name="currentPassword" label="Current password" />
        <Password />
        <Password name="confirmation" label="Confirm new password" />
        <p>All sessions and existing backup codes will be revoked.</p>
      </MutationForm>

      <MutationForm title="Change sign-in email" path="/auth/change-email">
        <Password current name="currentPassword" label="Current password" />
        <label>
          New email
          <input name="email" type="email" required maxLength={254} autoComplete="email" />
        </label>
        <p>The old address remains active until the new address is verified.</p>
      </MutationForm>

      <MutationForm title="Replace backup recovery codes" path="/auth/recovery-codes"
        button="Generate new backup codes"
        onDone={result => setCodes(result.codes || [])}>
        <Password current name="currentPassword" label="Current password" />
        <p>This immediately invalidates your previous backup codes.</p>
      </MutationForm>

      {codes.length > 0 && (
        <section className="staff-private-code" aria-label="New backup recovery codes">
          <h2>Save these codes offline now</h2>
          <p>They are shown only in this response. Hiding or leaving this screen removes them from view.</p>
          <ol>{codes.map(code => (
            <li key={code} style={{ overflowWrap: "anywhere" }}><code>{code}</code></li>
          ))}</ol>
          <button onClick={() => setCodes([])}>Hide codes</button>
        </section>
      )}
    </section>
  );
}

export function LocalAccess() {
  const { pairsFor, session, endSession } = useStaff();
  const pairs = pairsFor("access");
  const [pair, setPair] = useState(pairs[0] ? pairKey(pairs[0]) : "");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const state = useResource("/access" + (query ? "?" + params({ q: query }) : ""));
  const [selectedId, setSelectedId] = useState("");
  const [editName, setEditName] = useState("");
  const [editRoles, setEditRoles] = useState([]);
  const [inviteRoles, setInviteRoles] = useState(["scheduler"]);
  const [pending, setPending] = useState(null);
  const [message, setMessage] = useState("");
  const selected = state.data?.items.find(item => item.subject === selectedId);
  const selectedPair = pairs.find(p => pairKey(p) === pair);

  useEffect(() => {
    setEditName(selected?.displayName || "");
    setEditRoles(selected?.grants.filter(g =>
      pairKey(g) === pair
    ).map(g => g.role) || []);
  }, [selectedId, pair, state.data]);

  function roleFields(value, update) {
    return (
      <fieldset>
        <legend>Roles for the selected resource pair</legend>
        {["scheduler", "clinician", "administrator", "auditor"].map(role => (
          <label className="staff-check" key={role}>
            <input type="checkbox" checked={value.includes(role)}
              onChange={event => update(current => event.target.checked
                ? [...current, role] : current.filter(item => item !== role))} />
            <span>{role}</span>
          </label>
        ))}
      </fieldset>
    );
  }

  function review(path, body, title) {
    setPending({ path, body, title });
  }

  return (
    <section>
      <p className="staff-eyebrow">Explicit staff access</p>
      <h1>Staff accounts</h1>
      <p>
        Accounts use local passwords. Disable access instead of deleting audit history.
        Administrator access does not automatically grant medical access.
      </p>
      <p>
        <Link to="/staff/account">Confirm your password in Account</Link>
        {" "}before sensitive changes.
      </p>
      <p role="status">{message}</p>
      <PairSelect pairs={pairs} value={pair} onChange={setPair} />

      <form className="staff-actions" onSubmit={event => {
        event.preventDefault();
        if (query === search.trim()) state.reload();
        else setQuery(search.trim());
      }}>
        <label>
          Exact staff email — optional
          <input type="email" value={search} maxLength={254}
            onChange={e => setSearch(e.target.value)} />
        </label>
        <button>Filter staff</button>
        <button type="button" onClick={() => {
          setSearch(""); setQuery(""); setSelectedId("");
          state.reload();
        }}>Clear</button>
      </form>

      <Resource state={state}>{data => (
        <>
          {data.truncated && <p role="status">Only the first 200 matching accounts are shown. Filter by exact email.</p>}
          {!data.items.length && <p>No accounts are visible within your access scope.</p>}
          {data.items.map(item => (
            <article className="staff-panel" key={item.subject}>
              <h2>{item.displayName}</h2>
              <p>{item.email}</p>
              <p>
                {item.enabled ? "Enabled" : "Disabled"}
                {" · "}{item.pending ? "Password setup pending" : "Password configured"}
                {item.isDoctor ? " · Doctor designation" : ""}
              </p>
              <ul>{item.grants.map(g => (
                <li key={pairKey(g) + g.role}>
                  Location {g.locationId}, provider {g.providerId}: {g.role}
                </li>
              ))}</ul>
              <div className="staff-actions">
                <button disabled={!item.manageable}
                  onClick={() => setSelectedId(item.subject)}>Edit profile / grants</button>
                <button disabled={!item.manageable} onClick={() => review(
                  "/access/" + (item.enabled ? "disable" : "enable"),
                  { subject: item.subject }, item.enabled ? "Disable staff access" : "Enable staff access"
                )}>{item.enabled ? "Disable" : "Enable"}</button>
                <button disabled={!item.manageable || !item.enabled} onClick={() => review(
                  "/access/" + (item.pending ? "resend" : "reset"),
                  { subject: item.subject }, item.pending ? "Resend setup invitation" : "Send password reset"
                )}>{item.pending ? "Resend setup" : "Send reset"}</button>
              </div>
              {!item.manageable && (
                <p className="staff-help">This account also has resource ownership outside your management scope.</p>
              )}
            </article>
          ))}
        </>
      )}</Resource>

      {selected?.manageable && selectedPair && (
        <form className="staff-panel" onSubmit={event => {
          event.preventDefault();
          review("/access", {
            subject: selected.subject, displayName: editName,
            locationId: Number(selectedPair.locationId),
            providerId: Number(selectedPair.providerId),
            roles: [...editRoles]
          }, "Replace resource-pair grants");
        }}>
          <h2>Edit {selected.email}</h2>
          <label>
            Display name
            <input required maxLength={100} value={editName}
              onChange={e => setEditName(e.target.value)} />
          </label>
          {roleFields(editRoles, setEditRoles)}
          <p>No checked roles removes this pair grant. Other pair grants remain unchanged.</p>
          <p>Changes revoke the target’s sessions and backup codes.</p>
          <button>Review changes</button>
        </form>
      )}

      {selectedPair && (
        <form className="staff-panel" onSubmit={event => {
          event.preventDefault();
          if (!inviteRoles.length) return;
          const body = Object.fromEntries(new FormData(event.currentTarget));
          review("/access/invite", {
            ...body,
            locationId: Number(selectedPair.locationId),
            providerId: Number(selectedPair.providerId),
            roles: [...inviteRoles]
          }, "Create staff invitation");
        }}>
          <h2>Invite staff</h2>
          <label>Display name<input name="displayName" required maxLength={100} /></label>
          <label>Email<input name="email" type="email" required maxLength={254} /></label>
          {roleFields(inviteRoles, setInviteRoles)}
          <p>The staff member sets their own password using a single-use email link.</p>
          <p>The server rejects capabilities you are not authorized to grant.</p>
          <button disabled={!inviteRoles.length}>Review invitation</button>
        </form>
      )}

      {pending && (
        <Confirm title={pending.title}
          acknowledgement="I reviewed the selected identity, permissions, and account impact."
          reload={state.reload}
          onCancel={() => setPending(null)}
          onConfirm={async () => {
            const result = await post(pending.path, {
              ...pending.body, impactConfirmed: true
            });
            setMessage(result.message);
            state.reload();
            if (result.signedOut || (
              pending.body.subject === session.subject &&
              ["/access", "/access/disable", "/access/enable"].includes(pending.path)
            )) endSession();
          }}>
          <Value value={{
            Action: pending.title,
            Account: pending.body.email ||
              state.data?.items.find(i => i.subject === pending.body.subject)?.email,
            Name: pending.body.displayName,
            Roles: pending.body.roles,
            Location: pending.body.locationId,
            Provider: pending.body.providerId
          }} />
          <p>Account access and notification changes are committed together. Email is delivered afterward.</p>
        </Confirm>
      )}
    </section>
  );
}