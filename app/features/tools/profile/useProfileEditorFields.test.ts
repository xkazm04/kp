// The two halves of the editor's sessionStorage safety net, pinned at RUNTIME.
//
// The hook's own comments document what each regression cost — a per-render baseline
// that reported every row as hand-edited, a restore that blanked fields a newer build
// had added, a keying mistake that would restore profile A's intake into B. None of it
// was executed by a test: the logic sat inside an effect, so only a rendered editor
// could reach it. The parse/merge and the key are pure functions now, and this runs them.
//
// Runner: Node's built-in test runner with type stripping. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyBackup, profileEditorBackupKey } from "./useProfileEditorFields.ts";
import type { ProfileFormState } from "./profileDraftMerge.ts";

const STATE: ProfileFormState = {
  choice: "auto",
  isEnrolled: false,
  expectedGraduation: "",
  wantsDomainChange: false,
  hasSubstantialExperience: false,
  displayName: "Loaded Name",
  roleFamily: "engineering",
  educationLevel: "",
  educationDetail: "",
  languages: "",
  location: "",
  availability: "",
  yearsExperience: "",
  seniority: "",
  aspirations: "",
  skills: [],
  evidence: [],
};

test("a backup restores over the loaded state, field by field", () => {
  const restored = applyBackup(STATE, JSON.stringify({ displayName: "Typed Name", location: "Brno" }));
  assert.equal(restored.displayName, "Typed Name");
  assert.equal(restored.location, "Brno");
  // Everything the backup did not carry survives — an older build's backup must not
  // blank the fields this build added.
  assert.equal(restored.roleFamily, "engineering");
  assert.equal(restored.choice, "auto");
});

test("an unusable slot returns the SAME state object, so React bails out", () => {
  for (const raw of [null, undefined, "", "{not json", "null", "[]", '"a string"', "7"]) {
    assert.equal(applyBackup(STATE, raw), STATE, `expected identity for ${JSON.stringify(raw)}`);
  }
});

test("the input state is never mutated", () => {
  applyBackup(STATE, JSON.stringify({ displayName: "Typed Name" }));
  assert.equal(STATE.displayName, "Loaded Name");
});

test("the backup key is per profile, and a create shares the 'new' slot", () => {
  assert.equal(profileEditorBackupKey("p1"), "kp.profileEditor.p1");
  assert.notEqual(profileEditorBackupKey("p1"), profileEditorBackupKey("p2"));
  assert.equal(profileEditorBackupKey(null), "kp.profileEditor.new");
});

test("a second tab editing another profile cannot restore into this one", () => {
  // The keying IS the isolation: same slot only for the same id.
  const a = applyBackup(STATE, JSON.stringify({ displayName: "A" }));
  assert.equal(a.displayName, "A");
  assert.notEqual(profileEditorBackupKey("a"), profileEditorBackupKey("b"));
});
