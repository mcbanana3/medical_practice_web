import { useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { practice } from "../content.js";
import { useStaff } from "./ui.jsx";

export function WorkspaceIcon({ name = "dashboard" }) {
  const paths = {
    dashboard:<><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    appointments:<><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 11h16m-12 4h3m-3 3h6"/></>,
    calendar:<><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2m-8 3h2"/></>,
    patients:<><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-16a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 4v2"/></>,
    availability:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    practice:<><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M12 7v6m-3-3h6m-6 11v-4h6v4"/></>,
    audit:<><path d="M5 4h14v17H5zM9 3v3h6V3M8 10h8m-8 4h8m-8 4h5"/></>,
    access:<><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/></>,
    reviews:<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>,
    account:<><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>,
    arrow:<path d="M5 12h14m-5-5 5 5-5 5"/>,
    refresh:<><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/></>,
    logout:<><path d="M9 4H4v16h5m5-13 5 5-5 5m-5-5h10"/></>,
    info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/></>,
    menu:<path d="M4 6h16M4 12h16M4 18h16"/>
  };
  return <svg className="workspace-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.dashboard}</svg>;
}

export default function WorkspaceShell({children,onLogout}) {
  const {session,basePath,can,options} = useStaff();
  const {pathname} = useLocation();
  const [expanded,setExpanded] = useState(false);
  const admin=basePath === "/admin";
  const links=[
    [null,"","Overview","dashboard"],
    ["read","/appointments","Appointments","appointments"],
    ["read","/calendar","Calendar","calendar"],
    ["access","/patients","Patients","patients"],
    ["reviews_moderate","/reviews","Reviews","reviews"],
    ["availability","/availability","Availability","availability"],
    ["settings","/practice","Practice","practice"],
    ["access","/access","Team access","access"],
    ["audit","/audit","Activity","audit"],
    [null,"/account","My account","account"]
  ].filter(([permission])=>!permission||can(permission));
  const active=links.find(([,path])=>path && pathname.startsWith(basePath+path));
  const title=pathname.includes("/requests/")?"Appointment details":active?.[2] || "Overview";
  const initials=(session.name || "Team").trim().split(/\s+/).slice(0,2).map(part=>part[0]).join("");
  return <div className={"staff-workspace"+(expanded?" staff-workspace--nav-open":"")}>
    <aside className="workspace-sidebar"><div className="workspace-brand-row"><Link className="workspace-brand" to={basePath}><img className="workspace-practice-logo" src="/favicon.svg" alt="" aria-hidden="true" width="46" height="46"/><span>Harika Thummala<small>Internal Medicine</small></span></Link><button className="workspace-nav-toggle" aria-label={expanded?"Close navigation":"Open navigation"} aria-expanded={expanded} aria-controls="workspace-navigation" onClick={()=>setExpanded(value=>!value)}><WorkspaceIcon name="menu"/></button></div>
      <div className="workspace-role"><span/>{admin?"Doctor & administrator":"Practice staff"}</div>
      <nav id="workspace-navigation" className="workspace-nav" aria-label={admin?"Admin navigation":"Staff navigation"}><p>WORKSPACE</p>{links.map(([,path,label,icon])=><NavLink key={label} to={basePath+path} end={!path} onClick={()=>setExpanded(false)}><WorkspaceIcon name={icon}/><span>{label}</span><span className="workspace-nav-dot" aria-hidden="true"/></NavLink>)}</nav>
      <div className="workspace-sidebar-footer"><WorkspaceIcon name="access"/><div><strong>Private practice workspace</strong><p>Use your own team account.</p><Link to="/">View practice website ↗</Link></div></div>
    </aside>
    <div className="workspace-body"><header className="workspace-topbar"><div className="workspace-breadcrumb"><span>{admin?"Admin portal":"Staff portal"}</span><span aria-hidden="true">/</span><strong>{title}</strong></div><div className="workspace-user"><span className="workspace-user-avatar" aria-hidden="true">{initials}</span><div><strong>{session.name}</strong><small>{admin?"Administrator":"Practice team"}</small></div><button className="workspace-signout" onClick={onLogout} aria-label="Sign out"><WorkspaceIcon name="logout"/><span>Sign out</span></button></div></header>
      <div className="workspace-content">{children}<footer className="workspace-footer"><span>{practice.name}</span><span>Clinic time · {options?.clinicTimeZone || practice.timeZone}</span></footer></div>
    </div>
  </div>;
}
