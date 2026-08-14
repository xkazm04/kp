// The axis editor's rules, and their agreement with the server's.
//
// Two things are pinned. The EDITING model (ids minted once so renames are free,
// removal turning a saved stage into a tombstone, ordering that keeps entry
// first and terminal last). And the fact that `axisProblems` accepts exactly what
// `validatePipelineStages` accepts — the client check exists so a recruiter is
// not told "invalid" after rearranging six columns, which is only worth anything
// if the two agree.
import test from "node:test";
import assert from "node:assert/strict";
import { validateDecisionConfig, type PipelineStagesRule } from "@/app/_lib/decision-config-schema";
import { DEFAULT_STAGE_AXIS, type StageDef } from "@/app/_lib/pipeline-stages";
import {
  addStage,
  axisEqualsStored,
  axisProblems,
  draftFromStored,
  draftToStored,
  mintStageId,
  moveStage,
  removeStage,
  renameStage,
  setStageRole,
  strandedByDraft,
  type AxisDraft,
} from "./pipelineAxisDraft.ts";

const SHIPPED: PipelineStagesRule = {
  stages: DEFAULT_STAGE_AXIS.map((s) => ({ id: s.id, label: s.label, role: s.role as "entry" })),
  retired: [],
};
const savedStages = (): StageDef[] => DEFAULT_STAGE_AXIS.map((s) => ({ ...s }));
const start = (): AxisDraft => draftFromStored(SHIPPED);
const ids = (d: AxisDraft) => d.stages.map((s) => s.id);

// ---- editing ---------------------------------------------------------------

test("the shipped axis round-trips through the draft unchanged", () => {
  const draft = start();
  assert.deepEqual(ids(draft), ["Accepted", "Screened", "Interview", "Offer", "Hired"]);
  assert.deepEqual(draftToStored(draft, savedStages()), SHIPPED);
  assert.equal(axisEqualsStored(draft, SHIPPED, savedStages()), true);
});

test("a new stage lands BEFORE the terminal column, never after it", () => {
  // Appending would produce an axis the validator rejects (terminal must be
  // last) on literally every add — the editor must not require the reader to
  // fix a self-inflicted error.
  const draft = addStage(start(), "Tech screen", "interview");
  assert.deepEqual(ids(draft), ["Accepted", "Screened", "Interview", "Offer", "Tech screen", "Hired"]);
  assert.deepEqual(axisProblems(draft), []);
});

test("renaming changes the label and NEVER the id — that is what makes it free", () => {
  const draft = renameStage(start(), "Screened", "Recruiter review");
  const stage = draft.stages.find((s) => s.id === "Screened")!;
  assert.equal(stage.label, "Recruiter review");
  assert.equal(stage.id, "Screened", "the stored value every entry/event references is untouched");
  assert.deepEqual(axisProblems(draft), []);
});

test("mintStageId slugifies, bounds, and uniquifies", () => {
  assert.equal(mintStageId("Tech screen", []), "Tech screen");
  assert.equal(mintStageId("Tech screen", ["Tech screen"]), "Tech screen 2");
  assert.equal(mintStageId("Tech screen", ["Tech screen", "Tech screen 2"]), "Tech screen 3");
  assert.equal(mintStageId("Ověření referencí!", []), "Overeni referenci", "diacritics folded, punctuation dropped");
  assert.equal(mintStageId("   ", []), "Stage", "an empty label still yields a usable id");
});

test("removing a SAVED stage retires it; removing a draft-only stage just drops it", () => {
  const added = addStage(start(), "Reference check", "custom");
  const addedId = added.stages.find((s) => !s.saved)!.id;

  const removedNew = removeStage(added, addedId);
  assert.equal(draftToStored(removedNew, savedStages()).retired.length, 0, "never stored ⇒ nothing to tombstone");

  const removedSaved = removeStage(start(), "Interview");
  const stored = draftToStored(removedSaved, savedStages());
  assert.deepEqual(stored.stages.map((s) => s.id), ["Accepted", "Screened", "Offer", "Hired"]);
  assert.deepEqual(stored.retired.map((s) => s.id), ["Interview"], "history can still name the dropped column");
});

test("re-adding a retired id resurrects it instead of leaving it in both lists", () => {
  // The server rejects a stage that is simultaneously live and retired, so the
  // draft must never produce one.
  const dropped = draftToStored(removeStage(start(), "Interview"), savedStages());
  const reopened = draftFromStored(dropped);
  assert.deepEqual(reopened.retired.map((s) => s.id), ["Interview"]);

  const readded = addStage(reopened, "Interview", "interview");
  const newId = readded.stages.find((s) => !s.saved)!.id;
  assert.equal(newId, "Interview 2", "a fresh column gets a fresh id — the old one still labels history");

  // And the explicit resurrection path: put the ORIGINAL id back on the axis.
  const manual: AxisDraft = {
    ...reopened,
    stages: [...reopened.stages.slice(0, 2), { id: "Interview", label: "Interview", role: "interview", saved: true }, ...reopened.stages.slice(2)],
  };
  const out = draftToStored(manual, savedStages());
  assert.equal(out.retired.length, 0, "resurrected out of the tombstones");
  assert.ok(out.stages.some((s) => s.id === "Interview"));
});

test("moveStage reorders, and running off either end is a no-op", () => {
  const draft = moveStage(start(), "Interview", -1);
  assert.deepEqual(ids(draft), ["Accepted", "Interview", "Screened", "Offer", "Hired"]);
  assert.deepEqual(ids(moveStage(start(), "Accepted", -1)), ids(start()));
  assert.deepEqual(ids(moveStage(start(), "Hired", 1)), ids(start()));
});

// ---- validation, and agreement with the server ------------------------------

const serverAccepts = (draft: AxisDraft): boolean =>
  validateDecisionConfig("pipelineStages", draftToStored(draft, savedStages())).ok;

test("the shipped axis is valid on both sides", () => {
  assert.deepEqual(axisProblems(start()), []);
  assert.equal(serverAccepts(start()), true);
});

test("an axis with no entry or no terminal stage is refused by both", () => {
  const noEntry = setStageRole(start(), "Accepted", "screening");
  assert.ok(axisProblems(noEntry).some((p) => p.code === "missingRole"));
  assert.equal(serverAccepts(noEntry), false);

  const noTerminal = setStageRole(start(), "Hired", "custom");
  assert.ok(axisProblems(noTerminal).some((p) => p.code === "missingRole"));
  assert.equal(serverAccepts(noTerminal), false);
});

test("two entry / terminal / offer stages are refused by both", () => {
  for (const role of ["entry", "terminal", "offer"] as const) {
    const dup = setStageRole(start(), "Screened", role);
    assert.ok(
      axisProblems(dup).some((p) => p.code === "duplicateRole" || p.code === "entryNotFirst" || p.code === "terminalNotLast"),
      `${role} duplication must be caught`
    );
    assert.equal(serverAccepts(dup), false, `${role} duplication must be server-refused`);
  }
});

test("entry must lead and terminal must close, on both sides", () => {
  const entryMoved = moveStage(start(), "Accepted", 1);
  assert.ok(entryMoved.stages[0].role !== "entry");
  assert.ok(axisProblems(entryMoved).some((p) => p.code === "entryNotFirst"));
  assert.equal(serverAccepts(entryMoved), false);

  const terminalMoved = moveStage(start(), "Hired", -1);
  assert.ok(axisProblems(terminalMoved).some((p) => p.code === "terminalNotLast"));
  assert.equal(serverAccepts(terminalMoved), false);
});

test("a blank label is refused by the client BEFORE the server sees it", () => {
  const blank = renameStage(start(), "Screened", "   ");
  assert.ok(axisProblems(blank).some((p) => p.code === "emptyLabel"));
  assert.equal(serverAccepts(blank), false);
});

test("duplicate LABELS are refused by the client, deliberately stricter than the wire", () => {
  const dup = renameStage(start(), "Screened", "interview");
  assert.ok(axisProblems(dup).some((p) => p.code === "duplicateLabel"));
  // Legal on the wire (ids are what must be unique) — the client refuses it
  // because two columns reading "Interview" cannot be told apart on the board.
  assert.equal(serverAccepts(dup), true);
});

test("a many-column axis stays valid, which is the point of the whole phase", () => {
  let draft = start();
  for (const label of ["Tech screen", "Onsite", "Panel", "Reference check"]) draft = addStage(draft, label, "interview");
  assert.equal(draft.stages.length, 9);
  assert.deepEqual(axisProblems(draft), []);
  assert.equal(serverAccepts(draft), true);
});

// ---- impact ----------------------------------------------------------------

test("strandedByDraft reports only SAVED columns that are dropped WITH people on them", () => {
  const counts = { Accepted: 17, Screened: 22, Interview: 10, Offer: 3, Hired: 6 };

  assert.deepEqual(strandedByDraft(start(), savedStages(), counts), [], "no removal, nobody stranded");

  const dropInterview = removeStage(start(), "Interview");
  assert.deepEqual(
    strandedByDraft(dropInterview, savedStages(), counts).map((s) => [s.stage.id, s.count]),
    [["Interview", 10]]
  );

  // An empty column is free to remove — warning about it would train the reader
  // to dismiss the warning that matters.
  assert.deepEqual(strandedByDraft(removeStage(start(), "Offer"), savedStages(), { ...counts, Offer: 0 }), []);

  // A stage this draft only added cannot strand anyone.
  const added = addStage(start(), "Panel", "interview");
  const addedId = added.stages.find((s) => !s.saved)!.id;
  assert.deepEqual(strandedByDraft(removeStage(added, addedId), savedStages(), counts), []);
});

test("renaming and reordering strand nobody — only removal can", () => {
  const counts = { Interview: 10 };
  const renamed = renameStage(start(), "Interview", "Onsite");
  const reordered = moveStage(start(), "Interview", -1);
  assert.deepEqual(strandedByDraft(renamed, savedStages(), counts), []);
  assert.deepEqual(strandedByDraft(reordered, savedStages(), counts), []);
});
