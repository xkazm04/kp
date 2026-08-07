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
import { safeHttpUrl, safeHttpLinks, assertPublicHttpsEndpoint } from "./safe-url.ts";

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

// assertPublicHttpsEndpoint guards a server-fetched provider endpoint (e.g. Azure
// OpenAI). It is stricter than safeHttpUrl because the server will call it WITH a
// bearer key — the SSRF + key-exfil pivots (metadata IP, loopback, LAN, attacker
// host over http) must all be rejected at store time.
test("assertPublicHttpsEndpoint accepts a public https host", () => {
  assert.equal(
    assertPublicHttpsEndpoint("https://my-resource.openai.azure.com"),
    "https://my-resource.openai.azure.com/",
  );
});

test("assertPublicHttpsEndpoint rejects non-https and bad URLs", () => {
  assert.throws(() => assertPublicHttpsEndpoint("http://my-resource.openai.azure.com"), /https/);
  assert.throws(() => assertPublicHttpsEndpoint("not a url"), /not a URL/);
  assert.throws(() => assertPublicHttpsEndpoint("ftp://example.com"), /https/);
});

test("assertPublicHttpsEndpoint rejects the SSRF pivots: metadata IP, loopback, LAN, IPv6", () => {
  assert.throws(() => assertPublicHttpsEndpoint("https://169.254.169.254/latest/meta-data"), /IP address/);
  assert.throws(() => assertPublicHttpsEndpoint("https://127.0.0.1"), /IP address/);
  assert.throws(() => assertPublicHttpsEndpoint("https://10.0.0.5"), /IP address/);
  assert.throws(() => assertPublicHttpsEndpoint("https://192.168.1.1"), /IP address/);
  assert.throws(() => assertPublicHttpsEndpoint("https://[::1]/"), /IP address/);
});

test("assertPublicHttpsEndpoint rejects numeric IP encodings that resolve to loopback", () => {
  // 127.0.0.1 in disguise — the OS resolver expands all of these back to an IP.
  assert.throws(() => assertPublicHttpsEndpoint("https://2130706433/"), /IP address/); // 32-bit integer
  assert.throws(() => assertPublicHttpsEndpoint("https://0x7f000001/"), /IP address/); // hex
  assert.throws(() => assertPublicHttpsEndpoint("https://127.1/"), /IP address/); // class-collapsed short form
  assert.throws(() => assertPublicHttpsEndpoint("https://127.0.1/"), /IP address/); // 3-octet short form
});

test("assertPublicHttpsEndpoint rejects internal/loopback hostnames", () => {
  assert.throws(() => assertPublicHttpsEndpoint("https://localhost"), /internal\/loopback/);
  assert.throws(() => assertPublicHttpsEndpoint("https://db.internal"), /internal\/loopback/);
  assert.throws(() => assertPublicHttpsEndpoint("https://printer.local"), /internal\/loopback/);
});
