// note-truth-unification — the scorecard synthesis is the ONLY task that carries the
// recruiter's persistent candidate note, and it carries whatever value it's handed
// (the drawer feeds the LIVE persistent note, `candNote`, at click time). This pins
// the seam so a future edit can't silently re-introduce a second, diverging notes
// source: every non-scorecard task sends none; scorecard sends the note verbatim.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scorecardTaskNotes, type TaskId } from "./PipelineCandidateDrawerTypes.ts";

test("only the scorecard task carries the note; every other task sends none", () => {
  const NOTE = "wants 80k, available August, hybrid";
  assert.equal(scorecardTaskNotes("scorecard", NOTE), NOTE, "scorecard consumes the persistent note verbatim");

  const others: TaskId[] = ["screen", "outreach", "rejection", "prep", "rematch", "offer"];
  for (const task of others) {
    assert.equal(scorecardTaskNotes(task, NOTE), undefined, `${task} carries no note`);
  }
});

test("the scorecard task passes the CURRENT note through — including an empty one", () => {
  // An emptied note is fed as "" (not undefined), so synthesizing after clearing the
  // box honestly sends no facts rather than a stale earlier value.
  assert.equal(scorecardTaskNotes("scorecard", ""), "", "an empty live note is passed as empty");
});
