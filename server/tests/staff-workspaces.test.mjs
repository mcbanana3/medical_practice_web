import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {once} from "node:events";
import {randomUUID} from "node:crypto";
import {config} from "../src/config.mjs";
import {pool,query,encrypt,newId,digest,decrypt} from "../src/db.mjs";
import {createApplication} from "../src/application.mjs";
import {hashPassword} from "../src/staff/passwords.mjs";
import {S,emailHash} from "../src/staff/auth.mjs";
import {expireHolds} from "../src/requests.mjs";
import {workspaceHome} from "../../shared/staff-permissions.js";

import {DateTime} from "luxon";

const suffix=randomUUID();
const password="Synthetic-test-password-496!";
const identities=["administrator","scheduler"].map(role=>({role,subject:"workspace-test:"+role+":"+suffix,email:role+"."+suffix+"@example.test"}));
const requestId=newId(),futureId=newId(),patientId=newId(),reviewId=newId(),pastPendingId=newId(),distantPendingId=newId(),attendanceId=newId();
let server,base;
class Client {
  cookies=new Map(); csrf="";
  async call(path,body) {
    const r=await fetch(base+"/api/staff"+path,{method:body===undefined?"GET":"POST",headers:{Origin:config.origin,Cookie:[...this.cookies].map(([k,v])=>k+"="+v).join("; "),"Content-Type":"application/json","X-Staff-CSRF":this.csrf},...(body===undefined?{}:{body:JSON.stringify(body)})});
    for(const raw of r.headers.getSetCookie()) {const pair=raw.split(";")[0]; const at=pair.indexOf("=");this.cookies.set(pair.slice(0,at),pair.slice(at+1));}
    const data=await r.json();if(data.csrfToken)this.csrf=data.csrfToken;return {status:r.status,data};
  }
  async login(identity) {
    const boot=await this.call("/auth/bootstrap");assert.equal(boot.status,200);
    assert.equal((await this.call("/auth/login",{email:identity.email,password,loginToken:boot.data.loginToken})).status,200);
    const session=await this.call("/auth/session");assert.equal(session.status,200);return session.data;
  }
}
before(async()=>{
  assert.equal(config.environment,"test");assert.ok(config.db.database.endsWith("_test"));assert.equal(S.enabled,true);
  await query("DELETE FROM rate_buckets");
  const hash=await hashPassword(password);
  for(const item of identities) {
    await query("INSERT INTO staff_users VALUES(?,?,?,1,1,UTC_TIMESTAMP(3))",[item.subject,S.issuer,"Synthetic "+item.role]);
    await query("INSERT INTO staff_local_credentials VALUES(?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[item.subject,emailHash(item.email),encrypt({email:item.email}),hash,item.role==="administrator"?1:0]);
    await query("INSERT INTO staff_grants VALUES(?,1,1,?)",[item.subject,item.role]);
  }
  await query("INSERT INTO patient_accounts(id,email_hash,profile_enc,email_verified_at,created_at) VALUES(?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[patientId,digest("synthetic:"+patientId),encrypt({displayName:"Synthetic unbooked patient",email:"synthetic-patient@example.test"})]);
  await query("INSERT INTO patient_details VALUES(?,?,1,UTC_TIMESTAMP(3))",[patientId,encrypt({phone:"+14323370555",medicalHistory:"Synthetic private medical information"})]);
  for(const [id,status,offset] of [[requestId,"completed",-2],[futureId,"pending",7],[pastPendingId,"pending",-45],[distantPendingId,"pending",60],[attendanceId,"approved",-1]]) {
    const start=new Date(Date.now()+offset*86400000),end=new Date(start.getTime()+1800000);
    await query("INSERT INTO appointment_requests(id,idempotency_key,payload_hash,location_id,provider_id,type_id,starts_at,ends_at,contact_enc,status,version,receipt_json,created_at) VALUES(?,?,?,1,1,1,?,?,?,?,1,?,UTC_TIMESTAMP(3))",[id,randomUUID(),digest(id),start,end,encrypt({name:"Synthetic guest",email:"review-recipient@example.test",phone:"+14323370555",reason:"Synthetic appointment reason"}),status,JSON.stringify({reference:id})]);
  }
  await query("INSERT INTO public_review_submissions(id,submission_key,payload_hash,location_id,provider_id,status,version,submission_enc,publication_consent,withdraw_hash,created_at,updated_at) VALUES(?,?,?,1,1,'pending',1,?,1,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[reviewId,newId()+newId(),digest(reviewId),encrypt({displayName:"Synthetic moderation test",text:"Synthetic feedback for automated permission testing.",rating:4}),newId()+newId()]);
  server=createApplication({captchaVerifier:async()=>{}}).listen(0);await once(server,"listening");base="http://127.0.0.1:"+server.address().port;
});
after(async()=>{
  if(server)await new Promise(resolve=>server.close(resolve));
  await query("DELETE FROM communications_outbox WHERE dedup_key=?",[digest("staff-message:review-request:"+requestId)]);
  await query("DELETE FROM patient_reschedules WHERE patient_id=?",[patientId]);
  await query("DELETE FROM patient_request_links WHERE patient_id=?",[patientId]);
  for(const id of [requestId,futureId,pastPendingId,distantPendingId,attendanceId]) {await query("DELETE FROM appointment_patient_notes WHERE request_id=?",[id]);await query("DELETE FROM audit_events WHERE request_id=?",[id]);await query("DELETE FROM notification_outbox WHERE request_id=?",[id]);await query("DELETE FROM appointment_requests WHERE id=?",[id]);}
  await query("DELETE FROM patient_details WHERE patient_id=?",[patientId]);await query("DELETE FROM patient_accounts WHERE id=?",[patientId]);
  await query("DELETE FROM public_review_submissions WHERE id=?",[reviewId]);
  for(const item of identities) {
    await query("DELETE FROM audit_events WHERE actor=?",[item.subject]);
    await query("DELETE FROM staff_sessions WHERE subject=?",[item.subject]);await query("DELETE FROM staff_grants WHERE subject=?",[item.subject]);
    await query("DELETE FROM staff_local_credentials WHERE subject=?",[item.subject]);await query("DELETE FROM staff_users WHERE subject=?",[item.subject]);
  }
  await pool.end();
});
test("shared login returns saved roles; anonymous and staff access cannot reach admin data",async()=>{
  const anonymous=new Client();assert.equal((await anonymous.call("/directory")).status,401);
  const staff=new Client();const session=await staff.login(identities[1]);assert.equal(workspaceHome(session),"/staff");
  for(const path of ["/directory","/practice","/access","/patients/"+patientId,"/patients/"+patientId+"/medical","/audit","/availability?locationId=1&providerId=1&from=2026-11-26&to=2026-11-27"]) assert.equal((await staff.call(path)).status,403,path);
  assert.equal((await staff.call("/dashboard")).status,200);
  assert.equal((await staff.call("/reviews")).status,200);
  assert.equal((await staff.call("/requests/"+futureId+"/action",{action:"approve",expectedVersion:1})).status,200);
  assert.equal((await staff.call("/requests/"+requestId+"/action",{action:"no_show",expectedVersion:1})).status,409);
  assert.equal((await staff.call("/access/invite",{email:"blocked@example.test",displayName:"Blocked",locationId:1,providerId:1,roles:["administrator"],impactConfirmed:true})).status,403);
});
test("administrator sees unbooked patient profiles and medical data",async()=>{
  const admin=new Client();const session=await admin.login(identities[0]);assert.equal(workspaceHome(session),"/admin");
  const all=await admin.call("/directory");assert.equal(all.status,200);assert.ok(all.data.items.some(item=>item.reference===patientId));
  const name=await admin.call("/directory?q=Synthetic%20unbooked");assert.equal(name.status,200);assert.ok(name.data.items.some(item=>item.reference===patientId));
  const directory=await admin.call("/directory?q="+patientId);assert.equal(directory.status,200);assert.equal(directory.data.items[0].reference,patientId);
  const profile=await admin.call("/patients/"+patientId);assert.equal(profile.status,200);assert.equal(profile.data.patient.profile.phone,"+14323370555");
  const medical=await admin.call("/patients/"+patientId+"/medical");assert.equal(medical.status,200);assert.equal(medical.data.details.medicalHistory,"Synthetic private medical information");
  assert.equal((await admin.call("/practice")).status,200);
});
test("review requests are post-visit, persistent and deduplicated",async()=>{
  const staff=new Client();await staff.login(identities[1]);
  assert.equal((await staff.call("/requests/"+futureId+"/review-request",{})).status,400);
  assert.equal((await staff.call("/requests/"+requestId+"/review-request",{})).status,200);
  assert.equal((await staff.call("/requests/"+requestId+"/review-request",{})).status,200);
  const rows=await query("SELECT payload_enc FROM communications_outbox WHERE dedup_key=?",[digest("staff-message:review-request:"+requestId)]);
  assert.equal(rows.length,1);const message=decrypt(rows[0].payload_enc);
  assert.equal(message.to,"review-recipient@example.test");assert.ok(message.text.includes("/reviews#share-review"));assert.ok(!message.text.includes("Synthetic appointment reason"));
  const detail=await staff.call("/requests/"+requestId);assert.equal(detail.data.reviewInvitation.status,"pending");assert.deepEqual(detail.data.notifications,[]);
});

test("staff can approve, hide and reject feedback without access-management privileges",async()=>{
  const staff=new Client();await staff.login(identities[1]);
  const checks={authenticityConfirmed:true,permissionConfirmed:true,privacyChecked:true,neutralModerationConfirmed:true};
  assert.equal((await staff.call("/reviews/"+reviewId+"/action",{action:"approve",expectedVersion:1,...checks})).status,200);
  assert.equal((await staff.call("/reviews/"+reviewId+"/action",{action:"hide",expectedVersion:2,reason:"Synthetic moderation check"})).status,200);
  assert.equal((await staff.call("/reviews/"+reviewId+"/action",{action:"reject",expectedVersion:3,reason:"Synthetic moderation check"})).status,200);
  assert.equal((await staff.call("/access")).status,403);
});

test("dashboard pending totals and the unfiltered queue agree across past and distant dates",async()=>{
  for(const identity of identities) {
    const client=new Client();await client.login(identity);
    const dashboard=await client.call("/dashboard");
    const all=await client.call("/requests?status=pending");
    assert.equal(all.status,200);assert.equal(all.data.total,dashboard.data.pending);
    for(const id of [pastPendingId,distantPendingId]) {
      const row=all.data.items.find(item=>item.reference===id);assert.ok(row,"all-dates pending queue includes "+id);
      assert.equal(row.patient.name,"Synthetic guest");assert.equal(row.patient.email,"review-recipient@example.test");
      assert.equal(row.patient.phone,"+14323370555");assert.equal(row.patient.reason,"Synthetic appointment reason");
      assert.equal(Object.hasOwn(row,"contact_enc"),false);
    }
    const today=DateTime.now().setZone(config.zone);
    const range=await client.call("/requests?status=pending&from="+today.toISODate()+"&to="+today.plus({days:29}).toISODate());
    assert.equal(range.status,200);assert.ok(!range.data.items.some(item=>[pastPendingId,distantPendingId].includes(item.reference)));
    const exact=await client.call("/requests?status=pending&q="+pastPendingId);assert.equal(exact.data.total,1);
    assert.equal((await client.call("/requests?from="+today.toISODate())).status,400);
  }
});

test("staff publish patient-visible notes and record completion or nonattendance",async()=>{
  const staff=new Client();await staff.login(identities[1]);
  const before=(await staff.call("/requests/"+futureId)).data;
  assert.equal(before.canComplete,false);
  assert.equal((await staff.call("/requests/"+futureId+"/action",{action:"completed",expectedVersion:before.version})).status,409);
  const text="Synthetic patient instructions.\nPlease contact the care team for follow-up.";
  assert.equal((await staff.call("/requests/"+futureId+"/patient-notes",{text,expectedVersion:before.version})).status,200);
  assert.equal((await staff.call("/requests/"+futureId+"/patient-notes",{text,expectedVersion:before.version})).status,409);
  const notes=(await staff.call("/requests/"+futureId)).data;
  assert.equal(notes.patientNotes[0].text,text);
  const [stored]=await query("SELECT note_enc FROM appointment_patient_notes WHERE request_id=?",[futureId]);assert.ok(!stored.note_enc.includes("Synthetic patient instructions"));
  const [mail]=await query("SELECT payload_enc FROM notification_outbox WHERE request_id=? AND event_type LIKE 'note_added:%' LIMIT 1",[futureId]);assert.ok(!JSON.stringify(decrypt(mail.payload_enc)).includes(text));
  await query("UPDATE appointment_requests SET starts_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 60 MINUTE),ends_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 30 MINUTE) WHERE id=?",[futureId]);
  const ready=(await staff.call("/requests/"+futureId)).data;assert.equal(ready.canComplete,true);
  assert.equal((await staff.call("/requests/"+futureId+"/action",{action:"completed",expectedVersion:ready.version})).status,200);
  const attendance=(await staff.call("/requests/"+attendanceId)).data;
  assert.equal((await staff.call("/requests/"+attendanceId+"/action",{action:"no_show",expectedVersion:attendance.version})).status,200);
});
test("past pending requests expire once; future pending and approved outcomes are preserved",async()=>{
  await Promise.all([expireHolds(),expireHolds()]);await expireHolds();
  const [past]=await query("SELECT status FROM appointment_requests WHERE id=?",[pastPendingId]);assert.equal(past.status,"expired");
  const [future]=await query("SELECT status FROM appointment_requests WHERE id=?",[distantPendingId]);assert.equal(future.status,"pending");
  const [done]=await query("SELECT status FROM appointment_requests WHERE id=?",[futureId]);assert.equal(done.status,"completed");
  const events=await query("SELECT id FROM notification_outbox WHERE request_id=? AND event_type LIKE 'expired:%'",[pastPendingId]);assert.equal(events.length,2);
  const audits=await query("SELECT id FROM audit_events WHERE request_id=? AND event='request.expired'",[pastPendingId]);assert.equal(audits.length,1);
});

test("replacement expiry preserves its approved original, cancellation remains independent, and original expiry closes the replacement",async()=>{
  for(const id of [attendanceId,distantPendingId]) await query("INSERT INTO patient_request_links VALUES(?,?,UTC_TIMESTAMP(3))",[id,patientId]);
  await query("UPDATE appointment_requests SET status='approved',version=version+1,starts_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 3 DAY),ends_at=DATE_ADD(DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 3 DAY),INTERVAL 30 MINUTE) WHERE id=?",[attendanceId]);
  await query("UPDATE appointment_requests SET starts_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE),ends_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 29 MINUTE) WHERE id=?",[distantPendingId]);
  await query("INSERT INTO patient_reschedules(replacement_id,original_id,patient_id,state,created_at) VALUES(?,?,?,'pending',UTC_TIMESTAMP(3))",[distantPendingId,attendanceId,patientId]);
  await expireHolds();
  let [original]=await query("SELECT * FROM appointment_requests WHERE id=?",[attendanceId]);assert.equal(original.status,"approved");
  let [relation]=await query("SELECT state FROM patient_reschedules WHERE replacement_id=?",[distantPendingId]);assert.equal(relation.state,"expired");
  await query("UPDATE appointment_requests SET status='pending',version=version+1,starts_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 7 DAY),ends_at=DATE_ADD(DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 7 DAY),INTERVAL 30 MINUTE) WHERE id=?",[distantPendingId]);
  await query("UPDATE patient_reschedules SET state='pending' WHERE replacement_id=?",[distantPendingId]);
  const staff=new Client();await staff.login(identities[1]);
  const replacement=(await staff.call("/requests/"+distantPendingId)).data;
  assert.equal((await staff.call("/requests/"+distantPendingId+"/action",{action:"cancel",expectedVersion:replacement.version})).status,200);
  [original]=await query("SELECT status FROM appointment_requests WHERE id=?",[attendanceId]);assert.equal(original.status,"approved");
  await query("UPDATE appointment_requests SET status='pending',version=version+1,starts_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE),ends_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 29 MINUTE) WHERE id=?",[attendanceId]);
  await query("UPDATE appointment_requests SET status='pending',version=version+1 WHERE id=?",[distantPendingId]);
  await query("UPDATE patient_reschedules SET state='pending' WHERE replacement_id=?",[distantPendingId]);
  await expireHolds();
  for(const id of [attendanceId,distantPendingId]) {const [row]=await query("SELECT status FROM appointment_requests WHERE id=?",[id]);assert.equal(row.status,"expired");}
  [relation]=await query("SELECT state FROM patient_reschedules WHERE replacement_id=?",[distantPendingId]);assert.equal(relation.state,"expired");
});
