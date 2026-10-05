// The relay and edge editors' decisions (setupDelivery.ts): the blank-save guards, the test ping's
// truth, the 409 adopt, the drain's status-first refusal and the depot's scene. Each case is a bug the
// retired cards once shipped (their comments name them).
import { test } from "node:test";
import assert from "node:assert/strict";
import { EDGE_ERROR_KINDS } from "@/app/_lib/edge-config";
import { DRAIN_FAIL_KEY } from "../channelsNightCopy.ts";
import type { EdgeState, RelayState } from "../channelsNightReads.ts";
import {
  canSaveEdge, canSaveRelay, drainOutcome, edgeCursorValue, edgeSaveBody, edgeView, relayDirty, relaySaveBody, relaySaveOutcome, relayScene, relayTestGate, relayTestOutcome,
} from "./setupDelivery.ts";

const relay = (over: Partial<RelayState> = {}): RelayState => ({ url: "https://relay.example.com/hooks/kp", hasSecret: true, envConfigured: false, version: 3, relay: "configured", ...over });
const edge = (over: Partial<EdgeState> = {}): EdgeState => ({
  url: "https://edge.example.workers.dev", hasSecret: true, sealed: false, cursor: 12, lastDrainAt: null, lastHeartbeatAt: null, pending: null,
  lastErrorKind: null, nudgeTarget: null, envConfigured: false, offline: false, ...over,
});

test("a blank relay URL saves only over a config that was read (it disables the relay)", () => {
  assert.equal(canSaveRelay(null, "", false), false);
  assert.equal(canSaveRelay(null, "https://r", false), true);
  assert.equal(canSaveRelay(relay(), "", false), true);
  assert.equal(canSaveRelay(relay(), "https://r", true), false);
});

test("the relay body sends the secret only when typed and the version only when read", () => {
  assert.deepEqual(relaySaveBody(null, " https://r ", ""), { url: "https://r" });
  assert.deepEqual(relaySaveBody(relay(), "https://r", "s3cret"), { url: "https://r", secret: "s3cret", expectedVersion: 3 });
});

test("the test ping waits for a saved, readable relay and for the draft to be saved", () => {
  assert.equal(relayTestGate(null, false, false), "noRelay");
  assert.equal(relayTestGate(relay({ url: "" }), false, false), "noRelay");
  assert.equal(relayTestGate(relay({ url: "", envConfigured: true, relay: "env" }), false, false), "ok");
  assert.equal(relayTestGate(relay({ relay: "unreadable" }), false, false), "unreadable");
  assert.equal(relayTestGate(relay(), true, false), "unsaved");
  assert.equal(relayTestGate(relay(), false, true), "busy");
  assert.equal(relayDirty(relay(), "https://relay.example.com/hooks/kp ", ""), false);
  assert.equal(relayDirty(relay(), "https://other", ""), true);
  assert.equal(relayDirty(relay(), "https://relay.example.com/hooks/kp", "x"), true);
  assert.equal(relayDirty(null, "", ""), false);
});

test("a save is saved only with the config envelope; a 409 is stale, anything else refused", () => {
  assert.deepEqual(relaySaveOutcome(200, { ok: true, config: { url: "https://r" } }), { kind: "saved" });
  assert.equal(relaySaveOutcome(200, { ok: true }).kind, "refused");
  assert.equal(relaySaveOutcome(409, { code: "COMMS_RELAY_STALE", config: {} }).kind, "stale");
  assert.deepEqual(relaySaveOutcome(400, { code: "COMMS_RELAY_INVALID", error: "English" }), { kind: "refused", body: { code: "COMMS_RELAY_INVALID", error: "English" } });
});

test("the test ping's answer is the verdict: 2xx sent, a code refused, anything else failed", () => {
  assert.deepEqual(relayTestOutcome({ ok: true, status: 202 }, 200), { kind: "sent", status: 202 });
  assert.deepEqual(relayTestOutcome({ ok: false, status: 502 }), { kind: "failed", reason: "HTTP 502" });
  assert.deepEqual(relayTestOutcome({ ok: false, reason: "timeout after 8000ms" }), { kind: "failed", reason: "timeout after 8000ms" });
  // A refusal is about the caller: it carries a code and no status, never "HTTP ?".
  assert.deepEqual(relayTestOutcome({ error: "Forbidden", code: "FORBIDDEN" }), { kind: "refused", body: { code: "FORBIDDEN" } });
  assert.deepEqual(relayTestOutcome(null), { kind: "failed", reason: "network" });
  // With the HTTP status known, an unknown code can still be worded as "HTTP 429", never as the raw code.
  assert.deepEqual(relayTestOutcome({ code: "SOME_NEW_CODE" }, 429), { kind: "refused", body: { code: "SOME_NEW_CODE" }, status: 429 });
});

test("the depot lifts its barrier for a configured relay and rolls its shutter only on proof", () => {
  assert.deepEqual(relayScene("off", "sent"), { condition: "off", gateUp: false, answered: false });
  assert.deepEqual(relayScene("fail", "sent"), { condition: "fail", gateUp: false, answered: false });
  assert.deepEqual(relayScene("wait", null), { condition: "wait", gateUp: true, answered: false });
  assert.deepEqual(relayScene("wait", "failed"), { condition: "wait", gateUp: true, answered: false });
  assert.deepEqual(relayScene("wait", "sent"), { condition: "live", gateUp: true, answered: true });
  assert.deepEqual(relayScene("live", null), { condition: "live", gateUp: true, answered: false });
  assert.deepEqual(relayScene("unknown", "sent"), { condition: "unknown", gateUp: false, answered: false });
});

test("the edge is paired only with a URL and a secret; offline wins", () => {
  assert.equal(edgeView(null).status, null);
  assert.equal(edgeView(edge({ url: "" })).status, "off");
  assert.equal(edgeView(edge({ hasSecret: false })).status, "secretMissing");
  assert.equal(edgeView(edge()).status, "paired");
  assert.equal(edgeView(edge({ offline: true })).status, "offline");
  assert.equal(edgeView(edge({ url: "", envConfigured: true })).paired, true);
});

test("the edge body trims, keeps the secret when blank, and never saves a blank over an unread config", () => {
  assert.deepEqual(edgeSaveBody(" https://e ", "", " https://ntfy.sh/x "), { url: "https://e", nudgeTarget: "https://ntfy.sh/x" });
  assert.deepEqual(edgeSaveBody("https://e", "s", ""), { url: "https://e", secret: "s", nudgeTarget: "" });
  assert.equal(canSaveEdge(null, " ", false), false);
  assert.equal(canSaveEdge(edge(), "", false), true);
});

test("a drain is judged by its status first: a refusal with no summary is never a quiet queue", () => {
  assert.deepEqual(drainOutcome(false, { error: "Forbidden", code: "FORBIDDEN" }), { kind: "refused", body: { error: "Forbidden", code: "FORBIDDEN" } });
  assert.deepEqual(drainOutcome(false, null), { kind: "refused", body: null });
  assert.deepEqual(drainOutcome(true, { summary: { applied: 0, skipped: 0, error: "HTTP 502", errorKind: "unreachable" } }), { kind: "failed", errorKind: "unreachable" });
  assert.deepEqual(drainOutcome(false, { summary: { error: "x", errorKind: "secret_unreadable" } }), { kind: "failed", errorKind: "secret_unreadable" });
  assert.equal(drainOutcome(true, { summary: { error: "x" } }).kind, "refused");
  assert.deepEqual(drainOutcome(true, { summary: { applied: 3, skipped: 1, error: null } }), { kind: "drained", applied: 3, skipped: 1 });
});

test("every edge failure class has a sentence", () => {
  for (const kind of EDGE_ERROR_KINDS) assert.ok(DRAIN_FAIL_KEY[kind], kind);
});

test("the drain cursor: 'never drained' comes from the last drain, not from a cursor of 0", () => {
  assert.equal(edgeCursorValue(edge({ cursor: 0, lastDrainAt: "2026-09-29T11:46:00.000Z" })), "0", "drained, nothing applied yet: the cursor is a real 0");
  assert.equal(edgeCursorValue(edge({ cursor: 0, lastDrainAt: null })), null, "never drained");
  assert.equal(edgeCursorValue(edge({ cursor: 1284, lastDrainAt: "2026-09-29T11:46:00.000Z" })), "1284");
  assert.equal(edgeCursorValue(edge({ cursor: 12, lastDrainAt: null })), "12", "a cursor that moved was drained, whatever the timestamp says");
});
