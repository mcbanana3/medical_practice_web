# Local search SEO — Harika Thummala Internal Medicine

Canonical production origin: https://harikathummalamd.com

## Implemented

- Human-readable page titles and original descriptions for the Odessa Internal Medicine landing page, physician profile, care information, new patients, insurance, directions, reviews, and booking.
- Static prerendered HTML, one primary heading per indexable page, social metadata, canonical URLs, local MedicalClinic/physician Person/WebSite/WebPage structured data and inner-page breadcrumbs.
- Only genuine published contact and scheduling information appears in structured data. No fabricated services, certificates, fees, review ratings, or aggregate-rating markup.
- Useful appointment preparation, insurance questions, portal guidance, actual guest support directions, public website privacy summary, and office contact content replace empty sections and inactive demo screens.
- Demonstration routes are removed. Private portal, admin, staff, guest-management, receipt, unknown, and unpublished formal-notice pages stay noindex.
- Robots allows crawling HTML so search engines can read noindex; private APIs are disallowed and authentication still protects all records.
- The sitemap contains only indexable pages. No made-up modification dates, priority scores, or review counts.
- Staff code is loaded separately from the public entry bundle. Home hero image loads eagerly with high fetch priority; below-the-fold decorative portraits remain lazy.

## Configuration and publishing

The local .env is configured with:
VITE_SITE_URL=https://harikathummalamd.com
VITE_PUBLIC_INDEXING=true

These Vite variables are baked into the build. Set both in the actual production build environment; keep VITE_PUBLIC_INDEXING=false in staging. Never deploy server .env, .env.staff, credentials, or test data with static assets.

Run npm run test:seo before deploying. Then deploy dist to your HTTPS host. This work creates local build artifacts; it does not register a domain, configure DNS, or deploy the site.

Serve each prerendered route's index.html at its clean URL. Return HTTP 404 and the generated 404.html for unknown public URLs. Route /portal/*, /staff/*, and /admin/* through the SPA when a static file does not exist, preserving noindex. Redirect HTTP and the alternate www hostname permanently to the canonical HTTPS origin. Avoid a host-wide noindex response header on public pages.

Before activating booking on the public host, configure the API origin, production cookies, real email delivery, and allowed reCAPTCHA/Google sign-in domains for that host. Local Mailpit delivery is not public email delivery.

## Verify after deployment

1. Verify harikathummalamd.com ownership in Google Search Console through its supported DNS or HTML verification process. This requires the owner's Google account and DNS/hosting access.
2. Submit https://harikathummalamd.com/sitemap.xml and inspect the home, about, care, and contact URLs. Check rendered HTML, HTTPS, canonical selection, crawl access, and response headers.
3. Validate JSON-LD using Google's Rich Results Test and Schema Markup Validator. Valid markup does not guarantee enhanced search appearance.
4. Check real mobile performance using PageSpeed Insights, then monitor real-user Core Web Vitals after traffic accumulates.
5. Maintain a Google Business Profile with the same practice name, Suite 205 address, phone, website, and hours. The owner must verify the profile and confirm the appropriate primary category.
6. Check other existing directory listings for outdated suites and phone numbers. Do not overwrite published practice details from third-party directory inconsistencies.
7. Review practice details and public copy with the doctor. Add credentials, specific services, plans, fees, hospital affiliations, or medical advice only after the practice verifies them. Have the practice provide its formal privacy/access notices; the website summary does not substitute for them.

## Content provenance and limits

Name, office address, phone, email, hours, and 30-minute booking rules come from the practice information and functioning workflows supplied in this project. Education, current board certification, hospital affiliation, and years-of-experience claims were removed because current verification was not established. This is not a clinical-content review or a legal compliance certification.

Specialty background:
https://www.acponline.org/about-acp/about-internal-medicine

SEO implementation references:
https://developers.google.com/search/docs/fundamentals/seo-starter-guide
https://developers.google.com/search/docs/fundamentals/creating-helpful-content
https://developers.google.com/search/docs/appearance/structured-data/local-business
https://developers.google.com/search/docs/essentials/technical

No search position is guaranteed. Deployment, domain verification, profile consistency, competition, useful content, and ongoing performance monitoring affect visibility.
