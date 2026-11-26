import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {createServer} from "vite";
import React from "react";
import {renderToString} from "react-dom/server";
import {StaticRouter} from "react-router-dom/server.js";
import {staffPermissions,workspaceHome} from "../shared/staff-permissions.js";
const vite=await createServer({server:{middlewareMode:true},appType:"custom"});
try {
 const {StaffRoutes}=await vite.ssrLoadModule("/src/staff/StaffApp.jsx");
 const {StaffContext,AppointmentTable}=await vite.ssrLoadModule("/src/staff/ui.jsx");
 const options={clinicTimeZone:"America/Chicago",pairs:[],types:[],minDate:"2026-11-26",maxDate:"2026-12-26"};
 for(const [role,route,expected] of [
  ["administrator","/admin","Welcome"],["scheduler","/staff","Welcome"],
  ["administrator","/admin/patients","Patient directory"],
  ["administrator","/admin/practice","Doctor and practice"],
  ["administrator","/admin/access","Staff accounts"],["scheduler","/staff/reviews","Review moderation"],
  ["scheduler","/staff/patients","Access unavailable"],["scheduler","/staff/availability","Access unavailable"],
  ["scheduler","/admin/patients","Page unavailable"]
 ]) {
  const session={name:"Synthetic team member",grants:[{role,locationId:1,providerId:1}]};
  const value={session,options,basePath:workspaceHome(session),can:p=>staffPermissions[role].includes(p),pairsFor:()=>[],endSession:()=>{},askLogout:()=>{}};
  const html=renderToString(React.createElement(StaticRouter,{location:route},React.createElement(StaffContext.Provider,{value},React.createElement(StaffRoutes))));
  assert.ok(html.includes(expected),role+" "+route+" expected "+expected);
  if(role==="scheduler")assert.ok(!html.includes("Patient-reported medical information"));
  console.log("PASS "+role+" "+route);
 }
 const {LocalAuthPage}=await vite.ssrLoadModule("/src/staff/LocalAuth.jsx");
 for(const path of ["login","forgot-password","reset-password","activate","recover","verify-email"]) {
  const html=renderToString(React.createElement(StaticRouter,{location:"/staff/"+path},React.createElement(LocalAuthPage,{onLogin:async()=>{},signedIn:false})));
  assert.ok(html.includes("staff-auth-shell"));assert.ok(html.includes('id="staff-auth-title"'));
  if(path==="login"){assert.ok(html.includes('aria-label="Show password"'));assert.ok(html.includes('autoComplete="username"'));}
  if(["activate","reset-password","recover"].includes(path))assert.ok(html.includes("Confirm new password"));
  console.log("PASS shared team auth /staff/"+path);
 }
 const item={reference:"a".repeat(32),patient:{name:"Synthetic Patient",email:"synthetic-patient@example.test",phone:"+1 (432) 337-0555",reason:"Synthetic layout verification only. A longer visit reason checks wrapping in the appointment list."},startsAt:"2026-12-03T15:00:00Z",endsAt:"2026-12-03T15:30:00Z",status:"pending"};
 const table=renderToString(React.createElement(StaticRouter,{location:"/admin"},React.createElement(StaffContext.Provider,{value:{basePath:"/admin"}},React.createElement(AppointmentTable,{items:[item],zone:"America/Chicago"}))));
 assert.ok(table.includes("Synthetic Patient"));assert.ok(table.includes("synthetic-patient@example.test"));assert.ok(!table.includes("Location / provider"));assert.ok(table.includes("/admin/requests/"));
 console.log("PASS patient-first appointment table");
 const {default:WorkspaceShell}=await vite.ssrLoadModule("/src/staff/WorkspaceShell.jsx");
 const {DashboardWelcome,DashboardMetrics,PendingRequests}=await vite.ssrLoadModule("/src/staff/Dashboard.jsx");
 for(const role of ["administrator","scheduler"]) {
  const session={name:"Synthetic team member",grants:[{role,locationId:1,providerId:1}]};
  const basePath=workspaceHome(session);
  const value={session,options,basePath,can:p=>staffPermissions[role].includes(p),pairsFor:()=>[]};
  const summary={todayDate:"2026-11-26",pending:3,today:4,upcoming:7,reviews:2,patients:role==="administrator"?12:null,clinicTimeZone:"America/Chicago"};
  const dashboard=React.createElement("section",{className:"workspace-dashboard"},
    React.createElement(DashboardWelcome,{session,basePath,onRefresh:()=>{}}),
    React.createElement(DashboardMetrics,{data:summary,basePath}),
    React.createElement(PendingRequests,{data:{total:3,items:[item,{...item,reference:"b".repeat(32),patient:{...item.patient,name:"Synthetic Second Patient",reason:"Synthetic follow-up appointment."}}],clinicTimeZone:"America/Chicago"},basePath}));
  const html=renderToString(React.createElement(StaticRouter,{location:basePath},React.createElement(StaffContext.Provider,{value},React.createElement(WorkspaceShell,{onLogout:()=>{}},dashboard))));
  assert.ok(html.includes("workspace-sidebar"));assert.ok(html.includes(basePath+"/appointments"));
  assert.equal(html.includes(basePath+"/patients"),role==="administrator");
  assert.equal(html.includes(basePath+"/access"),role==="administrator");
  assert.ok(html.includes('aria-expanded="false"'));assert.ok(html.includes('aria-current="page"'));
  console.log("PASS "+role+" workspace navigation and dashboard");
  if(process.argv.includes("--preview")) {
    const css=(await fs.readdir("dist/assets")).find(name=>name.endsWith(".css"));
    await fs.writeFile("dist/"+(role==="administrator"?"admin":"staff")+"-layout-preview.html",`<!doctype html><html><head><meta charset="UTF-8"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/dist/assets/${css}"><title>Synthetic ${role} layout check</title></head><body><div class="staff staff--workspace"><main class="staff-main">${html}</main></div></body></html>`);
  }
 }

} finally {await vite.close();}
