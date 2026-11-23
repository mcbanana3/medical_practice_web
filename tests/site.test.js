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