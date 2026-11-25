import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { config } from '../src/config.mjs';
import { pool, query, encrypt, newId, transaction, digest } from '../src/db.mjs';
import { createPublicReviewsRouter, mountReviewModeration } from '../src/reviews.mjs';
import { need, scopeSQL } from '../src/staff/index.mjs';
import { S } from '../src/staff/auth.mjs';
let server,base;
const subject='review-test:'+randomUUID();
const ids=[];
const ctx={subject,grants:[{locationId:1,providerId:1,role:'administrator'}]};
before(async()=>{
 assert.equal(config.environment,'test'); assert.ok(config.db.database.endsWith('_test'));
 await query("INSERT INTO staff_users(subject,issuer,display_name,enabled,auth_version,created_at) VALUES(?,?,?,1,1,UTC_TIMESTAMP(3))",[subject,S.issuer,'Synthetic test administrator']);
 await query("INSERT INTO staff_local_credentials(subject,email_hash,email_enc,password_hash,is_doctor,created_at,updated_at) VALUES(?,?,?,'test-only-not-a-login-hash',0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[subject,newId()+newId(),encrypt({email:'reviews@example.test'})]);
 await query("INSERT INTO staff_grants VALUES(?,1,1,'administrator')",[subject]);
 const app=express(); app.use(express.json()); app.use('/reviews',createPublicReviewsRouter({captchaVerifier:async()=>{}}));
 mountReviewModeration({need,scopeSQL,add:(method,path,handler)=>app[method]('/moderation'+path,async(req,res)=>{try{res.json(await transaction(c=>handler(req,ctx,c)))}catch(e){res.status(e.status||500).json({error:e.code})}})});
 server=app.listen(0);await once(server,'listening');base='http://127.0.0.1:'+server.address().port;
});
after(async()=>{
 for(const id of ids){await query("DELETE FROM communications_outbox WHERE dedup_key=?",[digest("staff-message:public-review:"+id+":"+subject)]);await query("DELETE FROM audit_events WHERE JSON_UNQUOTE(JSON_EXTRACT(details,'$.reviewReference'))=?",[id]);await query('DELETE FROM public_review_submissions WHERE id=?',[id]);}

 await query('DELETE FROM staff_grants WHERE subject=?',[subject]);await query('DELETE FROM staff_local_credentials WHERE subject=?',[subject]);await query('DELETE FROM staff_users WHERE subject=?',[subject]);
 if(server)await new Promise(r=>server.close(r));await pool.end();
});
async function call(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Origin:config.origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
test('submitted review stays private until admin approval; consent checks and withdrawal enforced',async()=>{
 const key=randomUUID();const input={idempotencyKey:key,locationId:1,providerId:1,displayName:'Synthetic review test',text:'Synthetic review text for automated testing only.',rating:4,publicationConsent:true,captchaToken:'test'};
 const result=await call('/reviews',input);assert.equal(result.status,201);
 const [row]=await query("SELECT id,status,version FROM public_review_submissions WHERE status='pending' ORDER BY created_at DESC LIMIT 1");
 ids.push(row.id);assert.equal(row.status,'pending');
 assert.ok(!(await call('/reviews')).data.items.some(r=>r.id===row.id));
 assert.equal((await call('/moderation/reviews/'+row.id+'/action',{action:'approve',expectedVersion:1})).status,400);
 const checks={authenticityConfirmed:true,permissionConfirmed:true,privacyChecked:true,neutralModerationConfirmed:true};
 assert.equal((await call('/moderation/reviews/'+row.id+'/action',{action:'approve',expectedVersion:1,...checks})).status,200);
 const published=(await call('/reviews')).data.items.find(r=>r.id===row.id);assert.equal(published.rating,4);assert.ok(published.createdAt);
 await call('/reviews/withdraw',{code:result.data.withdrawalCode,captchaToken:'test'});
 assert.ok(!(await call('/reviews')).data.items.some(r=>r.id===row.id));
});
test('sorting orders the full published feed and rejects unknown sort expressions',async()=>{
 for(const [rating,date] of [[1,'2026-01-01'],[5,'2026-02-01'],[null,'2026-03-01']]){
 const id=newId();ids.push(id);const raw={displayName:'Synthetic sorting test',text:'Synthetic review for automated sort verification.',rating};
 await query("INSERT INTO public_review_submissions(id,submission_key,payload_hash,location_id,provider_id,status,version,submission_enc,publication_consent,withdraw_hash,public_json,created_at,updated_at,approved_at) VALUES(?,?,?,1,1,'approved',1,?,1,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[id,newId()+newId(),newId()+newId(),encrypt(raw),newId()+newId(),JSON.stringify(raw),date]);
 }
 const last=ids.slice(-3);
 for(const [sort,expected] of [['oldest',last],['newest',[...last].reverse()],['highest',[last[1],last[0],last[2]]],['lowest',last]]){
 const response=await call('/reviews?sort='+sort);assert.equal(response.status,200);assert.deepEqual(response.data.items.filter(r=>last.includes(r.id)).map(r=>r.id),expected);
 }
 assert.equal((await call('/reviews?sort=DROP_TABLE')).status,400);
});
