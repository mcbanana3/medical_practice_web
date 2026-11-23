import fs from "node:fs/promises";
import path from "node:path";

import {
  render,
  pages,
  site,
  getSeo,
  sitemapPages,
  approvedSchema,
  escapeHtml,
  validSiteUrl
} from "../.prerender/prerender.js";

if (site.publicationReady && !validSiteUrl()) {
  throw new Error(
    "Publication requires an approved HTTPS origin in VITE_SITE_URL."
  );
}

const output = path.resolve("dist");
const template = await fs.readFile(path.join(output, "index.html"), "utf8");

for (const route of [...pages, { path: "/404" }]) {
  const seo = getSeo(route.path);
  const schema = route.path === "/" ? approvedSchema() : null;

  const head = [
    `<meta data-site-meta name="description" content="${escapeHtml(seo.description)}">`,
    `<meta data-site-meta name="robots" content="${escapeHtml(seo.robots)}">`,
    seo.canonical
      ? `<link data-site-meta rel="canonical" href="${escapeHtml(seo.canonical)}">`
      : "",
    schema
      ? `<script data-site-meta type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script>`
      : ""
  ].join("\n");

  const html = template
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(seo.title)}</title>`)
    .replace("<!--app-head-->", head)
    .replace("<!--app-html-->", render(route.path));

  const destination = route.path === "/404"
    ? path.join(output, "404.html")
    : route.path === "/"
      ? path.join(output, "index.html")
      : path.join(output, route.path.slice(1), "index.html");

  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, html);
}

const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...sitemapPages().map(
    (page) => `<url><loc>${escapeHtml(new URL(page.path, `${site.url}/`).href)}</loc></url>`
  ),
  "</urlset>"
].join("\n");

await fs.writeFile(path.join(output, "sitemap.xml"), sitemap);

const robots = site.publicationReady
  ? [
      "User-agent: *",
      "Allow: /",
      "Disallow: /portal",
      "Disallow: /staff",
      "Disallow: /manage-request",
      "Disallow: /request-an-appointment/received",
      "Disallow: /preview",
      "Disallow: /care/content-preview",
      `Sitemap: ${site.url}/sitemap.xml`
    ].join("\n")
  : "User-agent: *\nDisallow: /\n";

await fs.writeFile(path.join(output, "robots.txt"), robots);

console.log(`Generated ${pages.length + 1} HTML pages.`);
console.log(
  site.publicationReady
    ? "Publication mode enabled."
    : "Preview mode: indexing disabled and sitemap intentionally empty."
);