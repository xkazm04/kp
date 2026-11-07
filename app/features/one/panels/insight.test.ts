// The insight look's numbers and the ONE suggested act — pinned, because the card's whole
// claim is that it reads the same data the table does and offers only what the door will do.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAct } from "../consent/acts.ts";
import { aheadBuckets, biggest, entryInsight, entryParams, funnelInsight, suggestEntry, tally } from "./insight.ts";
import type { OneEntry } from "./pipelineRead.ts";

const entry = (id: string, over: Partial<OneEntry> = {}): OneEntry => ({
  id,
  label: id.toUpperCase(),
  jobId: null,
  jobTitle: "Backend",
  stage: "screened",
  stageLabel: "Screened",
  stageChangedAt: null,
  ageDays: null,
  score: 60,
  stale: false,
  isNew: false,
  needsDecision: true,
  ...over,
});

test("the shape: stages largest first, the tail folded into other, scores binned, unscored apart", () => {
  const rows = [
    entry("a", { score: 30 }),
    entry("b", { score: 45, stage: "interview", stageLabel: "Interview" }),
    entry("c", { score: 55, stage: "interview", stageLabel: "Interview" }),
    entry("d", { score: 70, stage: "offer", stageLabel: "Offer" }),
    entry("e", { score: 90, stage: "accepted", stageLabel: "Accepted" }),
    entry("f", { score: null, stage: "applied", stageLabel: "Applied" }),
    entry("g", { score: 100 }),
  ];
  const i = entryInsight(rows, 3);
  assert.deepEqual(i.stages.map((s) => [s.label, s.count]), [["Interview", 2], ["Screened", 2]]);
  assert.equal(i.other, 3, "accepted + applied + offer fold into one part");
  assert.deepEqual(i.bins, { lt40: 1, "40": 1, "50": 1, "65": 1, "75": 2 });
  assert.equal(i.unscored, 1);
});

test("the oldest waiter is the longest KNOWN age; the top role only when rows span roles", () => {
  const one = entryInsight([entry("a", { ageDays: 3 }), entry("b", { ageDays: 160, stale: true, stageLabel: "Interview" }), entry("c")]);
  assert.deepEqual(one.oldest, { id: "b", label: "B", stageLabel: "Interview", days: 160, stale: true });
  assert.equal(one.topRole, null, "a single role is not an insight");
  const two = entryInsight([entry("a"), entry("b", { jobTitle: "QA" }), entry("c", { jobTitle: "QA" })]);
  assert.deepEqual(two.topRole, { title: "QA", count: 2 });
  assert.equal(entryInsight([entry("a")]).oldest, null, "no age known → no waiter, never 0 days");
});

test("the suggestion: advance the highest-scoring row at or above 65", () => {
  const rows = [entry("a", { score: 70 }), entry("b", { score: 88 }), entry("c", { score: 20, ageDays: 300, stale: true })];
  assert.deepEqual(suggestEntry(rows), { entry: rows[1], reason: "score" }, "a strong score outranks a long wait");
  assert.equal(suggestEntry([entry("a", { score: 64.9 })]), null, "64.9 is under the line");
});

test("else the longest waiter, only when stalled; else nothing", () => {
  const stalled = [entry("a", { score: 50, ageDays: 10 }), entry("b", { score: null, ageDays: 160, stale: true })];
  assert.deepEqual(suggestEntry(stalled), { entry: stalled[1], reason: "stalled" });
  const calm = [entry("a", { score: 50, ageDays: 10 }), entry("b", { score: 40, ageDays: 30, stale: false })];
  assert.equal(suggestEntry(calm), null, "a long wait that is not past its limit is not a reason");
  assert.equal(suggestEntry([entry("a", { score: 30, stale: true })]), null, "no known age, no waiter");
  assert.equal(suggestEntry([]), null);
});

test("the suggestion only ever arms a single-entry ADVANCE on a row the card describes", () => {
  const rows = [entry("a", { score: 90, stage: "interview", jobTitle: "QA" }), entry("b", { score: 10, ageDays: 400, stale: true })];
  const pick = suggestEntry(rows);
  assert.ok(pick && rows.includes(pick.entry), "the candidate is in the slice");
  const act = resolveAct("entryAdvance", entryParams(pick!.entry));
  assert.ok(act.armed && act.act === "entryAdvance");
  if (act.armed && act.act === "entryAdvance") {
    assert.equal(act.entryId, "a");
    assert.equal(act.expectedStage, "interview", "the row's stage rides along for the compare-and-swap");
    assert.equal(act.role, "QA");
  }
});

test("funnel: the biggest share lost between two steps, and first → last overall", () => {
  const i = funnelInsight([
    { stage: "Applied", reached: 100 },
    { stage: "Screened", reached: 80 },
    { stage: "Interview", reached: 20 },
    { stage: "Offer", reached: 10 },
  ]);
  assert.deepEqual(i.drop, { from: "Screened", to: "Interview", lostPct: 75 });
  assert.equal(i.overallPct, 10);
  assert.deepEqual(funnelInsight([{ stage: "Applied", reached: 0 }, { stage: "Screened", reached: 0 }]), { drop: null, overallPct: null });
});

test("schedule horizons, tallies and the biggest bucket", () => {
  const now = Date.parse("2026-11-07T08:00:00Z");
  assert.deepEqual(aheadBuckets(["2026-11-07T10:00:00Z", "2026-11-10T10:00:00Z", "2026-11-20T10:00:00Z", "2027-01-01T10:00:00Z", "2026-11-01T10:00:00Z"], now), {
    today: 1,
    week: 1,
    month: 1,
    later: 1,
  });
  assert.deepEqual(tally(["sent", "failed", "sent", "queued"]), [
    { key: "sent", count: 2 },
    { key: "failed", count: 1 },
    { key: "queued", count: 1 },
  ]);
  assert.deepEqual(biggest({ decisions: 29, pipeline: 61, channels: 17 }, ["decisions", "pipeline", "channels"] as const), { key: "pipeline", count: 61 });
  assert.deepEqual(biggest({ decisions: 5, pipeline: 5 }, ["decisions", "pipeline"] as const), { key: "decisions", count: 5 }, "a tie keeps priority order");
  assert.equal(biggest({ decisions: 0 }, ["decisions"] as const), null);
});
