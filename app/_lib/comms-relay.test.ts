// The relay resolver's HEALTH vocabulary.
//
// WHY: a deployment whose KP_SECRET / KP_ATS_SECRET_KEY was rotated (or restored
// onto a host with a rebuilt env) can no longer decrypt the stored relay signing
// secret. The resolver swallowed that into `null` — the SAME answer as "no relay
// configured" — so every letter was honestly recorded `queued`, the Channels card
// said "Not configured", and nothing anywhere named the cause. An operator's only
// signal was that mail stopped.
//
// NON-VACUITY: against the old resolver both assertions below fail — health is
// "unconfigured" and the catch logs nothing.
//
// unit-db is the FIRST project import (it points KP_DB_PATH at a throwaway file).
import "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { relayHealth, resolveRelay } from "./comms-relay.ts";
import { setRelayConfig } from "./comms-relay-store.ts";

process.env.KP_ATS_SECRET_KEY = "unit-test-relay-key";

after(() => cleanupUnitDb());

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
