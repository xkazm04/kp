import "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { isRelayConfigured, relayHealth, resolveRelay } from "./comms-relay.ts";
import { cleanupUnitDb } from "./testing/unit-db.ts";

after(() => cleanupUnitDb());
import { getRelayConfig, setRelayConfig, getRelaySecret, CommsRelayError } from "./comms-relay-store.ts";

// The relay capability bit (env → stored config → nothing) AND the health word
// the operator surfaces read. This is the ONE source every "sent" claim and the
// comms channel selection key off, so its precedence contract is locked here
// (moved from comms-truth.test.ts when the env-only isRelayConfigured grew the
// stored-config leg).

test("unconfigured: no env, no stored config → not configured", () => {
  delete process.env.COMMS_WEBHOOK_URL;
  assert.equal(isRelayConfigured(), false);
  assert.equal(resolveRelay(), null);
});

test("COMMS_WEBHOOK_URL env keeps precedence over stored config", () => {
  try {
    setRelayConfig({ url: "https://relay.example/stored" });
    process.env.COMMS_WEBHOOK_URL = "https://relay.example/env";
    const relay = resolveRelay();
    assert.equal(relay?.url, "https://relay.example/env");
    assert.equal(relay?.source, "env");
  } finally {
    delete process.env.COMMS_WEBHOOK_URL;
    setRelayConfig({ url: "" });
  }
});

test("stored config configures the relay when env is unset", () => {
  delete process.env.COMMS_WEBHOOK_URL;
  try {
    setRelayConfig({ url: "https://relay.example/hook" });
    assert.equal(isRelayConfigured(), true);
    const relay = resolveRelay();
    assert.equal(relay?.url, "https://relay.example/hook");
    assert.equal(relay?.source, "config");
    // Clearing the URL disables it again.
    setRelayConfig({ url: "" });
    assert.equal(isRelayConfigured(), false);
  } finally {
    setRelayConfig({ url: "" });
  }
});

test("secret doctrine: public view exposes hasSecret only; omit keeps, empty clears", () => {
  // At-rest encryption needs a key (shared ats-secret helpers).
  process.env.KP_ATS_SECRET_KEY = "unit-test-relay-key";
  try {
    setRelayConfig({ url: "https://relay.example/hook", secret: "topsecret" });
    const pub = getRelayConfig();
    assert.equal(pub.hasSecret, true);
    assert.ok(!("secret" in pub), "public view must not carry the secret");
    assert.equal(getRelaySecret(), "topsecret");
    // Omitted secret → kept.
    setRelayConfig({ url: "https://relay.example/hook2" });
    assert.equal(getRelaySecret(), "topsecret");
    // Empty string → cleared.
    setRelayConfig({ url: "https://relay.example/hook2", secret: "" });
    assert.equal(getRelaySecret(), null);
    assert.equal(getRelayConfig().hasSecret, false);
  } finally {
    setRelayConfig({ url: "", secret: "" });
    delete process.env.KP_ATS_SECRET_KEY;
  }
});

test("write boundary rejects non-https and internal endpoints (SSRF guard)", () => {
  assert.throws(() => setRelayConfig({ url: "http://relay.example/hook" }), CommsRelayError);
  assert.throws(() => setRelayConfig({ url: "https://127.0.0.1/hook" }), CommsRelayError);
  assert.throws(() => setRelayConfig({ url: "not a url" }), CommsRelayError);
});

// ---------------------------------------------------------------------------
// HEALTH — the word the operator surfaces read.
//
// WHY: a deployment whose KP_SECRET / KP_ATS_SECRET_KEY was rotated (or restored
// onto a host with a rebuilt env) can no longer decrypt the stored relay signing
// secret. The resolver swallowed that into `null` — the SAME answer as "no relay
// configured" — so every letter was honestly recorded `queued`, the Channels card
// said "Not configured", and nothing anywhere named the cause. An operator's only
// signal was that mail stopped.
//
// NON-VACUITY: against the old resolver both halves fail — health is "unconfigured"
// and the catch logs nothing.

/** Capture console.error for the duration of `fn`. */
function captureErrors(fn: () => void): string[] {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  try {
    fn();
  } finally {
    console.error = original;
  }
  return lines;
}

test("an empty store is 'unconfigured' — and says nothing", () => {
  const lines = captureErrors(() => {
    assert.equal(relayHealth(), "unconfigured");
    assert.equal(resolveRelay(), null);
  });
  assert.deepEqual(lines, [], "a deployment with no relay is not a fault to log");
});

test("a readable stored relay is 'configured', secret and all", () => {
  // At-rest encryption needs a key, and the secret-doctrine test above deletes it.
  process.env.KP_ATS_SECRET_KEY = "unit-test-relay-key";
  setRelayConfig({ url: "https://relay.example/live", secret: "sign-me" });
  assert.equal(relayHealth(), "configured");
  assert.deepEqual(resolveRelay(), { url: "https://relay.example/live", secret: "sign-me", source: "config" });
});

test("an undecryptable secret is 'unreadable', NOT 'unconfigured', and is logged once with a remedy", () => {
  // The deployment secret rotated under the stored ciphertext: same row, different key.
  process.env.KP_ATS_SECRET_KEY = "a-different-deployment-secret";
  try {
    const lines = captureErrors(() => {
      assert.equal(relayHealth(), "unreadable", "the relay IS configured — it is the secret we cannot read");
      // Still no relay handed to the send path: an unsigned POST to a relay that
      // expects a signature is a worse lie than an honest queue.
      assert.equal(resolveRelay(), null);
      // Repeat reads (every capability check, every letter) must not spam the log.
      relayHealth();
      resolveRelay();
    });
    assert.equal(lines.length, 1, `exactly one line per boot per reason, got ${lines.length}`);
    const line = lines[0];
    assert.match(line, /comms-relay/, "the log names the subsystem");
    assert.match(line, /decrypt/i, "…and the reason");
    assert.match(line, /KP_ATS_SECRET_KEY/, "…and the key that would open it");
    assert.match(line, /KP_SECRET/, "…including the fallback key");
    assert.match(line, /secrets:rotate/, "…and the command that repairs it");
  } finally {
    process.env.KP_ATS_SECRET_KEY = "unit-test-relay-key";
  }
});

test("the env override wins and is never called unreadable", () => {
  process.env.COMMS_WEBHOOK_URL = "https://env-relay.example/hook";
  try {
    assert.equal(relayHealth(), "env");
    assert.equal(resolveRelay()?.source, "env");
  } finally {
    delete process.env.COMMS_WEBHOOK_URL;
  }
});
