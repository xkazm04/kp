// A scripted click proves its effect. The guided walk's writes are MOVES: the anchors
// it clicks, the board change that proves the click did the work, and the checked
// API call that does the same work when it did not. These cases pin the route
// decision (moveOutcome), the declared anchors against the product files that must
// carry them, the rule that the walk makes no unchecked POST, and that "Hired" is
// read off the board rather than narrated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DEFAULT_STAGE_AXIS, stageWithRole } from "@/app/_lib/pipeline-stages";
import { SIM_MOVES, hiredEffect, moveOutcome, moveSelector } from "./simMove.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

test("a click whose effect shows on the board is a DOM move with nothing to report", () => {
  assert.deepEqual(moveOutcome({ clicked: true, effectAfterClick: true }), { route: "dom", reason: null, halt: null });
});

test("a click that landed but changed nothing is a fallback WITH its reason, never a DOM success", () => {
  assert.deepEqual(
    moveOutcome({ clicked: true, effectAfterClick: false, apiOk: true, effectAfterApi: true }),
    { route: "api", reason: "noEffect", halt: null }
  );
});

test("a control that never became visible falls back and says so", () => {
  assert.deepEqual(
    moveOutcome({ clicked: false, apiOk: true, effectAfterApi: true }),
    { route: "api", reason: "notVisible", halt: null }
  );
});

test("a refused fallback halts with the server's code; an accepted one the board does not show halts too", () => {
  assert.deepEqual(
    moveOutcome({ clicked: false, apiOk: false, apiCode: "JOB_NOT_FOUND" }),
    { route: "api", reason: "notVisible", halt: "JOB_NOT_FOUND" }
  );
  // A refusal with no machine code still halts: a silent walk-on is the defect.
  assert.equal(moveOutcome({ clicked: false, apiOk: false }).halt, "moveFailed");
  assert.deepEqual(
    moveOutcome({ clicked: false, apiOk: true, effectAfterApi: false }),
    { route: "api", reason: "notVisible", halt: "moveNoEffect" }
  );
});

test("a fallback only ever writes the (SIM) demo corpus: a real subject halts before the API runs", () => {
  assert.deepEqual(
    moveOutcome({ clicked: false, simSubject: false, apiOk: true, effectAfterApi: true }),
    { route: "api", reason: "notVisible", halt: "SIM_ENTRY_NOT_FOUND" }
  );
  // A DOM move needs no gate: the click is the viewer's own product surface.
  assert.equal(moveOutcome({ clicked: true, effectAfterClick: true, simSubject: false }).halt, null);
});

test("SIM_MOVES declares publish -> publish-confirm and decide -> dialog accept, and each anchor exists where declared", () => {
  assert.deepEqual(
    SIM_MOVES.publish.clicks.map((c) => moveSelector(c, "job-1")),
    ['[data-sim-entry="job-1"] [data-sim-click="publish"]', '[role="dialog"] [data-sim-click="publish-confirm"]']
  );
  assert.deepEqual(
    SIM_MOVES.offerSend.clicks.map((c) => moveSelector(c, "e-1")),
    ['[data-sim-entry="e-1"] [data-sim-click="decide"]', '[role="dialog"] [data-sim-click="accept"]']
  );
  const files = new Set<string>();
  for (const move of Object.values(SIM_MOVES)) {
    assert.ok(move.clicks.length > 0, `${move.id} declares at least one click`);
    for (const c of move.clicks) {
      files.add(c.file);
      assert.ok(
        read(c.file).includes(`data-sim-click="${c.anchor}"`),
        `${move.id}: ${c.file} must carry data-sim-click="${c.anchor}"`
      );
    }
  }
  for (const f of [
    "app/features/library/jobs/JobsPublishDialog.tsx",
    "app/features/hiring/decisions/ledger/LedgerCells.tsx",
    "app/features/hiring/pipeline/candidate/decision/CandidateDecisionBar.tsx",
  ]) {
    assert.ok(files.has(f), `a move names ${f}`);
  }
});

test("the ledger's offer row renders the decide door: the anchor sits after the offer guard closes", () => {
  const src = read("app/features/hiring/decisions/ledger/LedgerCells.tsx");
  const guard = src.indexOf('row.kind === "offer" ? null');
  assert.ok(guard > 0, "the offer guard is still there (offers keep the deadline lever)");
  const guardEnd = src.indexOf(")}", guard);
  const decide = src.indexOf('data-sim-click="decide"');
  assert.ok(decide > guardEnd, "decide is outside the offer guard, so an offer row renders it");
  const hiddenGuard = src.indexOf("{hidden ? null : (");
  const hiddenEnd = src.indexOf("\n      )}", hiddenGuard);
  assert.ok(decide > hiddenEnd, "decide is outside the select-mode guard too, like the door it names");
});

/** Every `fetch(...)` call in the source whose arguments carry a POST, with the text
 *  that precedes it. Paren-matched, so a nested JSON.stringify(...) stays inside. */
function postFetches(src: string): { at: number; before: string }[] {
  const out: { at: number; before: string }[] = [];
  const re = /\bfetch\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 0;
    let end = m.index + "fetch".length;
    for (; end < src.length; end++) {
      if (src[end] === "(") depth++;
      else if (src[end] === ")" && --depth === 0) break;
    }
    const call = src.slice(m.index, end + 1);
    if (/method:\s*"POST"/.test(call)) out.push({ at: m.index, before: src.slice(Math.max(0, m.index - 80), m.index) });
  }
  return out;
}

test("the walk makes no unchecked POST: every write goes through okJson() or a move's API fallback", () => {
  const src = read("app/features/shell/simulation/useSimulationWalk.ts");
  const posts = postFetches(src);
  assert.ok(posts.length >= 5, "the scan sees the walk's writes");
  const bare = posts.filter(({ before }) => !/(okJson(<[^>]*>)?\(\s*await\s*|api:\s*\(\)\s*=>\s*)$/.test(before));
  const line = (at: number) => src.slice(0, at).split("\n").length;
  assert.deepEqual(bare.map((p) => line(p.at)), [], "bare POST fetch at these lines");
  // The lease renew/release calls are the declared best-effort exception: they pass a
  // prepared init, never a POST literal, and a lost one expires on the server's terms.
  assert.match(src, /fetch\("\/api\/sim\/reset", init\)\.catch\(\(\) => null\)/);
});

test("hiredEffect holds only on the axis's terminal stage, and the walk is done only after it holds", () => {
  const axis = DEFAULT_STAGE_AXIS;
  const terminal = stageWithRole("terminal", axis);
  const offer = stageWithRole("offer", axis);
  assert.ok(terminal && offer);
  assert.equal(hiredEffect({ stage: terminal }, axis), true);
  assert.equal(hiredEffect({ stage: offer }, axis), false, "an offer extended is not a hire");
  assert.equal(hiredEffect(undefined, axis), false, "a missing entry is not a hire");
  // A renamed terminal column on a composed axis still counts: role, not literal.
  const composed = axis.map((s) => (s.role === "terminal" ? { ...s, id: "Joined" } : s));
  assert.equal(hiredEffect({ stage: "Joined" }, composed), true);
  assert.equal(hiredEffect({ stage: terminal }, composed), false);

  const walk = read("app/features/shell/simulation/useSimulationWalk.ts");
  const effect = walk.indexOf("hiredEffect(");
  const done = walk.indexOf("done: true");
  assert.ok(effect > 0 && done > effect, "done:true is set only after the hired move proved hiredEffect");
});
