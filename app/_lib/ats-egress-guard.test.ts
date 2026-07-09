// Locks the SSRF guard on the ATS outbound-webhook surface. Before this fix the
// only vetting was `validateUrl` in ats-config-store, which checked the scheme
// alone — it *accepted* `http://`, bare IPs, loopback and RFC-1918 hosts and
// returned them unchanged, so `/api/ats/test` became an authenticated probe into
// the internal network + cloud metadata (169.254.169.254). The write boundary now
// routes through `assertPublicHttpsEndpoint`; delivery additionally resolves the
// host to close DNS rebinding.
//
// NON-VACUOUS CHECK: every rejection below is a URL the OLD `validateUrl` would
// have RETURNED (not thrown) — `http://…`, `http://169.254.169.254/…`,
// `http://127.0.0.1`, `http://10.0.0.1`, `http://192.168.1.1`, `https://[::1]`
// all satisfy its `protocol === http|https` test. So wiring these asserts to the
// old guard would fail (no throw). The guard is what makes them throw.
//
// Runner: Node's built-in test runner with type stripping (see package.json
// test:unit). This module stays import-light (only ./safe-url.ts + a lazy
// node:dns) so it loads without better-sqlite3.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertPublicHttpsEndpoint } from "./safe-url.ts";
import { isPrivateAddress, assertDeliverableWebhookUrl } from "./ats-egress-guard.ts";

// --- The write-boundary guard the ATS config store now delegates to -------------
// (validateUrl -> assertPublicHttpsEndpoint). These are the exact SSRF pivots from
// the finding; each MUST be rejected, and a normal public https webhook accepted.

test("webhook write-guard rejects http:// (cleartext PII egress)", () => {
  assert.throws(() => assertPublicHttpsEndpoint("http://hooks.example.com/x", "webhookUrl"), /https/);
});

test("webhook write-guard rejects the cloud metadata endpoint", () => {
  // http:// form (as the finding's exploit uses) and the https:// literal-IP form.
  assert.throws(() => assertPublicHttpsEndpoint("http://169.254.169.254/latest/meta-data", "webhookUrl"), /https|IP address/);
  assert.throws(() => assertPublicHttpsEndpoint("https://169.254.169.254/latest/meta-data", "webhookUrl"), /IP address/);
});

test("webhook write-guard rejects loopback / RFC-1918 / IPv6 loopback", () => {
  assert.throws(() => assertPublicHttpsEndpoint("http://127.0.0.1", "webhookUrl"), /https|IP address/);
  assert.throws(() => assertPublicHttpsEndpoint("http://10.0.0.1", "webhookUrl"), /https|IP address/);
  assert.throws(() => assertPublicHttpsEndpoint("http://192.168.1.1", "webhookUrl"), /https|IP address/);
  assert.throws(() => assertPublicHttpsEndpoint("https://[::1]", "webhookUrl"), /IP address/);
  assert.throws(() => assertPublicHttpsEndpoint("https://127.0.0.1", "webhookUrl"), /IP address/);
});

test("webhook write-guard accepts a normal public https webhook", () => {
  assert.equal(assertPublicHttpsEndpoint("https://hooks.example.com/x", "webhookUrl"), "https://hooks.example.com/x");
});

// --- DNS-rebind classifier ------------------------------------------------------
// isPrivateAddress vets each address the webhook host RESOLVES to at delivery
// time — this is what closes `https://rebind.attacker.com` -> 169.254.169.254.

test("isPrivateAddress flags every non-public range (v4, v6, IPv4-mapped)", () => {
  for (const ip of [
    "0.0.0.0",
    "127.0.0.1",
    "10.0.0.1",
    "172.16.5.4",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", // CGNAT
    "::1", // v6 loopback
    "::", // v6 unspecified
    "fd00::1", // ULA
    "fe80::1", // link-local
    "::ffff:169.254.169.254", // IPv4-mapped metadata
  ]) {
    assert.equal(isPrivateAddress(ip), true, `${ip} should be private`);
  }
});

test("isPrivateAddress allows genuine public addresses", () => {
  for (const ip of [
    "93.184.216.34", // example.com
    "8.8.8.8",
    "172.15.0.1", // just below 172.16/12
    "172.32.0.1", // just above
    "2606:2800:220:1:248:1893:25c8:1946", // example.com v6
  ]) {
    assert.equal(isPrivateAddress(ip), false, `${ip} should be public`);
  }
});

// --- Delivery-time guard rejects string-level pivots BEFORE any DNS lookup -------
// (These reject in the assertPublicHttpsEndpoint stage, so the test never touches
// the network. The DNS-resolution branch is covered by isPrivateAddress above.)

test("assertDeliverableWebhookUrl rejects http/IP/internal without hitting the network", async () => {
  await assert.rejects(assertDeliverableWebhookUrl("http://hooks.example.com/x"), /https/);
  await assert.rejects(assertDeliverableWebhookUrl("http://169.254.169.254/latest/meta-data"), /https|IP address/);
  await assert.rejects(assertDeliverableWebhookUrl("https://127.0.0.1"), /IP address/);
  await assert.rejects(assertDeliverableWebhookUrl("https://localhost"), /internal\/loopback/);
});
