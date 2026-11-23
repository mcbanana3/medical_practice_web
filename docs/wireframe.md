# Frozen wireframe amendment — v0.2

These user-requested changes amend the original six-chunk reference.
All other sitemap, workflow, privacy, accessibility, and content rules remain.

## Visual direction

Replace the evergreen-led palette with:
- Cobalt: #253DB8
- Deep midnight: #172350
- Warm white: #FFFCF8
- Pale lavender: #EEEAFE
- Coral accent: #FF765E
- Dark coral text: #A73524

Keep Source Serif 4 and Source Sans 3.
Keep generous spacing, readable widths, and restrained component shapes.
Validate actual contrast before launch.

Increase decorative animation and section transitions.
Provide a persistent, non-obscuring motion control.
Respect prefers-reduced-motion.
Never hide essential information or require animation.

## Public sitemap additions

- Reviews
  - Published, authentic, permission-cleared reviews only
  - Clear source/type labeling
  - Review submission entry
  - Moderation and privacy explanation

Add Reviews to main navigation and footer.
Add a homepage reviews signpost before the final appointment invitation.

Do not fabricate reviews, names, ratings, counts, or outcomes.
Do not publish pending or rejected reviews in frontend assets.
Selected testimonials must be distinguished from third-party reviews.
Do not present testimonials as proof of clinical outcomes.

## Review moderation — later backend/admin phase

Add staff navigation:
- Reviews / moderation queue
- Review detail and audit history

Planned states:
- pending_review
- approved
- published
- rejected
- withdrawn

Only an authorized doctor with the appropriate scope may approve a review.
Publication requires recorded doctor approval plus completed authenticity,
source, publication-permission, and privacy checks.

Approval and publication must be enforced by the server, not a client flag.
Do not allow public clients to assign approval, publication, or reviewer roles.

Record:
- Submitted content and permitted display identity
- Review source/type
- Required permission evidence
- Moderation status
- Doctor approver and timestamp
- Publication/unpublication events
- Concise internal moderation reason

Keep internal notes separate from public content.
Do not change a review's meaning.
Apply neutral moderation rules; do not misleadingly imply that selected
positive testimonials represent all feedback.

Do not reveal patient relationships in public replies.
Do not expose patient records through review moderation.
Retention, withdrawal, verification, and final permission wording require
practice/privacy review.

## Google Maps

Add a click-to-load Google Maps embed to Locations and Contact.
Use the verified practice location only.
Keep readable address and approved directions available without the embed.
Explain the third-party connection before loading.
A map failure must not block essential contact information.

## Phase 3 boundary

Review submission, moderation, and publication are not connected.
Review forms must report "Not submitted" rather than fake success.
No real review is published until the later secure backend workflow exists.

## Approval record

Practice approver: [PLACEHOLDER: practice approver]
Privacy/legal reviewer: [PLACEHOLDER: reviewer, as appropriate]
Approval date: [PLACEHOLDER: approval date]