import fs from "node:fs/promises";

const filename = new URL("../src/site.js", import.meta.url);
let source = await fs.readFile(filename, "utf8");

if (source.includes('import { practice } from "./content.js";')) {
  throw new Error("Practice content is already connected.");
}

const start = source.indexOf("export const site = {");
const end = source.indexOf("\nexport const pages =", start);

if (start < 0 || end < 0) {
  throw new Error("Expected site configuration was not found. No file changed.");
}

const replacement = String.raw`
export const site = {
  publicationReady: false,
  verified: false,
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
`;

source =
  'import { practice } from "./content.js";\n' +
  source.slice(0, start) +
  replacement +
  source.slice(end);

source = source.replace(
  'export const ph = (text) => `[PLACEHOLDER: ${text}]`;',
  'export const ph = () => "";'
);

await fs.copyFile(filename, new URL("../src/site.js.before-content-update", import.meta.url));
await fs.writeFile(filename, source);

console.log("Practice identity connected. Public indexing remains disabled pending launch review.");