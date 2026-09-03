// The relay config's optimistic-concurrency contract.
//
// POST /api/comms/relay is a FULL REPLACE: an absent/empty `url` disables the relay,
// an omitted `secret` keeps the stored one. Until this version existed, two operators
// — or one operator with the card open in two tabs — silently overwrote each other:
// the last save won, the loser saw a green "Saved", and every candidate-facing message
// went to whichever endpoint happened to land second. Nothing recorded that it had
// happened.
//
// NON-VACUITY: against a store with no version re-check, `stale write is refused`
// fails — the second save is accepted and the URL becomes the stale caller's.
//
// unit-db is the FIRST project import (it points KP_DB_PATH at a throwaway file).
import "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { CommsRelayError, CommsRelayStaleError, getRelayConfig, setRelayConfig } from "../../../_lib/comms-relay-store.ts";

// The signing secret is encrypted at rest (ats-secret doctrine), which needs a key.
process.env.KP_ATS_SECRET_KEY = "unit-test-relay-key";

after(() => cleanupUnitDb());

test("a fresh store is version 0, and every accepted write bumps it", () => {
  assert.equal(getRelayConfig().version, 0);
  const first = setRelayConfig({ url: "https://relay.example/one", expectedVersion: 0 });
  assert.equal(first.url, "https://relay.example/one");
  assert.equal(first.version, 1);
  // A server-internal write with nothing to be stale about still works.
  assert.equal(setRelayConfig({ url: "https://relay.example/two" }).version, 2);
});

test("a stale write is REFUSED, and changes nothing", () => {
  setRelayConfig({ url: "https://relay.example/live", secret: "sign-me", expectedVersion: getRelayConfig().version });
  const live = getRelayConfig();
  assert.equal(live.hasSecret, true);

  // A second tab still holding the version from before that save.
  assert.throws(
    () => setRelayConfig({ url: "https://relay.example/clobber", expectedVersion: live.version - 1 }),
    (e: unknown) => e instanceof CommsRelayStaleError && e instanceof CommsRelayError
  );
  const after = getRelayConfig();
  assert.equal(after.url, live.url, "the stale write must not replace the stored endpoint");
  assert.equal(after.version, live.version, "a refused write does not bump the version");
  assert.equal(after.hasSecret, true, "…and does not clear the signing secret");

  // Re-read, then save: accepted.
  assert.equal(setRelayConfig({ url: "https://relay.example/next", expectedVersion: after.version }).version, after.version + 1);
});

test("a non-integer expectedVersion is a validation refusal, not a silent unchecked write", () => {
  const before = getRelayConfig();
  assert.throws(() => setRelayConfig({ url: "https://relay.example/x", expectedVersion: "soon" }), CommsRelayError);
  assert.equal(getRelayConfig().version, before.version);
});

test("the route answers the refusals and the 500 with CODES, never a raw message", () => {
  // The handler needs a request scope the unit runner cannot give it, so the contract
  // is asserted on the source — the shape rate-limit-contract.test.ts established.
  const src = readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  assert.match(src, /jsonRefusal\("COMMS_RELAY_STALE", 409/, "a stale write is a coded 409");
  assert.match(src, /jsonRefusal\("COMMS_RELAY_INVALID", 400, \{ detail: error\.message \}\)/, "the validator's prose rides as DATA");
  assert.match(src, /safeJsonError\(error, "api:comms:relay", "COMMS_RELAY_SAVE_FAILED"\)/, "the 500 is coded and logged, not forwarded");
  assert.equal(/NextResponse\.json\(\{ error: error/.test(src), false, "no raw thrown message on the wire");
  // The stale branch must be tested BEFORE the generic one: it subclasses it.
  assert.ok(
    src.indexOf("CommsRelayStaleError") < src.indexOf("error instanceof CommsRelayError"),
    "the subclass must be matched first, or a stale write answers 400"
  );
});
