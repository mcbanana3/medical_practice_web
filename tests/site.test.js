import test from "node:test";
import assert from "node:assert/strict";

import {
  approvedSchema,
  escapeHtml,
  getSeo,
  pages,
  site,
  sitemapPages
} from "../src/site.js";

test("route paths are unique", () => {
  assert.equal(new Set(pages.map((page) => page.path)).size, pages.length);
});

test("preview is not indexable", () => {
  assert.equal(getSeo("/").robots, "noindex,nofollow");
  assert.equal(getSeo("/portal/login").robots, "noindex,nofollow");
});

test("unknown pages are not indexable", () => {
  assert.equal(getSeo("/not-a-page").robots, "noindex,nofollow");
});

test("preview sitemap is empty", () => {
  assert.deepEqual(sitemapPages(), []);
});

test("unverified structured data is not emitted", () => {
  assert.equal(approvedSchema(), null);
});

test("HTML values are escaped", () => {
  assert.equal(escapeHtml('<a title="x">&'), "&lt;a title=&quot;x&quot;&gt;&amp;");
});

test("sensitive routes remain excluded when publication is enabled", () => {
  const previousReady = site.publicationReady;
  const previousUrl = site.url;

  try {
    site.publicationReady = true;
    site.url = "https://example.com";

    assert.equal(getSeo("/portal/login").robots, "noindex,nofollow");
    assert.equal(getSeo("/manage-request").robots, "noindex,nofollow");

    const paths = sitemapPages().map((page) => page.path);
    assert.ok(paths.includes("/"));
    assert.ok(!paths.includes("/portal"));
    assert.ok(!paths.includes("/request-an-appointment/received"));
    assert.ok(!paths.includes("/privacy-practices"));
  } finally {
    site.publicationReady = previousReady;
    site.url = previousUrl;
  }
});

test("production public pages have distinct local-search metadata and canonical URLs", () => {
 const before={...site};
 try {
  site.publicationReady=true;site.verified=true;site.url="https://harikathummalamd.com";
  const titles=new Set(),descriptions=new Set();
  for(const page of sitemapPages()) {
   const seo=getSeo(page.path);
   assert.ok(seo.robots.startsWith("index,"));assert.ok(seo.canonical.startsWith(site.url));
   assert.ok(!titles.has(seo.title));assert.ok(!descriptions.has(seo.description));
   titles.add(seo.title);descriptions.add(seo.description);
   assert.ok(approvedSchema(page.path));
  }
  for(const path of ["/admin","/admin/patients","/staff/login","/staff/requests/"+"a".repeat(32),"/portal/appointments/"+"b".repeat(32),"/preview/states","/care/content-preview"]) {
   assert.equal(getSeo(path).robots,"noindex,nofollow");assert.equal(approvedSchema(path),null);
   assert.ok(!sitemapPages().some(page=>page.path===path));
  }
  const schema=JSON.stringify(approvedSchema("/contact"));
  assert.ok(schema.includes("BreadcrumbList"));assert.ok(schema.includes("79761"));
  assert.ok(!schema.includes("AggregateRating"));assert.ok(!schema.includes("reviewRating"));
  assert.equal(getSeo("/contact/").canonical,site.url+"/contact");
 } finally {Object.assign(site,before);}
});
