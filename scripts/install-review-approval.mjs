import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

async function read(file) {
  return (await fs.readFile(path.join(root, file), "utf8"))
    .replace(/\r\n?/g, "\n");
}

function replaceRequired(source, pattern, replacement, label) {
  if (!pattern.test(source)) {
    throw new Error(`Cannot locate ${label}. No integration files have been written.`);
  }
  return source.replace(pattern, replacement);
}

try {
  for (const file of [
    "server/src/reviews.mjs",
    "server/migrations/009_public_review_approval.sql",
    "src/staff/ReviewModeration.jsx",
    "src/components/PracticeReviews.jsx",
    "src/components/reviews-live.css"
  ]) await read(file);

  let index = await read("server/src/staff/index.mjs");
  let staff = await read("src/staff/StaffApp.jsx");

  if (/\bmountReviews\s*\(/.test(index)) {
    throw new Error(
      "This router still mounts an older reviews module. Stop before registering duplicate review routes."
    );
  }

  if (!index.includes('from "../reviews.mjs"') &&
      !index.includes("from '../reviews.mjs'")) {
    index = 'import { mountReviewModeration } from "../reviews.mjs";\n' + index;
  }

  if (!/\bmountReviewModeration\s*\(\s*\{/.test(index)) {
    index = replaceRequired(
      index,
      /^([ \t]*)mountManagement\s*\(/m,
      (_match, indent) =>
        `${indent}mountReviewModeration({ add, need, scopeSQL });\n` +
        `${indent}mountManagement(`,
      "staff management registration"
    );
  }

  if (!staff.includes("./ReviewModeration.jsx")) {
    staff = 'import ReviewModeration from "./ReviewModeration.jsx";\n' + staff;
  }

  if (!/path\s*=\s*["']\/staff\/reviews["']/.test(staff)) {
    staff = replaceRequired(
      staff,
      /(^[ \t]*)(<Route\s+path\s*=\s*["']\/staff\/account["'])/m,
      (_match, indent, original) =>
        `${indent}<Route path="/staff/reviews" element={<Gate permission="access"><ReviewModeration /></Gate>} />\n` +
        `${indent}${original}`,
      "staff account route"
    );
  }

  if (!/\[\s*["']access["']\s*,\s*["']\/staff\/reviews["']\s*,\s*["']Reviews["']\s*\]/.test(staff)) {
    staff = replaceRequired(
      staff,
      /\[\s*null\s*,\s*["']\/staff\/account["']\s*,\s*["']Account["']\s*\]/,
      original => `["access", "/staff/reviews", "Reviews"],\n            ${original}`,
      "staff navigation account entry"
    );
  }

  const changes = new Map([
    ["server/src/staff/index.mjs", index],
    ["src/staff/StaffApp.jsx", staff]
  ]);

  const backupRoot = path.join(
    root, ".review-approval-backup-" + new Date().toISOString().replace(/[:.]/g, "-")
  );

  for (const file of changes.keys()) {
    const destination = path.join(backupRoot, file);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(path.join(root, file), destination);
  }
  for (const [file, source] of changes) {
    await fs.writeFile(path.join(root, file), source);
    console.log("Updated " + file);
  }

  console.log("Backup: " + path.basename(backupRoot));
  console.log("Review integration complete. Apply migration 009, check, build, and restart.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}