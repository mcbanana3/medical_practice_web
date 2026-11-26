import {
  createContext, useCallback, useContext,
  useEffect, useId, useRef, useState
} from "react";
import { Link } from "react-router-dom";
import { api } from "./client.js";

export const StaffContext = createContext(null);
export const useStaff = () => useContext(StaffContext);

export { staffPermissions as permissions } from "../../shared/staff-permissions.js";

export const pairKey = p => `${p.locationId}:${p.providerId}`;
export const recordUrl = (id, basePath = "/staff") => `${basePath}/requests/${encodeURIComponent(id)}`;

export function dateTime(value, zone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone, dateStyle: "medium", timeStyle: "short"
  }).format(new Date(value));
}

export function clinicDate(value, zone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date(value));

  return ["year", "month", "day"]
    .map(key => parts.find(p => p.type === key).value)
    .join("-");
}

export function addDays(date, count) {
  return new Date(
    Date.parse(date + "T12:00:00Z") + count * 86400000
  ).toISOString().slice(0, 10);
}

export function useResource(path) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({
    path: null, loading: Boolean(path), data: null, error: null
  });

  const reload = useCallback(() => setRevision(n => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();

    setState({
      path, loading: Boolean(path), data: null, error: null
    });

    if (path) {
      api(path, { signal: controller.signal })
        .then(data => {
          if (!controller.signal.aborted) {
            setState({ path, loading: false, data, error: null });
          }
        })
        .catch(error => {
          if (!controller.signal.aborted) {
            setState({ path, loading: false, data: null, error });
          }
        });
    }

    return () => controller.abort();
  }, [path, revision]);

  return {
    ...(state.path === path ? state : {
      loading: Boolean(path), data: null, error: null
    }),
    reload
  };
}

export function Problem({ error, reload }) {
  const ref = useRef(null);

  useEffect(() => {
    if (error) ref.current?.focus();
  }, [error]);

  if (!error) return null;

  return (
    <div className="staff-error" role="alert" tabIndex={-1} ref={ref}>
      <strong>
        {error.status === 409 ? "The record or availability changed." : "Please check"}
      </strong>
      <p>{error.message}</p>
      {reload && (
        <button type="button" onClick={reload}>
          Reload latest data — discards unsaved edits
        </button>
      )}
    </div>
  );
}

export function Resource({ state, children }) {
  if (state.loading) {
    return (
      <div className="staff-loading" role="status">
        <span aria-hidden="true" />
        Loading authorized information…
      </div>
    );
  }

  if (state.error) {
    return (
      <>
        <Problem error={state.error} reload={state.reload} />
        <button type="button" onClick={state.reload}>Retry</button>
      </>
    );
  }

  return state.data ? children(state.data) : null;
}

export function Confirm({
  title, children, onConfirm, onCancel, reload,
  acknowledgement = "I reviewed the consequences and confirm this action."
}) {
  const dialog = useRef(null);
  const titleId = useId();
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={event => {
        event.preventDefault();
        if (!sending.current) onCancel();
      }}
    >
      <form onSubmit={async event => {
        event.preventDefault();
        if (sending.current) return;
        const form = new FormData(event.currentTarget);
        sending.current = true;
        setBusy(true);
        setError(null);

        try {
          await onConfirm(form);
          onCancel();
        } catch (failure) {
          setError(failure);
        } finally {
          sending.current = false;
          setBusy(false);
        }
      }}>
        <h2 id={titleId}>{title}</h2>
        {children}
        <label className="staff-check">
          <input type="checkbox" required disabled={busy} />
          <span>{acknowledgement}</span>
        </label>
        <Problem error={error} reload={reload && (() => {
          onCancel();
          reload();
        })} />
        <div className="staff-actions">
          <button disabled={busy}>
            {busy ? "Working…" : "Confirm"}
          </button>
          <button type="button" disabled={busy} onClick={onCancel}>
            Go back
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function MethodField() {
  return (
    <label>
      Independently verified contact method
      <select name="method" required defaultValue="">
        <option value="" disabled>Choose method</option>
        <option value="phone">Phone</option>
        <option value="in_person">In person</option>
        <option value="verified_message">Verified message</option>
      </select>
    </label>
  );
}

export function PairSelect({ pairs, value, onChange, label = "Location / provider" }) {
  return (
    <label>
      {label}
      <select value={value} required onChange={e => onChange(e.target.value)}>
        <option value="">Choose a permitted pair</option>
        {pairs.map(p => (
          <option key={pairKey(p)} value={pairKey(p)}>
            {p.location} / {p.provider}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AppointmentTable({ items, zone }) {
  const { basePath } = useStaff();
  if (!items.length) return <div className="staff-empty"><strong>No appointments match these filters.</strong><p>Try resetting the filters or choosing a different status.</p></div>;
  return <div className="staff-table staff-patient-table" tabIndex={0} aria-label="Patient appointments; scroll horizontally if necessary">
    <table role="table"><caption>Patient appointments · {zone}</caption>
      <thead role="rowgroup"><tr role="row"><th scope="col">Patient & contact</th><th scope="col">Appointment</th><th scope="col">Visit details</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead>
      <tbody role="rowgroup">{items.map(item => <tr role="row" key={item.reference}>
        <td role="cell" data-label="Patient"><div className="staff-patient-cell"><span className="staff-patient-avatar" aria-hidden="true">{(item.patient?.name || "P").trim().split(/\s+/).slice(0,2).map(part=>part[0]).join("")}</span><div><Link className="staff-patient-name" to={recordUrl(item.reference,basePath)}>{item.patient?.name || "Patient"}</Link><span className="staff-patient-contact">{item.patient?.email || "Email not recorded"}</span><span className="staff-patient-contact">{item.patient?.phone || "Phone not recorded"}</span></div></div></td>
        <td role="cell" data-label="Appointment"><strong>{dateTime(item.startsAt,zone)}</strong><span className="staff-patient-contact">Until {new Intl.DateTimeFormat("en-US",{timeZone:zone,hour:"numeric",minute:"2-digit"}).format(new Date(item.endsAt))} · {Math.round((new Date(item.endsAt)-new Date(item.startsAt))/60000)} minutes</span></td>
        <td role="cell" data-label="Visit details"><p className="staff-visit-reason">{item.patient?.reason || "Reason not recorded"}</p><span className="staff-patient-contact">Reference: {item.reference.slice(0,8)}</span></td>
        <td role="cell" data-label="Status"><span className={"staff-status staff-status--"+item.status}>{item.status.replaceAll("_"," ")}</span></td>
        <td role="cell" data-label="Action"><Link className="staff-open-request" to={recordUrl(item.reference,basePath)}>View request →</Link></td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function Value({ value }) {
  if (value == null || value === "") return "Not recorded";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value !== "object") return String(value);

  return (
    <dl className="staff-facts">
      {Object.entries(value).map(([key, item]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd><Value value={item} /></dd>
        </div>
      ))}
    </dl>
  );
}