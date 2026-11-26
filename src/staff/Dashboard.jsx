import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useStaff, useResource, Resource, Value, AppointmentTable } from "./ui.jsx";
import { WorkspaceIcon } from "./WorkspaceShell.jsx";
import { practice } from "../content.js";

export function DashboardWelcome({session,basePath,onRefresh}) {
  return <div className="workspace-welcome"><div>
    <p className="staff-eyebrow">{basePath === "/admin" ? "Your practice at a glance" : "Your workday, organised"}</p>
    <h1>Welcome, {session.name}.</h1>
    <p className="staff-dashboard-copy">A clear view of your appointments, patients, and the little things that need your attention.</p>
    <div className="workspace-welcome-note"><WorkspaceIcon name="access"/><span>{basePath === "/admin" ? "Doctor & administrator workspace" : "Appointments & patient feedback"}</span></div>
  </div><button className="workspace-refresh" onClick={onRefresh}><WorkspaceIcon name="refresh"/>Refresh overview</button></div>;
}

export function DashboardMetrics({data,basePath}) {
  const metrics=[
    ["Pending requests",data.pending,"/appointments","appointments"],
    ["Approved today",data.today,"/calendar","calendar"],
    ["Upcoming reservations",data.upcoming,"/calendar","availability"],
    ["Reviews to check",data.reviews,"/reviews","reviews"],
    ...(data.patients !== null ? [["Verified patients",data.patients,"/patients","patients"]] : [])
  ];
  return <><div className="staff-metrics">{metrics.map(([label,value,path,icon]) =>
    <Link key={label} to={basePath+path}><span className="workspace-metric-icon"><WorkspaceIcon name={icon}/></span><span>{label}</span><strong>{value}</strong><span>View details <WorkspaceIcon name="arrow"/></span></Link>
  )}</div><p className="staff-help">Appointment dates follow {data.clinicTimeZone}. Pending requests expire at their start time if they have not been approved.</p></>;
}

export function PendingRequests({data,basePath}) {
  return <section className="staff-dashboard-pending"><div className="staff-section-heading"><div><p className="staff-eyebrow">Needs your attention</p><h2>Pending appointment requests</h2></div><Link to={basePath+"/appointments"}>View all pending requests →</Link></div><p className="staff-help">{data.total} pending across all dates. Showing up to 5, earliest appointment first.</p><AppointmentTable items={data.items.slice(0,5)} zone={data.clinicTimeZone}/></section>;
}

export function Dashboard() {
  const {basePath, can, session} = useStaff();
  const state = useResource("/dashboard");
  const pending = useResource("/requests?status=pending");
  useEffect(()=>{
    const timer=window.setInterval(()=>{if(!document.hidden){state.reload();pending.reload();}},30000);
    return ()=>window.clearInterval(timer);
  },[state.reload,pending.reload]);
  return <section className="workspace-dashboard">
    <DashboardWelcome session={session} basePath={basePath} onRefresh={()=>{state.reload();pending.reload();}}/>
    <Resource state={state}>{data=><DashboardMetrics data={data} basePath={basePath}/>}</Resource>
    <Resource state={pending}>{data=><PendingRequests data={data} basePath={basePath}/>}</Resource>
    <div className="staff-dashboard-actions"><Link to={basePath+"/appointments"}>Manage appointment requests →</Link><Link to={basePath+"/reviews"}>Review patient feedback →</Link>{can("access") && <Link to={basePath+"/access"}>Manage team access →</Link>}</div>
  </section>;
}

export function PatientDirectory() {
  const {basePath} = useStaff();
  const initial = new URLSearchParams(useLocation().search).get("q") || "";
  const [draft,setDraft] = useState(initial);
  const [q,setQ] = useState(initial);
  const [offset,setOffset] = useState(0);
  const [selected,setSelected] = useState("");
  const state = useResource("/directory?"+new URLSearchParams({q,offset}));
  const record = useResource(selected ? "/patients/"+selected : null);
  const medical = useResource(selected ? "/patients/"+selected+"/medical" : null);
  return <section><p className="staff-eyebrow">Doctor / administrator</p><h1>Patient directory</h1><p>Registered patient profiles, contact information, and appointment history.</p>
    <form className="staff-actions" onSubmit={e=>{e.preventDefault();setQ(draft.trim());setOffset(0);setSelected("");state.reload();}}><label>Search name, email, or reference<input value={draft} onChange={e=>setDraft(e.target.value)} maxLength={254}/></label><button>Search patients</button></form>
    <Resource state={state}>{data=><><div className="staff-directory">{data.items.map(item=><article className="staff-panel" key={item.reference}><h2>{item.displayName || "Patient account"}</h2><p>{item.email}</p><p className="staff-help">{item.disabled?"Disabled":item.verified?"Email verified":"Awaiting email verification"}</p>{item.verified && !item.disabled && <button onClick={()=>setSelected(item.reference)}>View patient details</button>}</article>)}</div>{!data.items.length && <p className="staff-empty">No matching patient accounts.</p>}{data.truncated && <p>Directory search is limited to the latest 10,000 accounts.</p>}<div className="staff-actions"><button disabled={!offset} onClick={()=>setOffset(x=>Math.max(0,x-50))}>Previous</button><span>Page {offset/50+1}</span><button disabled={data.nextOffset===null} onClick={()=>setOffset(data.nextOffset)}>Next</button></div></>}</Resource>
    {selected && <div className="staff-patient-detail"><button onClick={()=>setSelected("")}>Close patient details</button><Resource state={record}>{data=><section className="staff-panel"><h2>{data.patient.displayName || "Patient details"}</h2><Value value={data.patient.profile}/><h3>Appointment history</h3><AppointmentTable items={data.appointments} zone={data.clinicTimeZone}/></section>}</Resource><Resource state={medical}>{data=><section className="staff-panel"><h2>Patient-reported medical information</h2><Value value={data.details}/></section>}</Resource></div>}
  </section>;
}

export function PracticeDetails() {
  const {basePath} = useStaff();
  const state=useResource("/practice");
  return <section><p className="staff-eyebrow">Practice administration</p><h1>Doctor and practice</h1><div className="staff-panel"><h2>{practice.clinician}</h2><Value value={{Practice:practice.name,Specialty:practice.specialty,Phone:practice.phone,Email:practice.administrativeEmail,Address:practice.address,Hours:practice.hours}}/></div><Resource state={state}>{data=><div className="staff-panel"><h2>Booking configuration</h2><p>Appointments last {data.appointmentMinutes} minutes. Clinic time zone: {data.clinicTimeZone}.</p><Value value={data.providers}/><Link to={basePath+"/availability"}>Manage working hours and blocked dates →</Link></div>}</Resource></section>;
}
