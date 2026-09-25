import { test } from "node:test";
import assert from "node:assert/strict";
import { ageDays, buildLayers, dimmed, listRows, median, OUT, presets, provenance, rankByMatch, roleTone, sieveDots, type Ctx, type Filters } from "./pipelineKitModel.ts";
import { historyTrail, pathCells, stagePosition } from "./pipelinePaneModel.ts";
import type { Entry, PipelineEvent, StageDef } from "../../../shared/pipelineTypes.ts";

const NOW = Date.parse("2026-09-25T12:00:00Z");
const AXIS: StageDef[] = [
  { id: "Accepted", label: "Accepted", role: "entry" },
  { id: "Screened", label: "Screened", role: "screening" },
  { id: "Interview", label: "Interview", role: "interview" },
  { id: "Offer", label: "Offer", role: "offer" },
  { id: "Hired", label: "Hired", role: "terminal" },
];

function entry(id: string, stage: string, over: Partial<Entry> = {}): Entry {
  return {
    id, candidateId: null, candidateLabel: id, archetype: null, roleFamily: null, jobId: null, jobTitle: "Role A", stage,
    matchScore: null, status: "active", approvalKind: null, approvalDetail: null,
    createdAt: "2026-09-01T00:00:00Z", stageChangedAt: "2026-09-01T00:00:00Z", ...over,
  };
}
const ctx: Ctx = { score: (e) => e.matchScore, needs: (e) => e.status === "active" && e.approvalKind != null, now: NOW };
const none: Filters = { query: () => true, layer: null, needsOnly: false, role: null, brush: null };

test("provenance: a later stage stamp is a recorded move; equal stamps are a placement; no stamps is nothing on record", () => {
  assert.equal(provenance({ createdAt: "2026-09-01T00:00:00Z", stageChangedAt: "2026-09-05T00:00:00Z" }), "solid");
  assert.equal(provenance({ createdAt: "2026-09-01T00:00:00Z", stageChangedAt: "2026-09-01T00:00:00Z" }), "ring");
  assert.equal(provenance({ createdAt: "2026-09-01T00:00:00Z", stageChangedAt: null }), "ring");
  assert.equal(provenance({ createdAt: null, stageChangedAt: null }), "dashed");
  assert.equal(ageDays({ createdAt: "2026-09-01T00:00:00Z", stageChangedAt: "2026-09-20T12:00:00Z" }, NOW), 5);
  assert.equal(ageDays({ createdAt: null, stageChangedAt: null }, NOW), null);
  assert.equal(median([9, 1, 5]), 5);
  assert.equal(median([]), null);
});

test("tones follow the stage ROLE on the workspace axis, never the name", () => {
  assert.equal(roleTone("interview"), "interview");
  assert.equal(roleTone("scoring"), "interview");
  assert.equal(roleTone("terminal"), "hired");
  assert.equal(roleTone(undefined), "default");
});

test("layers: the axis in order, a stranded retired column, then the exit counted from rejectedByLane", () => {
  const es = [
    entry("a", "Offer"), entry("b", "Offer", { stageChangedAt: "2026-09-10T00:00:00Z", approvalKind: "decision" }),
    entry("c", "Onsite"),
  ];
  const layers = buildLayers(AXIS, [{ id: "Onsite", label: "On-site", role: "interview" }], es, { "Role A": 3, "Role B": 1 }, ctx);
  assert.deepEqual(layers.map((l) => l.id), ["Accepted", "Screened", "Interview", "Offer", "Hired", "Onsite", OUT]);
  const offer = layers[3];
  assert.deepEqual([offer.count, offer.waiting, offer.walked, offer.placed, offer.tone], [2, 1, 1, 1, "offer"]);
  assert.equal(layers[5].label, "On-site");
  assert.equal(layers[5].tone, "quiet", "a retired column is drawn quiet, never on the stage ramp");
  assert.equal(layers[6].count, 4);
  const dots = sieveDots(es, layers, ctx);
  assert.equal(dots.length, 3 + 4, "one dot per entry, one exit per rejected row");
  assert.deepEqual(dots.filter((d) => d.layer === OUT).map((d) => d.shape), ["exit", "exit", "exit", "exit"]);
  assert.equal(dots.find((d) => d.id === "b")?.needs, true);
});

test("rows: waiting first, then match rank; nulls rank last; brush, role, needs and layer filter; dimming ignores the layer", () => {
  const es = [
    entry("low", "Screened", { matchScore: 40 }),
    entry("top", "Offer", { matchScore: 90 }),
    entry("wait", "Screened", { matchScore: 60, approvalKind: "screening_review" }),
    entry("none", "Accepted", { matchScore: null, jobTitle: "Role B" }),
  ];
  const { ranked, rankOf } = rankByMatch(es, ctx);
  assert.deepEqual(ranked.map((e) => e.id), ["top", "wait", "low", "none"]);
  assert.deepEqual(listRows(es, none, rankOf, ctx).map((e) => e.id), ["wait", "top", "low", "none"]);
  assert.deepEqual(listRows(es, { ...none, layer: "Screened" }, rankOf, ctx).map((e) => e.id), ["wait", "low"]);
  assert.deepEqual(listRows(es, { ...none, brush: [0, 1] }, rankOf, ctx).map((e) => e.id), ["wait", "top"]);
  assert.deepEqual(listRows(es, { ...none, role: "Role B" }, rankOf, ctx).map((e) => e.id), ["none"]);
  assert.deepEqual(listRows(es, { ...none, needsOnly: true }, rankOf, ctx).map((e) => e.id), ["wait"]);
  assert.deepEqual([...dimmed(es, { ...none, layer: "Screened", brush: [0, 1] }, rankOf, ctx)].sort(), ["low", "none"]);
  assert.deepEqual(presets(ranked, ctx), { top10: [0, 2], over70: [0, 0], never: [3, 3] });
});

const ev = (id: number, kind: string, toStage: string | null, createdAt: string): PipelineEvent => ({ id, kind, toStage, createdAt, candidateLabel: null, jobTitle: null, detail: null });

test("pane: the path marks walked, placed, unrecorded-here, skipped and not reached per axis stage", () => {
  const cells = pathCells(AXIS, "Interview", [ev(1, "matched", "Screened", "2026-09-01T00:00:00Z"), ev(2, "advanced", "Interview", "2026-09-03T00:00:00Z")]);
  assert.deepEqual(cells.map((c) => [c.id, c.shape, c.reason]), [
    ["Accepted", "none", "skipped"],
    ["Screened", "solid", "reached"],
    ["Interview", "solid", "reached"],
    ["Offer", "none", "notReached"],
    ["Hired", "none", "notReached"],
  ]);
  const placed = pathCells(AXIS, "Offer", [ev(3, "added", "Offer", "2026-09-01T00:00:00Z")]);
  assert.equal(placed[3].shape, "ring", "added at the stage is a placement, not a walk");
  assert.equal(pathCells(AXIS, "Offer", [])[3].reason, "hereUnrecorded");
  assert.equal(stagePosition(AXIS, "Offer"), 4);
  assert.equal(stagePosition(AXIS, "Gone"), 0);
});

test("pane: history keeps a silence of 7+ days in place, and the silence up to today for a live entry", () => {
  const rows = historyTrail([ev(2, "advanced", "Screened", "2026-09-12T00:00:00Z"), ev(1, "added", "Accepted", "2026-09-01T00:00:00Z")], { live: true, now: NOW });
  assert.deepEqual(rows.map((r) => (r.kind === "silence" ? `gap${r.days}${r.untilToday ? "!" : ""}` : r.kind)), ["event", "gap11", "event", "gap14!"]);
  assert.deepEqual(historyTrail([], { live: true, now: NOW }).map((r) => r.kind), ["nothing"]);
  assert.equal(historyTrail([ev(1, "added", "Accepted", "2026-09-24T00:00:00Z")], { live: true, now: NOW }).length, 1, "no silence under a week");
});
