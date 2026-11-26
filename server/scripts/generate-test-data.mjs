import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {randomBytes,randomInt,randomUUID} from "node:crypto";
import {DateTime} from "luxon";
import {config} from "../src/config.mjs";
import {query,transaction,pool,newId,encrypt,digest} from "../src/db.mjs";
import {hashPassword as patientHash} from "../src/auth/passwords.mjs";
import {hashPassword as staffHash} from "../src/staff/passwords.mjs";
import {S,emailHash} from "../src/staff/auth.mjs";
import {bookingOptions,slotsFor,databaseNow} from "../src/scheduling.mjs";
const directory=fileURLToPath(new URL("../../local-test-data/",import.meta.url));
const args=process.argv.slice(2);
const columns={
 patient_accounts:["id","email_hash","profile_enc","password_hash","email_verified_at","disabled_at","auth_version","created_at"],
 patient_details:["patient_id","details_enc","version","updated_at"],
 staff_users:["subject","issuer","display_name","enabled","auth_version","created_at"],
 staff_local_credentials:["subject","email_hash","email_enc","password_hash","is_doctor","created_at","updated_at"],
 staff_grants:["subject","location_id","provider_id","role"],
 staff_scopes:["subject","location_id","provider_id","can_decide","revoked_at"],
 appointment_requests:["id","idempotency_key","payload_hash","location_id","provider_id","type_id","starts_at","ends_at","contact_enc","status","expires_at","version","receipt_json","created_at"],
 patient_request_links:["request_id","patient_id","linked_at"],
 patient_reschedules:["replacement_id","original_id","patient_id","state","created_at"],
 staff_proposals:["id","original_id","starts_at","ends_at","original_version","status","version","replacement_id","created_by","created_at","updated_at"],
 appointment_patient_notes:["id","request_id","author","note_enc","created_at"],
 staff_notes:["id","request_id","actor","note_enc","created_at"],
 public_review_submissions:["id","submission_key","payload_hash","location_id","provider_id","status","version","submission_enc","publication_consent","withdraw_hash","public_json","checks_json","internal_note_enc","moderated_by","approved_at","created_at","updated_at"],
 notification_outbox:["id","request_id","event_type","recipient_type","payload_enc","status","attempts","next_attempt_at","last_error_code","sent_at"],
 patient_mail_outbox:["id","payload_enc","status","attempts","next_attempt_at","last_error_code","sent_at"],
 communications_outbox:["id","dedup_key","payload_enc","status","attempts","next_attempt_at","last_error_code","sent_at","created_at"]
};
const data=Object.fromEntries(Object.keys(columns).map(table=>[table,[]]));
const add=(table,row)=>data[table].push(row);
function count(flag,fallback,max){const i=args.indexOf(flag);if(i<0)return fallback;const n=Number(args[i+1]);if(!Number.isInteger(n)||n<10||n>max)throw new Error("Invalid "+flag);return n;}
async function bulk(c,table,rows){
 for(let i=0;i<rows.length;i+=100){const batch=rows.slice(i,i+100);await query("INSERT INTO "+table+" ("+columns[table].join(",")+") VALUES "+batch.map(row=>"("+row.map(()=>"?").join(",")+")").join(","),batch.flat(),c);}
}
async function remove(file){
 const target=path.resolve(file);if(!target.startsWith(path.resolve(directory)+path.sep))throw new Error("Manifest must be inside local-test-data.");
 const m=JSON.parse(await fs.readFile(target,"utf8"));
 if(m.kind!=="synthetic-practice-dataset-v1"||m.database!==config.db.database||!m.batch.startsWith("synthetic-"))throw new Error("Wrong manifest or database.");
 await transaction(async c=>{
  const del=async(table,column,ids)=>{for(let i=0;i<ids.length;i+=100){const chunk=ids.slice(i,i+100);await query("DELETE FROM "+table+" WHERE "+column+" IN ("+chunk.map(()=>"?").join(",")+")",chunk,c);}};
  for(const table of ["notification_outbox","appointment_patient_notes","staff_notes","staff_proposals","patient_reschedules","patient_request_links"])await del(table,table==="staff_proposals"?"original_id":table==="patient_reschedules"?"original_id":"request_id",m.appointments);
  await del("audit_events","request_id",m.appointments);await del("appointment_requests","id",m.appointments);
  await del("public_review_submissions","id",m.reviews);
  for(const table of ["patient_sessions","patient_auth_tokens","patient_guest_link_codes","patient_details"])await del(table,"patient_id",m.patients);
  await del("patient_accounts","id",m.patients);
  for(const table of ["patient_mail_outbox","communications_outbox"])await del(table,"id",m.ids[table]);
  const subjects=m.staff.map(s=>s.subject);await del("audit_events","actor",subjects);
  for(const table of ["staff_sessions","staff_local_tokens","staff_local_recovery","staff_scopes","staff_grants","staff_local_credentials","staff_users"])await del(table,"subject",subjects);
 });
 m.state="removed";await fs.writeFile(target,JSON.stringify(m,null,2));console.log("Removed only batch "+m.batch);
}
try{
 if(config.production||config.environment!=="development"||!config.db.database.endsWith("_dev")||!["127.0.0.1","localhost","::1"].includes(config.db.host)||!["127.0.0.1","localhost"].includes(new URL(config.smtpUrl).hostname))throw new Error("Only local development _dev database and local SMTP are permitted.");
 if(args[0]==="--remove")await remove(args[1]);
 else{
 if(!args.includes("--generate"))throw new Error("Use --generate or --remove <manifest>.");
 const nPatients=count("--patients",3000,10000),nAppointments=count("--appointments",12000,50000),nReviews=count("--reviews",2000,10000);
 const batch="synthetic-"+Date.now()+"-"+randomBytes(3).toString("hex"),password="LocalTest-"+randomBytes(18).toString("base64url")+"!";
 const pHash=await patientHash(password),sHash=await staffHash(password),pick=list=>list[randomInt(list.length)];
 const now=await databaseNow(),today=now.setZone(config.zone).startOf("day"),stamp=n=>now.minus({days:n}).toJSDate();
 const manifest={kind:"synthetic-practice-dataset-v1",batch,database:config.db.database,state:"prepared",createdAt:now.toISO(),patients:[],appointments:[],reviews:[],staff:[],ids:{},testPassword:password,patientExamples:[],samples:{}};
 const options=await bookingOptions();if(!options.length)throw new Error("No configured booking option; existing settings are never overwritten.");
 const option=options[0],people=[],records=[];
 for(let i=0;i<nPatients;i++){
  const id=newId(),email=batch+".patient"+String(i+1).padStart(5,"0")+"@example.test",name="Synthetic Patient "+String(i+1).padStart(5,"0"),phone="+143255501"+String(i%100).padStart(2,"0"),created=stamp(randomInt(7,730)),verified=i<10||i%20!==0,disabled=i>=10&&i%37===0;
  add("patient_accounts",[id,digest("patient-email:"+email),encrypt({displayName:name,email}),pHash,verified?created:null,disabled?created:null,1,created]);
  add("patient_details",[id,encrypt({displayName:name,phone,dateOfBirth:randomInt(1950,2001)+"-"+String(randomInt(1,13)).padStart(2,"0")+"-"+String(randomInt(1,29)).padStart(2,"0"),address:"Synthetic test address — not a residence",emergencyContactName:"Synthetic Emergency Contact",emergencyContactRelationship:"Test contact",emergencyContactPhone:"+14325550199",heightCm:randomInt(150,195),weightKg:randomInt(50,110),allergies:"Synthetic testing only",medications:"Synthetic testing only",conditions:"Synthetic testing only",medicalHistory:"Synthetic profile, not a clinical record."}),1,created]);
  manifest.patients.push(id);people.push({id,email,name,phone});if(i<5)manifest.patientExamples.push({id,email,name});
 }
 for(const [role,enabled] of [["administrator",true],["scheduler",true],["scheduler",false]]){
  const subject="synthetic:"+newId(),email=batch+"."+(enabled?role:"disabled-staff")+"@example.test",name="Synthetic "+(role==="administrator"?"Doctor Admin":enabled?"Staff Member":"Disabled Staff");
  add("staff_users",[subject,S.issuer,name,enabled?1:0,1,stamp(30)]);
  add("staff_local_credentials",[subject,emailHash(email),encrypt({email}),sHash,role==="administrator"?1:0,stamp(30),stamp(30)]);
  add("staff_grants",[subject,option.locationId,option.providerId,role]);add("staff_scopes",[subject,option.locationId,option.providerId,1,null]);
  manifest.staff.push({subject,email,role,enabled});
 }
 const operator=manifest.staff[0].subject;
 const make=(start,status,person,linked=true)=>{
  const id=newId(),end=start.plus({minutes:30}),created=(start.minus({days:2})>now?now:start.minus({days:2})).toJSDate(),reason=pick(["Synthetic annual visit discussion","Synthetic follow-up request","Synthetic medication question","Synthetic new concern","Synthetic routine appointment"]);
  add("appointment_requests",[id,randomUUID(),digest(batch+id),option.locationId,option.providerId,option.typeId,start.toJSDate(),end.toJSDate(),encrypt({name:person.name,email:person.email,phone:person.phone,reason}),status,null,1,JSON.stringify({reference:id,submissionStatus:"pending",clinicTimeZone:config.zone,reservationExpiresAt:null,supportContact:config.support}),created]);
  if(linked)add("patient_request_links",[id,person.id,created]);manifest.appointments.push(id);
  const r={id,start,end,status,person,linked};records.push(r);if(!manifest.samples[status])manifest.samples[status]=id;return r;
 };
 for(let i=0;i<nAppointments;i++)make(today.minus({days:1+Math.floor(i/16)}).set({hour:8,minute:30}).plus({minutes:(i%16)*30}),pick(["completed","cancelled","declined","expired","no_show"]),people[i%nPatients],i%4!==0);
 await fs.mkdir(directory,{recursive:true});const manifestFile=path.join(directory,batch+".json");
 await transaction(async c=>{
  await query("SELECT id FROM providers WHERE id=? FOR UPDATE",[option.providerId],c);
  const future=[];
  for(let day=1;day<=Math.min(config.horizonDays,60);day++){
   const available=await slotsFor(option,today.plus({days:day}).toISODate(),now,c);
   future.push(...available.filter((_,i)=>i%3===0).slice(0,2));if(future.length>=80)break;
  }
  for(let i=0;i<future.length;i++)make(DateTime.fromISO(future[i].startsAt),i%2?"approved":"pending",people[i%10]);
  for(let i=0;i<5;i++){
   const start=today.minus({days:i+1}).set({hour:12,minute:0});
   const [hit]=await query("SELECT id FROM appointment_requests WHERE provider_id=? AND status IN ('pending','approved') AND starts_at<? AND ends_at>? LIMIT 1",[option.providerId,start.plus({minutes:30}).toJSDate(),start.toJSDate()],c);
   if(!hit)make(start,"approved",people[i%5]);
  }
  for(let i=0;i<records.length;i++){
   const r=records[i];
   if(i%3===0&&["completed","no_show","approved"].includes(r.status)){
    add("appointment_patient_notes",[newId(),r.id,operator,encrypt({text:"Synthetic follow-up note for layout testing only. This is not medical advice."}),(r.end>now?now:r.end).toJSDate()]);
    add("staff_notes",[newId(),r.id,operator,encrypt({text:"Synthetic private staff note. Must not appear in the patient portal."}),(r.end>now?now:r.end).toJSDate()]);
   }
   if(i<2000){const status=i%5===0?"failed":"sent";add("notification_outbox",[newId(),r.id,r.status+":v1","patient",encrypt({to:r.person.email,reference:r.id,event:r.status,version:1,startsAt:r.start.toISO(),endsAt:r.end.toISO(),recipient:"patient",synthetic:true}),status,status==="sent"?1:config.emailAttempts,now.toJSDate(),status==="failed"?"SYNTHETIC_TEST_FAILURE":null,status==="sent"?stamp(1):null]);}
  }
  const cancelled=records.filter(r=>r.linked&&r.status==="cancelled"),used=new Set();
  for(const original of cancelled.slice(0,150)){
   const replacement=records.find(r=>r.linked&&r.id!==original.id&&r.person.id===original.person.id&&!used.has(r.id)&&r.status!=="cancelled");
   if(replacement){used.add(replacement.id);add("patient_reschedules",[replacement.id,original.id,original.person.id,"cancelled",original.start.minus({days:3}).toJSDate()]);}
  }
  for(const r of records.filter(r=>r.status==="approved"&&r.start>now).slice(0,10))add("staff_proposals",[newId(),r.id,r.start.plus({days:7}).toJSDate(),r.end.plus({days:7}).toJSDate(),1,"proposed",1,null,operator,stamp(1),stamp(1)]);
  const usedReplacements=new Set();
  for(const original of records.filter(r=>r.status==="approved"&&r.start>now).slice(10,13)){
   const replacement=records.find(r=>r.status==="pending"&&r.start>original.start&&!usedReplacements.has(r.id));
   if(!replacement)continue;
   usedReplacements.add(replacement.id);replacement.person=original.person;
   const request=data.appointment_requests.find(row=>row[0]===replacement.id);
   request[8]=encrypt({name:original.person.name,email:original.person.email,phone:original.person.phone,reason:"Synthetic patient reschedule request"});
   const link=data.patient_request_links.find(row=>row[0]===replacement.id);link[1]=original.person.id;
   data.appointment_requests.find(row=>row[0]===original.id)[11]++;
   add("patient_reschedules",[replacement.id,original.id,original.person.id,"pending",now.toJSDate()]);
  }
  for(let i=0;i<nReviews;i++){
   const id=newId(),status=pick(["pending","approved","rejected","withdrawn"]),created=stamp(randomInt(1,365)),raw={displayName:"Synthetic Reviewer "+(i+1),text:"SYNTHETIC TEST REVIEW "+(i+1)+". Generated to test sorting and moderation; this is not a real patient experience.",rating:randomInt(1,6)},checks={authenticityConfirmed:true,permissionConfirmed:true,privacyChecked:true,neutralModerationConfirmed:true};
   add("public_review_submissions",[id,digest(batch+id),digest(JSON.stringify(raw)),option.locationId,option.providerId,status,1,encrypt(raw),1,digest("withdraw:"+randomUUID()),status==="approved"?JSON.stringify(raw):null,status==="approved"?JSON.stringify(checks):null,status==="rejected"?encrypt({reason:"Synthetic rejection example"}):null,status==="pending"?null:operator,status==="approved"?created:null,created,created]);manifest.reviews.push(id);
  }
  for(let i=0;i<Math.min(300,people.length);i++){
   const person=people[i],status=i%6===0?"failed":"sent",attempts=status==="sent"?1:config.emailAttempts,error=status==="failed"?"SYNTHETIC_TEST_FAILURE":null,sent=status==="sent"?stamp(1):null;
   add("patient_mail_outbox",[newId(),encrypt({to:person.email,kind:pick(["registered","verified","profile_updated","password_reset"]),synthetic:true}),status,attempts,now.toJSDate(),error,sent]);
   add("communications_outbox",[newId(),digest(batch+":mail:"+i),encrypt({to:person.email,subject:"SYNTHETIC TEST email history",text:"Synthetic record only. This message was not delivered."}),status,attempts,now.toJSDate(),error,sent,stamp(1)]);
  }
  for(const table of Object.keys(columns))manifest.ids[table]=data[table].map(row=>row[0]);
  manifest.counts=Object.fromEntries(Object.entries(data).map(([table,rows])=>[table,rows.length]));
  await fs.writeFile(manifestFile,JSON.stringify(manifest,null,2));
  for(const [table,rows] of Object.entries(data)){await bulk(c,table,rows);console.log("Generated "+rows.length+" "+table);}
  for(let i=0;i<records.length;i+=100){const group=records.slice(i,i+100);await query("INSERT INTO audit_events(request_id,actor,event,details,created_at) VALUES "+group.map(()=>"(?,?,?,?,?)").join(","),group.flatMap(r=>[r.id,operator,"synthetic.request."+r.status,JSON.stringify({syntheticBatch:batch,version:1}),(r.start.minus({days:2})>now?now:r.start.minus({days:2})).toJSDate()]),c);}
 });
 manifest.state="ready";await fs.writeFile(manifestFile,JSON.stringify(manifest,null,2));
 const guide=path.join(directory,batch+"-README.md");
 await fs.writeFile(guide,[
 "# Synthetic test dataset","Batch: "+batch,
 "All records are synthetic. Emails use example.test and phone numbers use the fictional 555-0100–0199 range. Do not deploy this database or publish these reviews on a real site.",
 "## Shared test-only password",password,
 "## Team logins",...manifest.staff.map(s=>"- "+s.email+" — "+s.role+(s.enabled?"":" (disabled account)")),
 "## Patient logins",...manifest.patientExamples.map(p=>"- "+p.email),
 "Use http://localhost:5173/staff/login for team accounts and /portal/login for patients. Existing CAPTCHA checks still apply.",
 "## Record counts",...Object.entries(manifest.counts).map(([table,n])=>"- "+table+": "+n),
 "Historical emails marked sent are display fixtures, not actual delivery. No pending mail jobs were generated. Existing records and practice settings were preserved. Future pending bookings may naturally expire and generate Mailpit updates when their time arrives.",
 "## Remove this batch","From the server directory:","node scripts/generate-test-data.mjs --remove ../local-test-data/"+batch+".json",
 "Removal is transactional and manifest-scoped. If manual testing creates additional dependent records, remove those first."
 ].join("\n\n").replaceAll("\\n","\n"));
 console.log(JSON.stringify({batch,counts:manifest.counts,manifest:manifestFile,guide},null,2));
 }
}catch(error){console.error(error.message);process.exitCode=1;}finally{await pool.end();}
