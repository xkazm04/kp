import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STAGE_AXIS, type StageDef } from "@/app/_lib/pipeline-stages";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import { moveTargetStages } from "../../pipelineMoveTargets";
import {
  beadA11y,
  beadIntent,
  canDropOn,
  cellSelectState,
  commitDrop,
  dropMove,
  moveMenuItems,
  toggleCellSelection,
} from "./subwayInteraction";

// The Subway as a working board: select mode turns beads and stations into
// checkboxes, and outside it a bead moves by drag OR by its keyboard/right-click
// "Move to" menu - both through ONE legality rule and ONE move call.

const e = (id: string, over: Partial<Entry> = {}): Entry =>
  ({ id, stage: "Screened", jobId: "j1", jobTitle: "Role", status: "active", candidateLabel: id, ...over }) as Entry;

test("beadIntent + beadA11y: a bead opens outside select mode and is a checkbox inside it", () => {
  const entry = e("a");
  assert.deepEqual(beadIntent({ selectMode: false }, entry), { kind: "open" });
  assert.deepEqual(beadIntent({ selectMode: true }, entry), { kind: "toggle", id: "a" });
  assert.deepEqual(beadA11y({ selectMode: true, selected: true }), { role: "checkbox", checked: true });
  assert.deepEqual(beadA11y({ selectMode: true, selected: false }), { role: "checkbox", checked: false });
  const off = beadA11y({ selectMode: false, selected: true });
  assert.equal(off.role, undefined);
  assert.equal(off.checked, undefined);
});

test("cellSelectState: none / some / all, and an empty cell is none", () => {
  const cell = [e("a"), e("b")];
  assert.equal(cellSelectState(new Set(), cell), "none");
  assert.equal(cellSelectState(new Set(["a"]), cell), "some");
  assert.equal(cellSelectState(new Set(["a", "b"]), cell), "all");
  assert.equal(cellSelectState(new Set(["a", "b"]), []), "none");
});

test("toggleCellSelection: a partial cell selects the rest, a full one clears, outsiders untouched", () => {
  const cell = [e("a"), e("b")];
  assert.deepEqual([...toggleCellSelection(new Set(["a", "x"]), cell)].sort(), ["a", "b", "x"]);
  assert.deepEqual([...toggleCellSelection(new Set(["a", "b", "x"]), cell)].sort(), ["x"]);
  assert.deepEqual([...toggleCellSelection(new Set(["x"]), cell)].sort(), ["a", "b", "x"]);
  // An empty cell changes nothing (never adds, never removes an outsider).
  assert.deepEqual([...toggleCellSelection(new Set(["x"]), [])], ["x"]);
  // The input set is never mutated (React state).
  const before = new Set(["a"]);
  toggleCellSelection(before, cell);
  assert.deepEqual([...before], ["a"]);
});

test("canDropOn: a legal station on the bead's own line only; never its own column or the terminal one", () => {
  const entry = e("a", { stage: "Screened", jobId: "j1" });
  assert.equal(canDropOn(entry, { positionId: "j1", stageId: "Interview" }, DEFAULT_STAGE_AXIS), true);
  assert.equal(canDropOn(entry, { positionId: "j1", stageId: "Screened" }, DEFAULT_STAGE_AXIS), false);
  assert.equal(canDropOn(entry, { positionId: "j1", stageId: "Hired" }, DEFAULT_STAGE_AXIS), false);
  assert.equal(canDropOn(entry, { positionId: "j2", stageId: "Interview" }, DEFAULT_STAGE_AXIS), false);
  // A workspace that renamed its terminal column: the ROLE refuses, not the name.
  const custom: readonly StageDef[] = [
    { id: "Accepted", label: "Accepted", role: "entry" },
    { id: "Screened", label: "Screened", role: "screening" },
    { id: "Interview", label: "Interview", role: "interview" },
    { id: "Placed", label: "Placed", role: "terminal" },
  ];
  assert.equal(canDropOn(entry, { positionId: "j1", stageId: "Placed" }, custom), false);
  assert.equal(canDropOn(entry, { positionId: "j1", stageId: "Interview" }, custom), true);
  // A station the axis does not draw is not a destination.
  assert.equal(canDropOn(entry, { positionId: "j1", stageId: "Nowhere" }, DEFAULT_STAGE_AXIS), false);
});

test("dropMove: off while the bead is a checkbox; a legal drop calls the move exactly once", () => {
  const entry = e("a");
  const target = { positionId: "j1", stageId: "Interview" };
  assert.equal(dropMove(entry, target, DEFAULT_STAGE_AXIS, { selectMode: true }), null);
  assert.deepEqual(dropMove(entry, target, DEFAULT_STAGE_AXIS, { selectMode: false }), { entry, toStage: "Interview" });
  assert.equal(dropMove(entry, { positionId: "j1", stageId: "Hired" }, DEFAULT_STAGE_AXIS, { selectMode: false }), null);

  const calls: Array<[string, string]> = [];
  const onMove = (x: Entry, to: string) => void calls.push([x.id, to]);
  assert.equal(commitDrop(entry, target, DEFAULT_STAGE_AXIS, { selectMode: false }, onMove), true);
  assert.deepEqual(calls, [["a", "Interview"]]);
  // A refused drop, select mode, or no move handler: never called.
  assert.equal(commitDrop(entry, target, DEFAULT_STAGE_AXIS, { selectMode: true }, onMove), false);
  assert.equal(commitDrop(entry, { positionId: "j2", stageId: "Interview" }, DEFAULT_STAGE_AXIS, { selectMode: false }, onMove), false);
  assert.equal(commitDrop(entry, target, DEFAULT_STAGE_AXIS, { selectMode: false }, undefined), false);
  assert.equal(calls.length, 1);
});

test("moveMenuItems: moveTargetStages in axis order, workspace labels win, every item is a legal dropMove", () => {
  const axis: readonly StageDef[] = DEFAULT_STAGE_AXIS.map((s) => (s.id === "Interview" ? { ...s, label: "Tech round" } : s));
  const entry = e("a", { stage: "Screened" });
  const items = moveMenuItems(entry, axis, (id) => `enum:${id}`);
  assert.deepEqual(
    items.map((i) => i.id),
    moveTargetStages("Screened", axis),
  );
  assert.equal(items.find((i) => i.id === "Interview")?.label, "Tech round");
  assert.equal(items.find((i) => i.id === "Offer")?.label, "enum:Offer");
  assert.ok(!items.some((i) => i.id === "Hired"));
  // The keyboard twin rides the drag's path: each item's target is a legal drop.
  for (const item of items) {
    assert.deepEqual(dropMove(entry, item.target, axis, { selectMode: false }), { entry, toStage: item.id });
  }
});
