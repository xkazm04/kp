// Locks the render-time URL guard that stands between model-supplied source
// strings and a clickable anchor href. The contract: only well-formed http(s)
// URLs survive (everything else is dropped), and what survives carries a bare
// hostname for the link text so a destination can never be disguised behind an
// opaque "Source N" label. The dangerous-scheme cases (javascript:, data:) are
// the whole reason this module exists — guard them explicitly.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { safeHttpUrl, safeHttpLinks } from "./safe-url.ts";

test("http(s) URLs pass and expose href + bare hostname", () => {
  assert.deepEqual(safeHttpUrl("https://www.glassdoor.com/Salaries"), {
    href: "https://www.glassdoor.com/Salaries",
    hostname: "glassdoor.com",
  });
  assert.deepEqual(safeHttpUrl("http://platy.cz/"), {
    href: "http://platy.cz/",
    hostname: "platy.cz",
  });
});

test("dangerous schemes are rejected", () => {
  // These are the XSS payloads: a model emitting one of these used to execute
  // on click. They MUST return null so the caller drops the link.
  assert.equal(safeHttpUrl("javascript:alert(1)"), null);
  assert.equal(safeHttpUrl("JavaScript:alert(1)"), null); // scheme is case-insensitive
  assert.equal(safeHttpUrl("data:text/html,<script>alert(1)</script>"), null);
  assert.equal(safeHttpUrl("vbscript:msgbox(1)"), null);
});

test("non-web but harmless schemes are also dropped (only http/https link)", () => {
  assert.equal(safeHttpUrl("mailto:a@b.com"), null);
  assert.equal(safeHttpUrl("tel:+420123456789"), null);
  assert.equal(safeHttpUrl("file:///etc/passwd"), null);
  assert.equal(safeHttpUrl("ftp://example.com/x"), null);
});

test("malformed / scheme-less strings are dropped", () => {
  assert.equal(safeHttpUrl(""), null);
  assert.equal(safeHttpUrl("not a url"), null);
  assert.equal(safeHttpUrl("glassdoor.com/salaries"), null); // no scheme -> not parseable as absolute
  assert.equal(safeHttpUrl("//evil.com"), null); // protocol-relative, no base
  assert.equal(safeHttpUrl("http://"), null); // host-less
});

test("scheme/host are normalized so display is predictable", () => {
  const link = safeHttpUrl("HTTP://Example.COM/Path?q=1");
  assert.equal(link?.hostname, "example.com");
  assert.equal(link?.href, "http://example.com/Path?q=1");
});

test("safeHttpLinks keeps the good ones in order and drops the rest", () => {
  const links = safeHttpLinks([
    "https://glassdoor.com",
    "javascript:alert(1)", // dropped
    "https://platy.cz",
    "not a url", // dropped
  ]);
  assert.deepEqual(
    links.map((l) => l.hostname),
    ["glassdoor.com", "platy.cz"],
  );
});

test("safeHttpLinks on an all-bad list yields an empty array", () => {
  assert.deepEqual(safeHttpLinks(["javascript:alert(1)", "", "data:x"]), []);
});
