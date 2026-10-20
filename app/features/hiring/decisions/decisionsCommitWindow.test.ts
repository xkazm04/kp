// Pins the Decisions tab's commit window (decisions-review-ui/B, challenge-r04): a
// quick decision is ARMED on the click and written only when its stated window
// closes. Undo inside the window issues nothing at all, a second decision flushes
// the first, a double click cannot arm twice, and leaving COMMITS rather than drops.
//
// Non-vacuity: before this module the ledger's ✕ and the candidate modal's Reject
// called act() on the click - sealed, emailed and ATS-synced with no way back - and
// nothing in the tab could defer a write.
//
// Runner: Node's built-in test runner (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DECISION_UNDO_MS,
  arm,
  commitDecision,
  expire,
  hiddenIds,
  initialWindow,
  settled,
  teardown,
  undo,
} from "./decisionsCommitWindow.ts";

const A = { entryId: "a", action: "reject" as const, label: "Ana", expectedStage: "Screened" };
const B = { entryId: "b", action: "accept" as const, label: "Ben", expectedStage: "Interview" };
const commitOf = (c: { kind: string; entryId: string; action: string }) => ({ kind: c.kind, entryId: c.entryId, action: c.action });
const pendingA = () => arm(initialWindow(), A, 0).state;

test("1. arming writes nothing and hides the row", () => {
  const { state, commands } = arm(initialWindow(), A, 0);
  assert.equal(state.kind, "pending");
  assert.ok(state.kind === "pending");
  assert.equal(state.entryId, "a");
  assert.equal(state.action, "reject");
  assert.equal(state.deadline, DECISION_UNDO_MS);
  assert.deepEqual(commands, [], "nothing is written at arming");
  assert.deepEqual([...hiddenIds(state)], ["a"]);
});

test("2. undo inside the window issues no commit and brings the row back", () => {
  const { state, commands } = undo(pendingA());
  assert.equal(state.kind, "idle");
  assert.deepEqual(commands, []);
  assert.equal(hiddenIds(state).size, 0);
  // …and nothing is issued for a later either: the timer's expire on an idle window is inert.
  assert.deepEqual(expire(state, DECISION_UNDO_MS * 2).commands, []);
});

test("3. expire commits exactly at the deadline, not a millisecond before", () => {
  const early = expire(pendingA(), DECISION_UNDO_MS - 1);
  assert.equal(early.state.kind, "pending");
  assert.deepEqual(early.commands, []);
  const due = expire(pendingA(), DECISION_UNDO_MS);
  assert.equal(due.state.kind, "committing");
  assert.ok(due.state.kind === "committing");
  assert.equal(due.state.entryId, "a");
  assert.deepEqual(due.commands.map(commitOf), [{ kind: "commit", entryId: "a", action: "reject" }]);
  assert.equal(due.commands[0].expectedStage, "Screened", "the CAS snapshot rides the command");
});

test("4. a second decision flushes the first, then arms (one window, naming the latest)", () => {
  const { state, commands } = arm(pendingA(), B, 1000);
  assert.deepEqual(commands.map(commitOf), [{ kind: "commit", entryId: "a", action: "reject" }]);
  assert.equal(state.kind, "pending");
  assert.ok(state.kind === "pending");
  assert.equal(state.entryId, "b");
  assert.equal(state.deadline, 1000 + DECISION_UNDO_MS);
  const undone = undo(state);
  assert.deepEqual(undone.commands, []);
  // Only b is restored; a is committed and stays hidden until its commit settles.
  assert.deepEqual([...hiddenIds(undone.state)], ["a"]);
});

test("5. a double click (or a click on a committing row) cannot arm twice", () => {
  const p = pendingA();
  const again = arm(p, { ...A }, 50);
  assert.equal(again.state, p, "state unchanged");
  assert.deepEqual(again.commands, []);
  const committing = expire(pendingA(), DECISION_UNDO_MS).state;
  const onCommitting = arm(committing, { ...A, action: "accept" }, DECISION_UNDO_MS + 5);
  assert.equal(onCommitting.state, committing);
  assert.deepEqual(onCommitting.commands, []);
});

test("6. teardown flushes a pending decision and never cancels it", () => {
  const { state, commands } = teardown(pendingA());
  assert.deepEqual(commands.map(commitOf), [{ kind: "commit", entryId: "a", action: "reject" }]);
  assert.equal(state.kind, "committing");
  assert.deepEqual(teardown(initialWindow()).commands, []);
  assert.deepEqual(teardown(state).commands, [], "a committing window is not committed twice");
});

test("7. a failed commit brings the row back and names it; a landed one clears the failure", () => {
  const committing = expire(pendingA(), DECISION_UNDO_MS).state;
  const failed = settled(committing, { entryId: "a", ok: false, failure: { code: "PIPELINE_STAGE_CHANGED", capability: null, status: 409 } });
  assert.equal(failed.state.kind, "idle");
  assert.equal(hiddenIds(failed.state).has("a"), false, "the row reappears");
  assert.equal(failed.state.lastFailure?.entryId, "a");
  const landed = settled(committing, { entryId: "a", ok: true });
  assert.equal(landed.state.kind, "idle");
  assert.equal(landed.state.lastFailure, null);
  // A flushed decision settles while a newer one is pending: the pending one is untouched.
  const flushed = arm(pendingA(), B, 10).state;
  const late = settled(flushed, { entryId: "a", ok: false, failure: { code: null, capability: null, status: null } });
  assert.equal(late.state.kind, "pending");
  assert.deepEqual([...hiddenIds(late.state)], ["b"]);
  assert.equal(late.state.lastFailure?.entryId, "a");
});

test("8. the interval is 5-10 s and every catalog states it with the name before it runs", () => {
  assert.ok(DECISION_UNDO_MS >= 5000 && DECISION_UNDO_MS <= 10000, `DECISION_UNDO_MS=${DECISION_UNDO_MS}`);
  for (const locale of ["en", "cs", "de", "fr"]) {
    const cat = JSON.parse(readFileSync(new URL(`../../../../messages/${locale}.json`, import.meta.url), "utf8"));
    const pending = cat?.decisions?.undo?.pending;
    assert.equal(typeof pending, "string", `${locale}: decisions.undo.pending`);
    assert.match(pending, /\{seconds\}/, `${locale}: states the interval`);
    assert.match(pending, /\{name\}/, `${locale}: names the candidate`);
  }
});

test("9. the window commits through commitDecision (keepalive POST with the CAS), never through act()", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ code: "PIPELINE_STAGE_CHANGED" }), { status: 409 });
  }) as unknown as typeof fetch;
  const out = await commitDecision("a", "reject", "Screened", fakeFetch);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/pipeline/a");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.keepalive, true, "the request survives the page going away");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { action: "reject", expectedStage: "Screened" });
  assert.deepEqual(out, { ok: false, failure: { code: "PIPELINE_STAGE_CHANGED", capability: null, status: 409 } });
  const dropped = await commitDecision("a", "reject", "Screened", (async () => {
    throw new TypeError("offline");
  }) as unknown as typeof fetch);
  assert.deepEqual(dropped, { ok: false, failure: { code: null, capability: null, status: null } }, "a dropped request is a failure, never a throw");

  const mod = readFileSync(new URL("./decisionsCommitWindow.ts", import.meta.url), "utf8");
  const fn = mod.slice(mod.indexOf("export async function commitDecision"));
  assert.match(fn, /keepalive: true/, "the literal is pinned");
  const store = readFileSync(new URL("./useDecisionCommitWindow.ts", import.meta.url), "utf8");
  assert.match(store, /commitDecision\(/, "the store commits through commitDecision");
  assert.doesNotMatch(store, /\bact\(/, "the store never calls the hook's act()");
  assert.doesNotMatch(store, /fetch\(/, "…nor a fetch of its own");
  const onPageHide = store.slice(store.indexOf("const onPageHide"), store.indexOf("};", store.indexOf("const onPageHide")));
  assert.match(onPageHide, /teardown\(/, "pagehide flushes");
  assert.doesNotMatch(onPageHide, /await|setTimeout/, "…synchronously, inside the handler");
  assert.match(store, /addEventListener\("pagehide", onPageHide\)/);
});
