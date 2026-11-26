import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {pages,site,getSeo,sitemapPages,approvedSchema} from "../.prerender/prerender.js";
assert.equal(site.url,"https://harikathummalamd.com");
assert.equal(site.publicationReady,true);
let indexable=0;
for(const page of pages) {
 const file=path.join("dist",page.path.slice(1),"index.html");
 const html=await fs.readFile(file,"utf8");
 const seo=getSeo(page.path);
 if(seo.robots.startsWith("index,")) assert.equal((html.match(/<h1(?:\s|>)/g)||[]).length,1,page.path+" needs exactly one h1");
 assert.ok(!/not connected|later setup step|\[PLACEHOLDER:|supplied physician profile|will be provided when verified/i.test(html),page.path+" contains draft copy");
 assert.equal((html.match(/name="description"/g)||[]).length,1);
 assert.equal((html.match(/property="og:title"/g)||[]).length,1);
 if(seo.robots.startsWith("index,")) {
  indexable++;
  assert.ok(html.includes('rel="canonical" href="'+seo.canonical+'"'));
  const match=html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(match,page.path+" missing schema");assert.deepEqual(JSON.parse(match[1]),approvedSchema(page.path));
  assert.ok(html.includes('name="robots" content="index,follow,max-image-preview:large"'));
 } else assert.ok(html.includes('name="robots" content="noindex,nofollow"'));
 const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(match=>match[1]);
 assert.equal(new Set(ids).size,ids.length,page.path+" duplicate element IDs");
}
const sitemap=await fs.readFile("dist/sitemap.xml","utf8");
assert.equal((sitemap.match(/<loc>/g)||[]).length,sitemapPages().length);
assert.ok(!/\/(admin|staff|portal|preview|manage-request)(?:[<\/]|$)/.test(sitemap));
const robots=await fs.readFile("dist/robots.txt","utf8");
assert.ok(robots.includes("Sitemap: "+site.url+"/sitemap.xml"));
assert.ok(!robots.includes("Disallow: /\n"));
console.log("PASS SEO: "+pages.length+" pages, "+indexable+" indexable, canonical/social/schema/sitemap/noindex/content/ID checks");
