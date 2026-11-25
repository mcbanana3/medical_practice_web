import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {pool} from '../src/db.mjs';
import {config} from '../src/config.mjs';
import {emailContent} from '../src/email-content.mjs';
import {renderMessage} from '../src/notifications.mjs';
import {renderAccountMessage} from '../src/auth/mail.mjs';
after(()=>pool.end());
const snapshot={recipient:'patient',reference:'a'.repeat(32),startsAt:'2026-12-15T15:00:00Z',endsAt:'2026-12-15T15:30:00Z',provider:'Dr. Harika Thummala, MD',location:'420 E 6th St, Suite 205, Odessa, TX',occurredAt:'2026-12-01T12:00:00Z'};
test('appointment messages describe every transition with details and both formats',()=>{
 const subjects=new Set();
 for(const event of ['requested','approved','declined','cancelled','completed','no_show','reschedule_requested','reschedule_approved','reschedule_declined','reschedule_cancelled','reschedule_closed']){
  const mail=renderMessage({...snapshot,event},'pending');subjects.add(mail.subject);
  assert.ok(mail.text.includes(snapshot.reference));assert.ok(mail.text.includes(snapshot.provider));assert.ok(mail.text.includes(config.zone));assert.ok(mail.html.includes('<table'));assert.ok(mail.text.includes('current status'));assert.ok(!mail.text.includes('undefined'));
 }
 assert.equal(subjects.size,11);
 assert.match(renderMessage({...snapshot,event:'reschedule_requested'},'pending').text,/original appointment remains reserved/);
});
test('delayed event email clearly distinguishes action from current status',()=>{
 const mail=renderMessage({...snapshot,event:'requested'},'approved');
 assert.match(mail.text,/not an appointment confirmation/);assert.match(mail.text,/Status when this email was prepared: approved/);
});
test('account emails identify specific successful actions and keep access links only in access messages',()=>{
 for(const kind of ['verify','reset','registered','verified','login','logout','password_reset','password_changed','profile_updated','google_linked','google_unlinked','reauthenticated','session_revoked','sessions_revoked','request_linked']){
  const url=['verify','reset'].includes(kind) ? config.origin+'/portal/verify#token=synthetic' : '';
  const mail=renderAccountMessage({kind,url,occurredAt:snapshot.occurredAt});
  assert.ok(mail.subject);assert.ok(mail.text.includes('Harika Thummala'));assert.ok(mail.html);if(url)assert.ok(mail.text.includes(url));assert.ok(!mail.text.includes('undefined'));
 }
});
test('email HTML escapes supplied labels and refuses external action links',()=>{
 const mail=renderMessage({...snapshot,event:'requested',provider:'<script>alert(1)</script>'},'pending');
 assert.ok(!mail.html.includes('<script>'));assert.ok(mail.html.includes('&lt;script&gt;'));
 assert.ok(!emailContent('Test',['Safe'],{url:'https://untrusted.example/'}).html.includes('href='));
});
