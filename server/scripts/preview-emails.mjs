import {config} from '../src/config.mjs';
import {pool} from '../src/db.mjs';
import {createMailTransport,renderMessage} from '../src/notifications.mjs';
import {renderAccountMessage} from '../src/auth/mail.mjs';
import {practice} from '../../src/content.js';
const smtp=new URL(config.smtpUrl);
if(config.production || !['localhost','127.0.0.1','::1','[::1]'].includes(smtp.hostname)) throw new Error('Previews may only be sent to a local test inbox.');
const transport=createMailTransport();
try {
 const payload={recipient:'patient',reference:'PREVIEW-NO-REAL-BOOKING',startsAt:new Date(Date.now()+86400000).toISOString(),endsAt:new Date(Date.now()+88200000).toISOString(),occurredAt:new Date().toISOString(),provider:practice.clinician,location:practice.address};
 const messages=[renderAccountMessage({kind:'verify',url:config.origin+'/portal/verify#token=preview-not-valid',occurredAt:payload.occurredAt}),...['requested','approved','reschedule_requested','reschedule_approved','cancelled'].map(event=>renderMessage({...payload,event},event.includes('approved')?'approved':event==='cancelled'?'cancelled':'pending'))];
 for(const [i,message] of messages.entries()) await transport.sendMail({from:config.emailFrom,to:'preview-patient@example.test',...message,subject:'[PREVIEW ONLY] '+message.subject,text:'Synthetic email preview. No real account or appointment was created.\n\n'+message.text,html:message.html.replace('<h1 ','<p style="color:#a12622">Synthetic preview only. No real account or appointment was created.</p><h1 '),messageId:`<preview-${Date.now()}-${i}@${config.messageDomain}>`});
 console.log('Captured '+messages.length+' synthetic email previews in the local inbox.');
} finally {transport.close();await pool.end();}
