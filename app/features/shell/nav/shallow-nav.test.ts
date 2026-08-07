import { test } from "node:test";
import assert from "node:assert/strict";
import { isSameDocumentUrl } from "./shallow-nav.ts";

// The whole safety of the shallow path rests on this predicate: say "yes" to a URL
// that actually needs the server and the destination never renders (the URL bar
// changes and nothing else happens). So the rule is deliberately conservative —
// only a URL that provably keeps the current pathname qualifies.

test("a query patch on the same path is same-document (the workspace's ?tab= switch)", () => {
  assert.equal(isSameDocumentUrl("/?tab=channels", "/"), true);
  assert.equal(isSameDocumentUrl("/", "/"), true);
  assert.equal(isSameDocumentUrl("/?tab=pipeline&q=novak&quick=aging", "/"), true);
});

test("a bare ?/# patch carries no path, so it is always same-document", () => {
  assert.equal(isSameDocumentUrl("?tab=jobs", "/anything"), true);
  assert.equal(isSameDocumentUrl("#section", "/anything"), true);
});

test("a different pathname needs the router — that is a real navigation", () => {
  assert.equal(isSameDocumentUrl("/jds/abc", "/"), false);
  assert.equal(isSameDocumentUrl("/?tab=jobs", "/market"), false);
  assert.equal(isSameDocumentUrl("/market?tab=jobs", "/"), false);
});

test("the hash and query are stripped before the path comparison", () => {
  assert.equal(isSameDocumentUrl("/#top", "/"), true);
  assert.equal(isSameDocumentUrl("/?tab=jobs#top", "/"), true);
  assert.equal(isSameDocumentUrl("/other#top", "/"), false);
});

test("anything leaving the app is never same-document", () => {
  assert.equal(isSameDocumentUrl("https://example.com/?tab=jobs", "/"), false);
  assert.equal(isSameDocumentUrl("//example.com/?tab=jobs", "/"), false);
  assert.equal(isSameDocumentUrl("mailto:someone@example.com", "/"), false);
});

test("a path-relative URL is refused — it resolves against the current directory", () => {
  assert.equal(isSameDocumentUrl("jobs?x=1", "/"), false);
  assert.equal(isSameDocumentUrl("./?tab=jobs", "/"), false);
});
