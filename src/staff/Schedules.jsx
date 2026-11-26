import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { post, params } from "./client.js";
import {
  useStaff, useResource, Resource, Problem,
  PairSelect, pairKey, clinicDate, addDays,
  dateTime, recordUrl, AppointmentTable
} from "./ui.jsx";

const statuses = [
  "pending", "approved", "declined", "cancelled",
  "completed", "no_show", "expired"
];

export function Queue({ calendar = false }) {
  const { options, basePath } = useStaff();
  const zone = options.clinicTimeZone;
  const today = clinicDate(new Date(), zone);
  const search = new URLSearchParams(useLocation().search);
  const initial = {
    from: calendar ? today : search.get("from") || "",
    to: calendar ? addDays(today, 6) : search.get("to") || "",
    status: calendar ? "pending,approved" : search.get("status") || "pending",
    upcoming: !calendar && search.get("upcoming") === "1" ? "1" : "",
    locationId: "", providerId: "", q: ""
  };

  const [draft, setDraft] = useState(initial);
  const [filters, setFilters] = useState(initial);
  const [offsets, setOffsets] = useState([0]);
  const [error, setError] = useState(null);

  const state = useResource("/requests?" + params({
    ...filters, offset: offsets.at(-1)
  }));


  useEffect(() => {
    const timer = window.setInterval(()=>{if (!document.hidden) state.reload();},30000);
    return ()=>window.clearInterval(timer);
  },[state.reload]);

  function apply(next) {
    const value = calendar
      ? { ...next, to: addDays(next.from, 6) }
      : { ...next };

    if (JSON.stringify(value) === JSON.stringify(filters)) {
      state.reload();
    }
    setDraft(value);
    setFilters(value);
    setOffsets([0]);
    setError(null);
  }

  function change(key, value) {
    setDraft(current => ({
      ...current,
      [key]: value,
      ...(key === "locationId" ? { providerId: "" } : {}),
      ...(calendar && key === "from"
        ? { to: value ? addDays(value, 6) : "" }
        : {})
    }));
  }

  return (
    <section className="staff-queue">
      <p className="staff-eyebrow">Scheduling workspace</p>
      <h1>{calendar ? "Week calendar" : "Appointment request queue"}</h1>
      <p>
        Clinic time zone: <strong>{zone}</strong>.
        {calendar ? "Plan the week ahead." : "All dates are shown by default, including older pending requests."}
      </p>

      <form className="staff-grid staff-queue-filters" onSubmit={event => {
        event.preventDefault();
        if (
          draft.q &&
          !/^[a-f0-9]{32}$/.test(draft.q) &&
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.q)
        ) {
          setError(new Error(
            "Enter the full request reference or exact patient email."
          ));
          return;
        }
        if (!calendar && Boolean(draft.from) !== Boolean(draft.to)) {
          setError(new Error("Choose both dates or clear both to show all requests."));
          return;
        }
        apply(draft);
      }}>
        <label>
          {calendar ? "Week beginning" : "From"}
          <input type="date" required={calendar || Boolean(draft.to)} value={draft.from}
            onChange={e => change("from", e.target.value)} />
        </label>
        <label>
          Through
          <input type="date" required={calendar || Boolean(draft.from)} min={draft.from}
            readOnly={calendar} value={draft.to}
            onChange={e => change("to", e.target.value)} />
        </label>
        <label>
          Status
          <select value={draft.status}
            onChange={e => change("status", e.target.value)}>
            <option value="">All statuses</option>
            <option value="pending,approved">
              Reserved — pending and approved
            </option>
            {statuses.map(status => (
              <option key={status} value={status}>
                {status.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Exact reference / patient email
          <input type="search" autoComplete="off" maxLength={254}
            value={draft.q}
            onChange={e => change("q", e.target.value.trim())} />
        </label>
        <div className="staff-filter-buttons"><button>Apply filters</button><button type="button" onClick={()=>apply({from:calendar?today:"",to:calendar?addDays(today,6):"",status:calendar?"pending,approved":"pending",upcoming:"",locationId:"",providerId:"",q:""})}>Reset filters</button><button type="button" onClick={state.reload}>Refresh</button></div>
      </form>

      <Problem error={error} />
      <p>
        <Link to={calendar ? basePath + "/appointments" : basePath + "/calendar"}>
          {calendar ? "Open queue" : "Open calendar"}
        </Link>
      </p>

      <Resource state={state}>{data => (
        <>
          <p className="staff-help">
            {data.total} matching {data.total === 1 ? "appointment" : "appointments"} · {filters.from ? "Selected date range" : filters.upcoming ? "Upcoming only" : "All dates"}. Status counts below use the same date and search filters.
          </p>
          <div className="staff-counts">
            {Object.entries(data.counts).map(([status, count]) => (
              <button key={status} aria-pressed={filters.status === status}
                onClick={() => apply({ ...filters, status })}>
                <span>{status.replaceAll("_", " ")}</span>
                <strong>{count}</strong>
              </button>
            ))}
          </div>

          {calendar && (
            <>
              <div className="staff-actions">
                <button onClick={() => apply({
                  ...filters, from: addDays(filters.from, -7)
                })}>Previous week</button>
                <button onClick={() => apply({
                  ...filters, from: addDays(filters.from, 7)
                })}>Next week</button>
              </div>
              <p className="staff-help">
                Calendar and list show the same result page.
                Use pagination when more records exist.
              </p>
              <div className="staff-calendar">
                {Array.from({ length: 7 }, (_, n) =>
                  addDays(filters.from, n)
                ).map(day => {
                  const items = data.items.filter(item =>
                    clinicDate(item.startsAt, zone) === day
                  );
                  return (
                    <section key={day} aria-label={day}>
                      <h2>{day}</h2>
                      {!items.length && <p>No matches on this page.</p>}
                      {items.map(item => (
                        <Link className="staff-calendar-item"
                          key={item.reference}
                          to={recordUrl(item.reference, basePath)}>
                          <strong>{dateTime(item.startsAt, zone)}</strong>
                          <span>{item.status.replaceAll("_", " ")}</span>
                          <strong>{item.patient?.name || "Patient"}</strong>
                          <span>{item.patient?.phone || item.patient?.email}</span>
                        </Link>
                      ))}
                    </section>
                  );
                })}
              </div>
              <h2>Patient appointments</h2>
            </>
          )}

          <AppointmentTable items={data.items} zone={zone} />
          <div className="staff-actions">
            <button disabled={offsets.length === 1}
              onClick={() => setOffsets(value => value.slice(0, -1))}>
              Previous page
            </button>
            <span>Page {offsets.length}</span>
            <button disabled={data.nextOffset == null}
              onClick={() => setOffsets(value => [
                ...value, data.nextOffset
              ])}>
              Next page
            </button>
          </div>
        </>
      )}</Resource>
    </section>
  );
}

export function Availability() {
  const { options, pairsFor, basePath } = useStaff();
  const pairs = pairsFor("availability");
  const [pair, setPair] = useState(pairs[0] ? pairKey(pairs[0]) : "");
  const [from, setFrom] = useState(options.minDate);
  const [to, setTo] = useState(
    addDays(options.minDate, 29) < options.maxDate
      ? addDays(options.minDate, 29)
      : options.maxDate
  );
  const [message, setMessage] = useState("");

  const selected = pairs.find(p => pairKey(p) === pair);
  const scope = selected && from && to && from <= to ? {
    locationId: Number(selected.locationId),
    providerId: Number(selected.providerId), from, to
  } : null;

  const state = useResource(
    scope ? "/availability?" + params(scope) : null
  );

  return (
    <section>
      <p className="staff-eyebrow">Scheduling controls</p>
      <h1>Availability and closures</h1>
      <p>
        Weekly changes apply immediately. The date range controls
        date-specific overrides. Other locations and global closures
        remain unchanged. Existing appointments are never automatically
        cancelled or moved.
      </p>
      <div className="staff-grid">
        <PairSelect pairs={pairs} value={pair} onChange={setPair} />
        <label>
          Override range from
          <input type="date" required min={options.minDate}
            value={from} onChange={e => setFrom(e.target.value)} />
        </label>
        <label>
          Through
          <input type="date" required min={from}
            value={to} onChange={e => setTo(e.target.value)} />
        </label>
      </div>
      {!scope && <p role="alert">Choose a permitted pair and valid date range.</p>}
      <p role="status">{message}</p>
      <Resource state={state}>{data => (
        <AvailabilityEditor
          key={JSON.stringify(scope)}
          data={data} scope={scope} reload={state.reload}
          saved={text => {
            setMessage(text);
            state.reload();
          }}
        />
      )}</Resource>
    </section>
  );
}

function AvailabilityEditor({ data, scope, reload, saved }) {
  const { options, basePath } = useStaff();
  const [weekly, setWeekly] = useState(data.weekly);
  const [exceptions, setExceptions] = useState(data.exceptions);
  const [preview, setPreview] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const days = [
    [1, "Monday"], [2, "Tuesday"], [3, "Wednesday"],
    [4, "Thursday"], [5, "Friday"], [6, "Saturday"], [7, "Sunday"]
  ];

  function resetPreview() {
    setPreview(null);
    setAcknowledged(false);
  }

  function edit(kind, index, patch) {
    resetPreview();
    (kind === "weekly" ? setWeekly : setExceptions)(rows =>
      rows.map((row, n) => n === index ? { ...row, ...patch } : row)
    );
  }

  function remove(kind, index) {
    resetPreview();
    (kind === "weekly" ? setWeekly : setExceptions)(rows =>
      rows.filter((_, n) => n !== index)
    );
  }

  function add(kind) {
    resetPreview();
    (kind === "weekly" ? setWeekly : setExceptions)(rows => [
      ...rows,
      kind === "weekly"
        ? { weekday: 1, open: "", close: "" }
        : { date: scope.from, closed: true, open: null, close: null }
    ]);
  }

  async function makePreview(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    resetPreview();
    try {
      if (new Set(exceptions.map(item => item.date)).size !== exceptions.length) {
        throw new Error("Use only one override per date.");
      }
      setPreview(await post("/availability/preview", {
        ...scope,
        weekly: weekly.map(row => ({
          weekday: Number(row.weekday), open: row.open, close: row.close
        })),
        exceptions: exceptions.map(row => row.closed
          ? { date: row.date, closed: true }
          : {
            date: row.date, closed: false,
            open: row.open, close: row.close
          })
      }));
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  function timeFields(kind, row, index) {
    return (
      <>
        <label>
          Open
          <input type="time" required disabled={Boolean(row.closed)}
            value={row.open || ""}
            onChange={e => edit(kind, index, { open: e.target.value })} />
        </label>
        <label>
          Close
          <input type="time" required disabled={Boolean(row.closed)}
            value={row.close || ""}
            onChange={e => edit(kind, index, { close: e.target.value })} />
        </label>
        <button type="button" onClick={() => remove(kind, index)}>
          Remove row {index + 1}
        </button>
      </>
    );
  }

  return (
    <>
      <form onSubmit={makePreview}>
        <fieldset disabled={busy}>
          <legend>Recurring weekly intervals</legend>
          <p className="staff-help">
            No rows for a weekday means no recurring availability.
            Overnight intervals are not supported.
          </p>
          {weekly.map((row, index) => (
            <div className="staff-edit-row" key={index}>
              <label>
                Weekday
                <select value={row.weekday}
                  onChange={e => edit("weekly", index, {
                    weekday: Number(e.target.value)
                  })}>
                  {days.map(([number, name]) => (
                    <option key={number} value={number}>{name}</option>
                  ))}
                </select>
              </label>
              {timeFields("weekly", row, index)}
            </div>
          ))}
          <button type="button" onClick={() => add("weekly")}>
            Add weekly interval
          </button>
        </fieldset>

        <fieldset disabled={busy}>
          <legend>Date-specific overrides</legend>
          <p className="staff-help">
            One opening interval or closure per date.
            Only this pair’s overrides inside {scope.from} through{" "}
            {scope.to} are replaced.
          </p>
          {exceptions.map((row, index) => (
            <div className="staff-edit-row" key={index}>
              <label>
                Date
                <input type="date" required
                  min={scope.from} max={scope.to} value={row.date}
                  onChange={e => edit("exceptions", index, {
                    date: e.target.value
                  })} />
              </label>
              <label className="staff-check">
                <input type="checkbox" checked={Boolean(row.closed)}
                  onChange={e => edit("exceptions", index, {
                    closed: e.target.checked
                  })} />
                Closed
              </label>
              {timeFields("exceptions", row, index)}
            </div>
          ))}
          <button type="button" onClick={() => add("exceptions")}>
            Add date override
          </button>
        </fieldset>

        <button disabled={busy}>
          {busy ? "Preparing preview…" : "Preview changes"}
        </button>
      </form>

      <Problem error={error} reload={reload} />

      {preview && (
        <section className="staff-panel">
          <h2>Review scheduling impact</h2>
          <p>
            Preview expires{" "}
            {dateTime(preview.expiresAt, options.clinicTimeZone)}.
            New bookings or schedule changes invalidate it.
          </p>

          {!preview.conflicts.length
            ? <p>No existing reservation conflicts were found.</p>
            : (
              <ul>
                {preview.conflicts.map(item => (
                  <li key={item.reference}>
                    <Link to={recordUrl(item.reference, basePath)}>
                      {item.reference}
                    </Link>
                    {" · "}{item.status}
                    {" · "}{dateTime(item.startsAt, options.clinicTimeZone)}
                    {" – "}{dateTime(item.endsAt, options.clinicTimeZone)}
                  </li>
                ))}
              </ul>
            )}

          <form onSubmit={async event => {
            event.preventDefault();
            if (busy || !acknowledged) return;
            setBusy(true);
            setError(null);
            try {
              const result = await post("/availability/save", {
                previewId: preview.previewId,
                acknowledgeConflicts: true
              });
              saved(result.message);
            } catch (failure) {
              setError(failure);
            } finally {
              setBusy(false);
            }
          }}>
            <fieldset disabled={busy}>
              <legend>Confirm reviewed impact</legend>
              <label className="staff-check">
                <input type="checkbox" required checked={acknowledged}
                  onChange={e => setAcknowledged(e.target.checked)} />
                <span>
                  I reviewed the changes and conflicts. Saving changes
                  availability only; existing appointments remain unchanged.
                </span>
              </label>
              <button disabled={!acknowledged || busy}>
                {busy ? "Saving…" : "Save reviewed availability"}
              </button>
            </fieldset>
          </form>
        </section>
      )}
    </>
  );
}