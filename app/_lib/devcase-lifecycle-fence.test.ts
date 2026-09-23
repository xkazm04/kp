// The lifecycle fence: the one stop decision the runner consults before each irreversible
// effect, and the one rule for who a close owes a wrap-up note. Pure cases, plus a
// source-shape pin on the orchestrator's posting write (its losing branch needs a close
// to land inside the publish await, which a unit test cannot schedule).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stopVerdict, wrapUpRecipients } from "./devcase-lifecycle-fence.ts";

const here = dirname(fileURLToPath(import.meta.url));

test("stopVerdict: a moved stage stops the run and says where it went", () => {
  assert.deepEqual(
    stopVerdict({ aborted: false, autonomy: "on", stageRead: "ranked", stageNow: "closed" }),
    { stop: true, reason: "moved", to: "closed" }
  );
  assert.deepEqual(
    stopVerdict({ aborted: false, autonomy: "on", stageRead: "collecting", stageNow: null }),
    { stop: true, reason: "moved", to: "missing" },
    "a deleted row is a move too"
  );
});

test("stopVerdict: cancel, then pause, and an unmoved stage runs on", () => {
  assert.deepEqual(stopVerdict({ aborted: true, autonomy: "on", stageRead: "ranked", stageNow: "ranked" }), {
    stop: true,
    reason: "canceled",
  });
  assert.deepEqual(stopVerdict({ aborted: false, autonomy: "paused", stageRead: "ranked", stageNow: "ranked" }), {
    stop: true,
    reason: "paused",
  });
  assert.deepEqual(stopVerdict({ aborted: false, autonomy: "on", stageRead: "ranked", stageNow: "ranked" }), { stop: false });
  // Precedence: the task owner's cancel first, then someone else owning the lifecycle.
  assert.equal(
    (stopVerdict({ aborted: true, autonomy: "paused", stageRead: "ranked", stageNow: "closed" }) as { reason: string }).reason,
    "canceled"
  );
  assert.equal(
    (stopVerdict({ aborted: false, autonomy: "paused", stageRead: "ranked", stageNow: "closed" }) as { reason: string }).reason,
    "moved"
  );
});

test("wrapUpRecipients: nobody the board already holds, once per address", () => {
  const subs = [
    { id: "a", contact: "a@example.test", candidateRef: "Ann" },
    { id: "b", contact: "b@example.test", candidateRef: "Ben" },
    { id: "c", contact: "c@example.test", candidateRef: "Cid" },
    { id: "c2", contact: " c@example.test ", candidateRef: "Cid again" },
    { id: "d", contact: null, candidateRef: "opaque-handle" },
    { id: "e", contact: null, candidateRef: "e@example.test" },
  ];
  // a = promoted (advance), b = promoted (held): both carry a pipeline entry.
  const linked = new Set(["a", "b"]);
  const out = wrapUpRecipients(subs, (s) => linked.has(s.id));
  assert.deepEqual(
    out.map((r) => [r.to, r.submission.id]),
    [
      ["c@example.test", "c"],
      ["e@example.test", "e"],
    ]
  );
});

test("wrapUpRecipients: a legacy 'promoted' status is still skipped", () => {
  const out = wrapUpRecipients([{ id: "x", status: "promoted", contact: "x@example.test" }], () => false);
  assert.deepEqual(out, []);
});

test("the runner's posting write is a compare-and-set on 'approved', and a lost write withdraws the posting", () => {
  const src = readFileSync(join(here, "devcase-orchestrator.ts"), "utf8");
  assert.ok(
    src.includes(`updateLifecycle(id, { postingId }, { expectedStage: "approved" })`),
    "the postingId write re-asserts the stage the step read"
  );
  assert.doesNotMatch(src, /updateLifecycle\(id, \{ postingId \}\);/, "no unconditional postingId write remains");
  const lost = src.slice(src.indexOf(`{ expectedStage: "approved" })`));
  assert.match(lost.slice(0, 1200), /setPostingStatus\(posting\.id, "closed"\)/, "the just-minted posting is closed again");
  assert.match(lost.slice(0, 1200), /action: "posting_withdrawn"/, "and the withdrawal is audited");
  // The fence is consulted, not re-typed: no hand-copied abort/pause pair survives in a loop.
  assert.ok(src.includes("stopVerdict("), "the orchestrator consults the fence");
  assert.doesNotMatch(src, /if \(signal\?\.aborted\) \{\s*const detail = `canceled after promoting/, "the promote loop's hand-copied stop block is gone");
});
