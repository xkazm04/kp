// Bug-ui-scan 2026-07-09 #1 — the anti-ghostwriting bulk-paste control, END-TO-END.
//
// The client emits a `paste` ProcessEvent carrying the paste MAGNITUDE (char count).
// This drives the REAL live-session save route (POST) against an isolated throwaway
// DB, then reads the events back and scores authenticity exactly as runEvaluateSubmission
// (devcase-run.ts) does. It proves the whole path — wire → route (KINDS allow-list +
// map) → DB (INSERT / SELECT / schema `size` column) → scorer — no longer drops the
// `paste` kind or its `size`, so the decisive -65 authenticity penalty fires and lands
// a ghost-written live submission in "suspect" (which promoteSubmission holds from
// auto-advance). Against the pre-fix code the paste was filtered out by the KINDS
// allow-list (and `size` dropped by the map/DB), so the paste never round-trips,
// observedBulkPaste is always false, and these tests fail.
//
// testing/unit-db.ts MUST be the first project import — it sets KP_DB_PATH before
// db-path.ts is evaluated by the route's transitive `@/app/_lib/db` import.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { POST } from "@/app/api/devcase/session/[id]/route.ts";
import { startDevSession, getDevSessionEvents } from "./devcase.ts";
import { scoreAuthenticity, PASTE_BULK_CHARS } from "../devcase-authenticity.ts";

after(() => cleanupUnitDb());

// The exact predicate runEvaluateSubmission computes over the observed event stream.
const observedBulkPaste = (events: { kind: string; size?: number | null }[]): boolean =>
  events.some((e) => e.kind === "paste" && (e.size ?? 0) >= PASTE_BULK_CHARS);

// A watched live session with no git history (commitCount 0, observed) and a kept
// DECISIONS log — the clean-looking submission a pasted LLM solution hides inside.
// With no bulk paste it scores a perfect 100 ("authentic"); the paste is the only
// signal that must move it.
const baseScoreInput = {
  commitCount: 0,
  bursty: null,
  spanHours: null,
  decisionsLogPresent: true,
  readBeforeWrite: 0.6,
  iterationPattern: "linear",
  observed: true,
} as const;

// The flush route requires the apply token that minted the session — including for a
// session minted directly here (/perfect 2026-09-02, api-devcase-1: the `session.token &&`
// carve-out that let a TOKENLESS row skip the gate and both per-token budgets is gone).
// These fixtures therefore mint WITH a token and present it, which is also what the
// product does; the paste control being exercised is unaffected either way.
const APPLY_TOKEN = "paste-fixture-token";

function post(id: string, events: unknown[]): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/devcase/session/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: APPLY_TOKEN, events }),
    }),
    { params: Promise.resolve({ id }) }
  );
}

test("a bulk paste survives the route and lands the watched submission in suspect", async () => {
  const session = startDevSession({ token: APPLY_TOKEN, candidateRef: "cand-paste" });
  const now = Date.now();
  const res = await post(session.id, [
    { t: now, kind: "open", path: "src/solve.ts" },
    // The whole LLM solution pasted into the watched editor (>= threshold).
    { t: now + 1, kind: "paste", path: "src/solve.ts", size: PASTE_BULK_CHARS + 200 },
    { t: now + 2, kind: "edit", path: "src/solve.ts" },
  ]);
  assert.equal(res.ok, true, "the save route accepts the batch");

  // The route no longer drops the kind: the paste round-trips WITH its magnitude.
  const events = getDevSessionEvents(session.id);
  const paste = events.find((e) => e.kind === "paste");
  assert.ok(paste, "the paste event was persisted, not filtered out by the KINDS allow-list");
  assert.ok((paste.size ?? 0) >= PASTE_BULK_CHARS, `the paste magnitude survived (got ${paste.size})`);

  // observedBulkPaste now actually fires, and the -65 penalty is materially decisive:
  // the SAME session scores "authentic" without the paste, "suspect" with it.
  assert.equal(observedBulkPaste(events), true);
  const withPaste = scoreAuthenticity({ ...baseScoreInput, observedBulkPaste: true });
  const withoutPaste = scoreAuthenticity({ ...baseScoreInput, observedBulkPaste: false });
  assert.equal(withoutPaste.band, "authentic", "the same session with no bulk paste scores authentic");
  assert.equal(withPaste.band, "suspect", "the bulk paste drops it to suspect (held from auto-promote)");
  assert.ok(
    withoutPaste.score - withPaste.score >= 60,
    `materially lower authenticity (delta ${withoutPaste.score - withPaste.score})`
  );
  assert.ok(withPaste.reasons.some((r) => r.includes("bulk paste")));
});

test("a sub-threshold paste round-trips but does not trip the control", async () => {
  const session = startDevSession({ token: APPLY_TOKEN, candidateRef: "cand-clean" });
  const now = Date.now();
  const res = await post(session.id, [
    { t: now, kind: "open", path: "src/solve.ts" },
    { t: now + 1, kind: "edit", path: "src/solve.ts" },
    { t: now + 2, kind: "decision_log", path: "DECISIONS.md" },
    // A small paste (below the threshold) must NOT fire the control.
    { t: now + 3, kind: "paste", path: "src/solve.ts", size: PASTE_BULK_CHARS - 1 },
  ]);
  assert.equal(res.ok, true);

  const events = getDevSessionEvents(session.id);
  const paste = events.find((e) => e.kind === "paste");
  // The kind + its exact magnitude survive (also fails on the pre-fix route/DB), yet a
  // sub-threshold paste leaves observedBulkPaste false — the boundary is at PASTE_BULK_CHARS.
  assert.ok(paste && paste.size === PASTE_BULK_CHARS - 1, "the sub-threshold paste is stored with its exact magnitude");
  assert.equal(observedBulkPaste(events), false, "a sub-threshold paste does not fire the control");
  assert.equal(scoreAuthenticity({ ...baseScoreInput, observedBulkPaste: false }).band, "authentic");
});
