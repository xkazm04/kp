import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEdgeBody, parseLinkBase, parseRelayBody, showLinkBaseWarning } from "./channelsNightReads.ts";

test("relay: the server's health word is kept, and an unknown word falls back to what the url proves", () => {
  assert.equal(parseRelayBody({ config: { url: "https://r.example.com", hasSecret: true, version: 3 }, relay: "unreadable" })?.relay, "unreadable");
  assert.equal(parseRelayBody({ config: { url: "https://r.example.com", hasSecret: false } })?.relay, "configured");
  assert.equal(parseRelayBody({ config: { url: null, hasSecret: false }, relay: "weird" })?.relay, "unconfigured");
  assert.deepEqual(parseRelayBody({ config: { url: null, hasSecret: false }, envConfigured: true, relay: "env" }), {
    url: "", hasSecret: false, envConfigured: true, version: 0, relay: "env", linkBase: null,
  });
});

test("relay and edge: a body without a config is unknown (null), never a default", () => {
  for (const body of [null, undefined, {}, { error: "Unauthorized" }, { code: "FORBIDDEN_CAPABILITY" }]) {
    assert.equal(parseRelayBody(body), null);
    assert.equal(parseEdgeBody(body), null);
  }
});

test("edge: every field is typed, a missing backlog stays unmeasured (null), never 0", () => {
  const e = parseEdgeBody({ config: { url: "https://e.example.dev", hasSecret: true, cursor: 12, lastErrorKind: "held" } });
  assert.deepEqual(e, {
    url: "https://e.example.dev", hasSecret: true, sealed: false, cursor: 12, lastDrainAt: null, lastHeartbeatAt: null,
    pending: null, lastErrorKind: "held", nudgeTarget: null, envConfigured: false, offline: false,
  });
  assert.equal(parseEdgeBody({ config: { pending: 0 } })?.pending, 0);
});

test("link base: the verdict is parsed strictly and the warning needs a sender AND a problem", () => {
  const cfg = { url: "https://r.example.com", hasSecret: true };
  assert.equal(parseRelayBody({ config: cfg, linkBase: { problem: "loopback" } })?.linkBase, "loopback");
  assert.equal(parseRelayBody({ config: cfg, linkBase: { problem: "placeholder" } })?.linkBase, "placeholder");
  assert.equal(parseRelayBody({ config: cfg, linkBase: { problem: null } })?.linkBase, null);
  assert.equal(parseRelayBody({ config: cfg })?.linkBase, null);
  assert.equal(parseLinkBase({ linkBase: { problem: "weird" } }), null);
  assert.equal(showLinkBaseWarning(true, "loopback"), true);
  assert.equal(showLinkBaseWarning(true, null), false); // APP_BASE_URL set to a public origin
  assert.equal(showLinkBaseWarning(false, "loopback"), false); // keyless: no sender
});
