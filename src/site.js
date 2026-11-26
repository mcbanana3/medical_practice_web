import { practice } from "./content.js";
export const ph = () => "";

export const emergency =
  "This website and appointment requests are not monitored for emergencies. " +
  "If you are experiencing a medical emergency, call 911.";


export const site = {
  publicationReady: import.meta.env?.VITE_PUBLIC_INDEXING === "true",
  verified: true,
  url: (import.meta.env?.VITE_SITE_URL || "").trim().replace(/\/+$/, ""),
  name: practice.name,
  specialty: practice.specialty,
  clinician: practice.clinician,
  address: practice.address,
  phone: practice.phone,
  hours: practice.hours,
  timeZone: practice.timeZone,
  map: practice.map,
  notices: {
    privacyPractices: false,
    nondiscrimination: false,
    languageAssistance: false
  },
  structuredData: null
};

export const pages = [
  ["/", "Home"],
  ["/about", "About the practice"],
  ["/care", "Care"],
  ["/reviews", "Reviews"],
  ["/new-patients", "New patients"],
  ["/insurance-fees", "Insurance and fees"],
  ["/contact", "Locations and contact"],
  ["/emergency", "Emergency and urgent information"],
  ["/request-an-appointment", "Request an appointment"],
  ["/request-an-appointment/received", "Appointment request receipt", true],
  ["/manage-request", "Manage appointment request", true],
  ["/portal", "Patient portal", true],
  ["/portal/login", "Patient sign in", true],
  ["/portal/register", "Create an account", true],
  ["/portal/recovery", "Account recovery", true],
  ["/portal/verify", "Email verification", true],
  ["/portal/appointments", "Appointments and request history", true],
  ["/portal/profile", "Patient profile", true],
  ["/portal/account", "Account and security", true],
  ["/portal/link", "Link a guest request", true],
  ["/privacy", "Website Privacy Notice"],
  ["/privacy-practices", "Notice of Privacy Practices", false, "privacyPractices"],
  ["/terms", "Website Terms"],
  ["/accessibility", "Accessibility"],
  ["/nondiscrimination", "Notice of Non-Discrimination", false, "nondiscrimination"],
  ["/language-assistance", "Language assistance", false, "languageAssistance"],
].map(([path, title, sensitive = false, conditional]) => ({
  path, title, sensitive, conditional
}));

export function validSiteUrl() {
  try {
    const url = new URL(site.url);
    return url.protocol === "https:" && !url.username && !url.password && !["localhost","127.0.0.1","[::1]"].includes(url.hostname) && url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
}

const searchContent = {
 "/":["Internal Medicine in Odessa, TX | Dr. Harika Thummala","Visit Dr. Harika Thummala, MD, for adult Internal Medicine in Odessa, TX. Find office hours, directions, appointment requests, and patient portal access."],
 "/about":["Dr. Harika Thummala, MD | Internal Medicine, Odessa TX","Meet Dr. Harika Thummala, MD, an Internal Medicine physician in Odessa, Texas. Learn about the practice and prepare to request your appointment."],
 "/care":["Internal Medicine & Adult Healthcare | Odessa, TX","Learn about adult Internal Medicine at Dr. Harika Thummala’s Odessa practice. Find appointment information and questions to discuss before your visit."],
 "/new-patients":["New Patient Appointments | Dr. Harika Thummala, Odessa","Plan your first visit to Dr. Harika Thummala’s Internal Medicine office in Odessa. Learn how requests, staff approval, preparation, and patient accounts work."],
 "/insurance-fees":["Insurance & Visit Cost Questions | Odessa Internal Medicine","Prepare insurance and visit-cost questions for Dr. Harika Thummala’s office. Call to confirm plan participation, payment information, and appointment needs."],
 "/contact":["Office Hours & Directions | Dr. Harika Thummala, Odessa","Find Dr. Harika Thummala at 420 E 6th St, Suite 205, Odessa, TX 79761. View office hours and directions, or call (432) 337-0555 for appointment help."],
 "/reviews":["Practice Reviews | Dr. Harika Thummala, Odessa TX","Read published feedback about Dr. Harika Thummala’s Odessa practice or share your experience. Reviews are moderated before appearing on this website."],
 "/request-an-appointment":["Request an Appointment | Dr. Harika Thummala, Odessa","Request a 30-minute appointment with Dr. Harika Thummala in Odessa, Texas. Choose an available time and provide contact details. Staff approval is required."],
 "/emergency":["Emergency & Office Contact Information | Odessa Practice","Call 911 for a medical emergency. Find non-emergency office contact information for Dr. Harika Thummala’s Internal Medicine practice in Odessa, Texas."]
};

export function getSeo(path) {
  const normalized = path === "/" ? "/" : path.replace(/\/+$/, "");
  let page = pages.find(entry => entry.path === normalized);
  if (/^\/(?:portal|staff|admin)(?:\/|$)/.test(normalized)) page = {title:"Private account access",sensitive:true};
  const applicable = !page?.conditional || site.notices[page.conditional];
  const indexable = Boolean(page && site.publicationReady && validSiteUrl() && !page.sensitive && applicable);
  const content = searchContent[normalized];
  return {
    title:content?.[0] || `${page?.title || "Page not found"} | ${site.name}`,
    description:content?.[1] || (page?.sensitive ? "Private account access for patients and the practice team." : page ? `${page.title} for ${site.name} in Odessa, Texas. Contact the office at (432) 337-0555 for assistance.` : "The requested page is unavailable."),
    robots:indexable ? "index,follow,max-image-preview:large" : "noindex,nofollow",
    canonical:page && !page.sensitive && validSiteUrl() ? new URL(normalized,site.url+"/").href : "",
    image:validSiteUrl() ? site.url+"/potrait.png" : "",
    pageTitle:page?.title || "Page not found",
    path:normalized
  };
}

export function socialMetadata(seo) {
  const fields = [["og:type","website"],["og:locale","en_US"],["og:site_name",site.name],["og:title",seo.title],["og:description",seo.description],["twitter:card","summary_large_image"],["twitter:title",seo.title],["twitter:description",seo.description]];
  if(seo.canonical)fields.push(["og:url",seo.canonical]);
  if(seo.image)fields.push(["og:image",seo.image],["og:image:alt",practice.clinician],["twitter:image",seo.image]);
  return fields;
}

export function sitemapPages() {
  if (!site.publicationReady || !validSiteUrl()) return [];
  return pages.filter((page) =>
    !page.sensitive && (!page.conditional || site.notices[page.conditional])
  );
}

export function approvedSchema(path = "/") {
  const seo = getSeo(path);
  if (!site.publicationReady || !site.verified || !validSiteUrl() || seo.robots.startsWith("noindex")) return null;
  const url=site.url;
  const address={"@type":"PostalAddress",streetAddress:"420 E 6th St, Suite 205",addressLocality:"Odessa",addressRegion:"TX",postalCode:"79761",addressCountry:"US"};
  const clinic={"@type":"MedicalClinic","@id":url+"/#practice",name:practice.name,url,telephone:practice.phone,address,image:url+"/potrait.png",logo:url+"/favicon.svg",medicalSpecialty:"https://schema.org/PrimaryCare",description:"Adult Internal Medicine in Odessa, Texas with Dr. Harika Thummala, MD",areaServed:{"@type":"City",name:"Odessa, Texas"},openingHoursSpecification:[
    {"@type":"OpeningHoursSpecification",dayOfWeek:["Monday","Tuesday","Wednesday","Thursday"],opens:"08:30",closes:"16:30"},
    {"@type":"OpeningHoursSpecification",dayOfWeek:["Friday"],opens:"08:30",closes:"12:30"}
  ],employee:{"@id":url+"/#physician"}};
  const physician={"@type":"Person","@id":url+"/#physician",name:practice.clinician,jobTitle:"Internal Medicine physician",worksFor:{"@id":url+"/#practice"},url:url+"/about"};
  const graph=[clinic,physician,{"@type":"WebSite","@id":url+"/#website",url,name:practice.name,publisher:{"@id":url+"/#practice"}},{"@type":"WebPage","@id":seo.canonical+"#webpage",url:seo.canonical,name:seo.title,description:seo.description,isPartOf:{"@id":url+"/#website"},about:{"@id":url+"/#practice"},inLanguage:"en-US"}];
  if(path !== "/")graph.push({"@type":"BreadcrumbList",itemListElement:[{"@type":"ListItem",position:1,name:"Home",item:url+"/"},{"@type":"ListItem",position:2,name:seo.pageTitle,item:seo.canonical}]});
  return {"@context":"https://schema.org","@graph":graph};
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}