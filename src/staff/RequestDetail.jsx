import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { post, params } from "./client.js";
import {
  useStaff, useResource, Resource, Confirm, Problem,
  MethodField, dateTime, recordUrl
} from "./ui.jsx";

export default function RequestDetail() {
  const { ref } = useParams();
  const state = useResource("/requests/" + encodeURIComponent(ref));
  const [message, setMessage] = useState("");

  return (
    <section>
      <p className="staff-eyebrow">Authorized record</p>
      <h1>Appointment / request detail</h1>
      <p role="status" aria-live="polite">{message}</p>
      <Resource state={state}>{data => (
        <Editor
          key={`${data.reference}:${data.version}`}
          data={data}
          reload={state.reload}
          saved={result => {
            setMessage(result.message || "Saved.");
            state.reload();
          }}
        />
      )}</Resource>
    </section>
  );
}

function Editor({ data: d, reload, saved }) {
  const { can, options, basePath } = useStaff();
  const [reason, setReason] = useState("");
  const [patientNote, setPatientNote] = useState("");
  const [date, setDate] = useState("");
  const [slot, setSlot] = useState("");
  const [confirm, setConfirm] = useState(null);
  const [patientReference, setPatientReference] = useState("");
  const [linkCode, setLinkCode] = useState(null);

  const decide = can("decide", d.locationId, d.providerId);
  const outcome = can("outcome", d.locationId, d.providerId);
  const zone = d.clinicTimeZone;

  const slots = useResource(decide && date ? "/slots?" + params({
    locationId: d.locationId, providerId: d.providerId,
    typeId: d.typeId, date
  }) : null);

  const show = (title, action, children, acknowledgement) =>
    setConfirm({ title, action, children, acknowledgement });

  async function perform(path, body) {
    const result = await post(path, {
      ...body, ...(!path.endsWith("/review-request") && reason ? { staffReason: reason } : {})
    });
    saved(result);
  }

  const action = (kind, title, explanation, disabled = false) => (
    <button
      key={kind}
      className={["cancel","decline","no_show"].includes(kind) ? "staff-button--danger" : ""}
      disabled={disabled}
      type="button"
      onClick={() => show(
        title,
        () => perform(`/requests/${d.reference}/action`, {
          action: kind, expectedVersion: d.version
        }),
        <p>{explanation}</p>
      )}
    >{title}</button>
  );

  return (
    <>
      <div className="staff-panel">
        <div className="staff-record-title">
          <span className="staff-status">{d.status}</span>
          <span>Version {d.version}</span>
        </div>
        <h2>{d.contact.name}</h2><p className="staff-reference">Request {d.reference}</p>
        <dl className="staff-facts">
          <div><dt>Starts</dt><dd>{dateTime(d.startsAt, zone)}</dd></div>
          <div><dt>Ends</dt><dd>{dateTime(d.endsAt, zone)}</dd></div>
          <div><dt>Clinic time zone</dt><dd>{zone}</dd></div>
          <div><dt>Contact name</dt><dd>{d.contact.name}</dd></div>
          <div><dt>Email</dt><dd>{d.contact.email}</dd></div>
          <div><dt>Reason for visit</dt><dd>{d.contact.reason || "Not provided"}</dd></div>
          <div><dt>Phone</dt><dd>{d.contact.phone || "Not provided"}</dd></div>
        </dl>

        {d.patientReference && can("patients", d.locationId, d.providerId) && (
          <Link to={basePath + "/patients?q=" + encodeURIComponent(d.patientReference)}>
            Open permitted patient summary
          </Link>
        )}
      </div>

      {Object.values(d.reschedule || {}).some(v => /^[a-f0-9]{32}$/.test(v || "")) && (
        <section className="staff-panel">
          <h2>Patient rescheduling links</h2>
          <ul>
            {Object.entries(d.reschedule).filter(([, value]) =>
              /^[a-f0-9]{32}$/.test(value || "")
            ).map(([key, value]) => (
              <li key={key}>
                {key}: <Link to={recordUrl(value, basePath)}>{value}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {can("review_invite", d.locationId, d.providerId) && <section className="staff-panel"><h2>Request patient feedback</h2><p>Send an optional review invitation after the visit. One invitation is allowed per appointment.</p>{d.reviewInvitation ? <p>Review email: {d.reviewInvitation.status}{d.reviewInvitation.sentAt ? " · " + dateTime(d.reviewInvitation.sentAt, zone) : ""}</p> : <button disabled={!(d.status === "completed" || (d.status === "approved" && new Date(d.endsAt) <= new Date()))} onClick={()=>show("Send review request",()=>perform("/requests/"+d.reference+"/review-request",{}),<p>Email a review link to {d.contact.email}?</p>)}>Send review request</button>}</section>}
      {can("access") && d.notifications?.length > 0 && <section className="staff-panel"><h2>Appointment email delivery</h2>{d.notifications.map((item,index)=><p key={index}>{item.event} · {item.recipient} · {item.status}</p>)}</section>}
      {(decide || outcome) && (
        <section className="staff-panel">
          <h2>Appointment status &amp; attendance</h2>{d.status === "approved" && <p className="staff-help">Completion is available after the scheduled end time; attendance can be recorded after the start time. Refresh the status if the appointment time has just passed.</p>}
          <label>
            Private administrative note — optional, not emailed
            <textarea
              maxLength={500} rows={3}
              value={reason} onChange={e => setReason(e.target.value)}
            />
          </label>
          <p className="staff-help">
            Do not enter a clinical narrative here. Patient-facing emails use
            separate neutral templates, not this note.
          </p>

          <div className="staff-actions">
            {decide && d.status === "pending" && (
              <>
                {action("approve", "Approve appointment", "This confirms the request. A patient-requested replacement also cancels its original in the same transaction.")}
                {action("decline", "Decline request", "This releases the declined request’s reservation. A declined replacement leaves its original unchanged.")}
              </>
            )}
            {decide && ["pending", "approved"].includes(d.status) &&
              action("cancel", "Cancel appointment/request", "This cancels the selected future reservation and any pending patient replacement attached to it.")}
            {outcome && d.status === "approved" && (
              <>
                {action("completed", "Mark completed", "Confirm this visit was completed. This status will appear in the patient portal.", !d.canComplete)}
                {action("no_show", "Patient did not attend", "Confirm the patient did not attend. This status will appear in the patient portal.", !d.canRecordNoShow)}
              </>
            )}
          </div>
          <button type="button" onClick={reload}>
            Reload current status
          </button>
        </section>
      )}

      {can("patient_notes", d.locationId, d.providerId) && <section className="staff-panel staff-shared-notes"><p className="staff-eyebrow">Shared with the patient</p><h2>Appointment notes for the patient</h2><p>These notes appear in the linked patient portal. Keep private administrative comments in the separate private notes field.</p>
        {["approved","completed","no_show"].includes(d.status) && <form onSubmit={event=>{
          event.preventDefault();
          show("Publish appointment note",async()=>{
            const result=await post("/requests/"+d.reference+"/patient-notes",{text:patientNote.trim(),expectedVersion:d.version});
            saved(result);
          },<><p>The patient will be able to read this note in their portal. Its text will not be included in email.</p><blockquote className="staff-note-preview">{patientNote}</blockquote></>);
        }}><label htmlFor="patient-appointment-note">Message or follow-up instructions for the patient<textarea id="patient-appointment-note" rows={5} required maxLength={3000} value={patientNote} onChange={event=>setPatientNote(event.target.value)} /></label><p className="staff-help">{patientNote.length}/3000 characters. Published notes are retained with the appointment.</p><button disabled={!patientNote.trim()}>Publish note to patient portal</button></form>}
        {(d.patientNotes || []).length ? <div className="staff-shared-note-list">{d.patientNotes.map((note,index)=><article key={index}><p className="staff-help">{note.author} · {dateTime(note.createdAt,zone)}</p><p className="staff-note-text">{note.text}</p></article>)}</div> : <p className="staff-help">No patient-visible notes have been published.</p>}
      </section>}

      <section className="staff-panel">
        <h2>Alternate-time suggestions</h2>
        <p>
          A suggestion is <strong>not a reservation</strong>.
          The original stays unchanged until staff records verified patient
          agreement and successfully accepts the new time.
          Acceptance rechecks availability; failure preserves the original.
        </p>

        {decide && ["pending", "approved"].includes(d.status) && (
          <form className="staff-grid" onSubmit={event => {
            event.preventDefault();
            show(
              "Send alternate-time suggestion",
              () => perform(`/requests/${d.reference}/propose`, {
                startsAt: slot, expectedVersion: d.version
              }),
              <p>
                Suggest {dateTime(slot, zone)}. This does not reserve that time
                or change the original appointment.
              </p>
            );
          }}>
            <label>
              Alternative date — clinic-local
              <input
                type="date" required min={options.minDate} max={options.maxDate}
                value={date} onChange={e => {
                  setDate(e.target.value);
                  setSlot("");
                }}
              />
            </label>
            <label>
              Currently available time
              <select
                required value={slot}
                disabled={!slots.data || slots.loading}
                onChange={e => setSlot(e.target.value)}
              >
                <option value="">Choose a time</option>
                {slots.data?.slots.map(item => (
                  <option key={item.startsAt} value={item.startsAt}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={!slot || slots.loading}>
              Propose alternate time
            </button>
            {slots.loading && <p role="status">Loading available times…</p>}
            <Problem error={slots.error} reload={slots.reload} />
            {slots.data && !slots.data.slots.length && <p>No available times on this date.</p>}
          </form>
        )}

        {!d.proposals.length && <p>No staff suggestions.</p>}

        {d.proposals.map(proposal => (
          <article className="staff-proposal" key={proposal.id}>
            <h3>{dateTime(proposal.startsAt, zone)}</h3>
            <p>Status: {proposal.status}</p>

            {proposal.replacementReference && (
              <Link to={recordUrl(proposal.replacementReference, basePath)}>
                Open replacement appointment
              </Link>
            )}

            {decide && proposal.status === "proposed" && (
              <div className="staff-actions">
                {["accept", "withdraw", "decline"].map(kind => (
                  <button type="button" key={kind} onClick={() => show(
                    `${kind} suggestion`,
                    values => perform(`/proposals/${proposal.id}/action`, {
                      action: kind,
                      expectedVersion: proposal.version,
                      originalExpectedVersion: d.version,
                      ...(kind === "accept" ? {
                        acceptanceConfirmed: true,
                        method: values.get("method")
                      } : {})
                    }),
                    kind === "accept" ? (
                      <>
                        <p>
                          Verify the patient using the practice’s approved process
                          and record explicit agreement to this exact time.
                          The change succeeds only if the target is still available.
                        </p>
                        <MethodField />
                      </>
                    ) : (
                      <p>This closes the suggestion without changing the original appointment.</p>
                    ),
                    kind === "accept"
                      ? "I independently verified contact and the patient explicitly agreed to this exact alternate time."
                      : undefined
                  )}>
                    {kind === "accept" ? "Accept agreed time" : kind}
                  </button>
                ))}
              </div>
            )}
          </article>
        ))}
      </section>

      {!d.patientReference && can("link", d.locationId, d.providerId) && (
        <section className="staff-panel">
          <h2>Link a verified guest request</h2>
          <p>
            Matching a name or email is not sufficient. The patient must supply
            their account reference through an independently verified process.
          </p>

          <label>
            Verified patient account reference
            <input
              maxLength={32} autoComplete="off"
              value={patientReference}
              onChange={e => {
                setPatientReference(e.target.value);
                setLinkCode(null);
              }}
            />
          </label>

          <button
            disabled={!/^[a-f0-9]{32}$/.test(patientReference)}
            onClick={() => show(
              "Authorize guest-request link",
              async values => {
                const result = await post("/guest-links", {
                  requestReference: d.reference,
                  patientReference,
                  identityVerificationConfirmed: true,
                  method: values.get("method")
                });
                setLinkCode(result);
              },
              <MethodField />,
              "I independently verified this patient and their relationship to this exact guest request."
            )}
          >Review link authorization</button>

          {linkCode && (
            <div className="staff-private-code" role="status">
              <label>
                Private one-time linking code
                <input
                  readOnly value={linkCode.code}
                  onFocus={e => e.target.select()}
                />
              </label>
              <p>Expires in {linkCode.expiresInMinutes} minutes. Deliver only through an approved private process.</p>
              <button type="button" onClick={() => setLinkCode(null)}>Dismiss code</button>
            </div>
          )}
        </section>
      )}

      <section className="staff-panel">
        <h2>Latest private administrative notes</h2>
        {!d.notes.length && <p>No notes.</p>}
        {d.notes.map((item, index) => (
          <article key={index}>
            <p className="staff-pre">{item.text}</p>
            <p className="staff-help">{item.actor} · {dateTime(item.createdAt, zone)}</p>
          </article>
        ))}
      </section>

      <section className="staff-panel">
        <h2>Latest record history</h2>
        {!d.history.length && <p>No recorded history.</p>}
        <ol>
          {d.history.map((item, index) => (
            <li key={index}>
              {item.event} · {item.actor} · {dateTime(item.createdAt, zone)}
            </li>
          ))}
        </ol>
      </section>

      {confirm && (
        <Confirm
          title={confirm.title}
          onCancel={() => setConfirm(null)}
          onConfirm={confirm.action}
          reload={reload}
          acknowledgement={confirm.acknowledgement}
        >
          {confirm.children}
        </Confirm>
      )}
    </>
  );
}