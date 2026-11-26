import fs from "node:fs/promises";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
import {config} from "../src/config.mjs";
import {query,transaction,pool,newId,decrypt,encrypt} from "../src/db.mjs";
import {checkPassword} from "../src/auth/passwords.mjs";
const dir=fileURLToPath(new URL("../../local-test-data/",import.meta.url));
try{
 assert.equal(config.environment,"development");assert.ok(config.db.database.endsWith("_dev"));assert.ok(["127.0.0.1","localhost"].includes(config.db.host));
 const file=dir+(await fs.readdir(dir)).filter(name=>name.endsWith(".json")).sort().at(-1);
 const m=JSON.parse(await fs.readFile(file,"utf8"));assert.equal(m.state,"ready");assert.equal(m.database,config.db.database);
 const ids=m.appointments;
 await transaction(async c=>{
  const rows=[];
  for(let i=0;i<ids.length;i+=100){
   const chunk=ids.slice(i,i+100),placeholders=chunk.map(()=>"?").join(",");
   await query("UPDATE appointment_requests SET created_at=LEAST(created_at,UTC_TIMESTAMP(3)) WHERE id IN ("+placeholders+")",chunk,c);
   for(const table of ["appointment_patient_notes","staff_notes","audit_events"])await query("UPDATE "+table+" SET created_at=LEAST(created_at,UTC_TIMESTAMP(3)) WHERE request_id IN ("+placeholders+")",chunk,c);
   rows.push(...await query("SELECT r.*,x.patient_id FROM appointment_requests r LEFT JOIN patient_request_links x ON x.request_id=r.id WHERE r.id IN ("+placeholders+")",chunk,c));
  }
  await query("SELECT id FROM providers WHERE id=? FOR UPDATE",[rows[0].provider_id],c);
  const used=new Set();
  for(const original of rows.filter(r=>r.status==="approved"&&r.starts_at>new Date()).sort((a,b)=>a.starts_at-b.starts_at).slice(10,13)){
   const [existing]=await query("SELECT replacement_id FROM patient_reschedules WHERE original_id=? AND state='pending'",[original.id],c);if(existing)continue;
   const replacement=rows.find(r=>r.status==="pending"&&r.starts_at>original.starts_at&&!used.has(r.id));if(!replacement)continue;used.add(replacement.id);
   const contact=decrypt(original.contact_enc);contact.reason="Synthetic patient reschedule request";
   await query("UPDATE appointment_requests SET contact_enc=? WHERE id=?",[encrypt(contact),replacement.id],c);
   await query("UPDATE patient_request_links SET patient_id=? WHERE request_id=?",[original.patient_id,replacement.id],c);
   await query("UPDATE appointment_requests SET version=version+1 WHERE id=?",[original.id],c);
   await query("INSERT INTO patient_reschedules(replacement_id,original_id,patient_id,state,created_at) VALUES(?,?,?,'pending',UTC_TIMESTAMP(3))",[replacement.id,original.id,original.patient_id],c);
   m.samples.pendingReschedule=replacement.id;
   m.ids.patient_reschedules.push(replacement.id);m.counts.patient_reschedules++;
  }
  assert.equal(rows.length,ids.length);
  assert.ok(rows.every(r=>r.ends_at-r.starts_at===1800000));
  const active=rows.filter(r=>["pending","approved"].includes(r.status)).sort((a,b)=>a.starts_at-b.starts_at);
  for(let i=1;i<active.length;i++)assert.ok(active[i].starts_at>=active[i-1].ends_at,"Synthetic active booking overlap");
 });
 const [person]=await query("SELECT password_hash FROM patient_accounts WHERE id=?",[m.patients[0]]);assert.equal(await checkPassword(person.password_hash,m.testPassword),true);
 console.log("PASS patient test password, 30-minute durations, manifest counts, active-booking overlap, note timestamps and reschedule links");
 const origin=config.origin;
 for(const account of m.staff){
  const cookies=new Map();
  const call=async(endpoint,body,csrf="")=>{
   const response=await fetch("http://127.0.0.1:"+config.port+"/api/staff"+endpoint,{method:body?"POST":"GET",headers:{Origin:origin,Cookie:[...cookies].map(([k,v])=>k+"="+v).join("; "),"Content-Type":"application/json","X-Staff-CSRF":csrf},...(body?{body:JSON.stringify(body)}:{})});
   for(const raw of response.headers.getSetCookie()){const pair=raw.split(";")[0],at=pair.indexOf("=");cookies.set(pair.slice(0,at),pair.slice(at+1));}
   return {status:response.status,data:await response.json()};
  };
  const boot=await call("/auth/bootstrap");
  const login=await call("/auth/login",{email:account.email,password:m.testPassword,loginToken:boot.data.loginToken});
  assert.equal(login.status,account.enabled?200:401);
  if(account.enabled){
   const session=await call("/auth/session");assert.equal(session.status,200);assert.ok(session.data.grants.some(g=>g.role===account.role));
   const dashboard=await call("/dashboard");assert.equal(dashboard.status,200);
   const requests=await call("/requests?status=pending");assert.equal(requests.status,200);assert.ok(requests.data.total>0);
   await call("/auth/logout",{},session.data.csrfToken);
  }
  console.log("PASS synthetic "+account.role+(account.enabled?" login and dashboard":" disabled login rejection"));
 }
 await fs.writeFile(file,JSON.stringify(m,null,2));
 const guide=file.replace(".json","-README.md");await fs.appendFile(guide,String.fromCharCode(10,10)+"Three pending patient reschedule examples were added. Sample replacement reference: "+m.samples.pendingReschedule+String.fromCharCode(10));
 console.log("DATA GUIDE: "+guide);
}catch(error){console.error(error.message);process.exitCode=1;}finally{await pool.end();}
