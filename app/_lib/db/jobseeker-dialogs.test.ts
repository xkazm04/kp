// The dialog store's compare-and-swap: a reply computed against a stale row version
// answers `moved` and writes nothing. Isolated throwaway DB — unit-db.ts must be the
// first project import (it sets KP_DB_PATH before any store opens a connection).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { appendDialogTurns, closeDialog, createDialog, getDialog, listDialogs } from "./jobseeker-dialogs.ts";

after(() => cleanupUnitDb());

const opening = [{ role: "interviewer" as const, text: "Tell me about your CV." }];

test("appendDialogTurns: ok on the version it read, moved on a stale one, missing once closed", () => {
  const dialog = createDialog({ profileId: "jsp-1", kind: "cv_polish", postingId: null, lang: "en", opening });
  assert.equal(dialog.status, "open");
  assert.equal(dialog.transcript.length, 1);

  const first = appendDialogTurns(dialog.id, dialog.updatedAt, [{ role: "candidate", text: "Here it is." }], null, false);
  assert.equal(first, "ok");
  const afterFirst = getDialog(dialog.id)!;
  assert.equal(afterFirst.transcript.length, 2);
  assert.notEqual(afterFirst.updatedAt, dialog.updatedAt, "a landed write moves the version");

  // A second reply computed against the ORIGINAL version (the one before `first` landed).
  const stale = appendDialogTurns(dialog.id, dialog.updatedAt, [{ role: "interviewer", text: "stale reply" }], null, false);
  assert.equal(stale, "moved");
  const afterStale = getDialog(dialog.id)!;
  assert.equal(afterStale.transcript.length, 2, "the stale write must not land");
  assert.equal(afterStale.updatedAt, afterFirst.updatedAt, "…and must not touch the version");

  // The artifact rides with a done=true write, which closes the dialog.
  const artifact = { verdict: "apply" as const, gaps: [], coverNoteMd: null, questionsToAsk: [] };
  const done = appendDialogTurns(afterFirst.id, afterFirst.updatedAt, [{ role: "interviewer", text: "Go for it." }], artifact, true);
  assert.equal(done, "ok");
  const closed = getDialog(dialog.id)!;
  assert.equal(closed.status, "closed");
  assert.deepEqual(closed.artifact, artifact);
  assert.equal(closed.transcript.length, 3);

  assert.equal(
    appendDialogTurns(closed.id, closed.updatedAt, [{ role: "candidate", text: "one more" }], null, false),
    "missing",
    "a closed dialog accepts no more turns"
  );
});

test("closeDialog is idempotent and a dialog is missing across workspaces", () => {
  const dialog = createDialog({ profileId: "jsp-2", kind: "fit", postingId: "jpo-1", lang: "cs", opening });
  assert.equal(getDialog(dialog.id, "another-workspace"), null, "a leaked id resolves nothing elsewhere");
  assert.equal(closeDialog(dialog.id), true);
  assert.equal(closeDialog(dialog.id), false);
  assert.equal(listDialogs("jsp-2").map((d) => d.id).includes(dialog.id), true);
  assert.equal(listDialogs("jsp-2", "another-workspace").length, 0);
});
