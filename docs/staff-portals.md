# Practice team portals

Both doctor/admin and staff accounts sign in at **/staff/login**. There is no role selector or public team registration. The verified session's saved grants determine the destination: administrator → /admin; scheduler (staff) → /staff. /admin/login redirects to the shared login.

## Permissions

- Staff: appointment queue/calendar/details, approve/decline/cancel, patient-agreed rescheduling, review invitations, review moderation, attendance outcomes and patient-visible appointment notes, own account/password/sessions.
- Admin: all staff actions plus registered patient directory and profile/medical information, doctor/practice information, working hours and closures, verified guest-request linking, team invitations/roles/account disabling, activity history and appointment email delivery status.
- Admin permissions include medical access. Legacy clinician grants have the same limited operational permissions as staff; they no longer grant medical access. Legacy audit-only grants retain their specific audit permission.
- Existing location/provider grants continue to constrain appointment and review access. The admin patient directory covers registered patients in this single-practice application, including patients without appointments.
- Doctor/practice contact information is displayed from the published site content. This release does not add a CMS for editing that content; schedule changes use the availability editor.

Both the API and frontend import shared/staff-permissions.js. Direct API access must pass the saved role and resource-grant checks; hiding navigation is not authorization. Existing sessions re-read grants from the database. The backend must be restarted when deploying permission-code changes.

## Review invitations

Open an appointment detail page and choose **Send review request**. Available for completed appointments, or approved appointments after their end time. The confirmation shows the recipient. The email asks for optional, honest feedback and links to /reviews#share-review.

Each appointment has one persistent outbox deduplication key. Repeated clicks, concurrent submissions, and retries cannot queue additional invitations. Status shows pending/processing/sent/failed; sent means accepted by SMTP, not proof of inbox delivery. Delivery uses the existing email worker and configured SMTP (currently Mailpit). No clinical reason is included.

## Validation

- npm test (frontend)
- npm test in server (dedicated _test database)
- node scripts/check-staff-portal.mjs (role/route rendering)
- node scripts/check-patient-portal.mjs (patient portal regression)
- npm run build

Do not put passwords, recovery codes, or session tokens in source control. Use the existing staff-admin provisioning script only when creating the initial administrator; subsequent accounts can be invited from Admin → Team access.

## Appointment queues

Dashboards count pending requests across all dates and show a five-request preview. The queue opens without date restrictions, so older and distant pending requests remain visible. Optional date filters require both endpoints and allow up to 93 inclusive clinic-local days. Reset filters returns to all dates. Status totals apply to the same date/resource/search filters as the list. Appointment rows show the booking contact’s name, email, phone, and visit reason; they work for guest and registered bookings. Encrypted contact columns are never returned by the list API.

## Expiry, outcomes, and shared notes

The appointment email worker automatically expires pending requests when their scheduled start time arrives, using provider locks to serialize with staff decisions. Future pending requests stay reserved. Approved appointments are never automatically expired. Expiry closes invalid linked replacements and queues status emails once. Dashboard/queue views refresh while visible every 30 seconds. Keep the worker running for automatic expiry.

Staff and admins can mark approved visits completed after the scheduled end or record nonattendance after the start. Resolve any pending replacement first. Outcomes appear in the linked patient portal.

Patient-visible notes are added from appointment detail, confirmed before publication, encrypted at rest, and retained as dated entries. They are available only through the linked patient’s authorized appointment endpoint. Private administrative notes remain separate. Emails announce that a note is available without including its text. Migration 011 is required before deploying this release.
