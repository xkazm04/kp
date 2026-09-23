// The editor's crash backup as a VERSIONED envelope, restored three-way.
//
// Before: the slot was keyed on the row id alone and spread whole over whatever the
// editor had just loaded, so a backup written against an older version (or another
// candidate's build-from-analysis) silently replaced the fresh form — and because the
// PUT carries the FRESH updatedAt, PROFILE_STALE could not catch it. These cases pin
// the planner that replaces that blind restore: silent only when nothing moved.
//
// Runner: Node's built-in test runner with type stripping. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { backupSlot, makeEnvelope, planRestore } from "./profileEditorBackup.ts";
import { applyBackup } from "./useProfileEditorFields.ts";
import { blankFormState, type ProfileFormState } from "./profileDraftMerge.ts";

function form(over: Partial<ProfileFormState> = {}): ProfileFormState {
  return { ...blankFormState(), displayName: "Jana", roleFamily: "engineering", availability: "1 month", ...over };
}

function envelope(baseVersion: string | null, baseline: ProfileFormState, draft: ProfileFormState): string {
  return JSON.stringify(makeEnvelope({ baseVersion, baseline, draft, savedAt: "2026-09-23T10:00:00.000Z" }));
}

test("1. edit, rebuild, build-from-analysis and blank create each get their own slot", () => {
  const keys = [
    backupSlot({ editingId: "p1" }),
    backupSlot({ editingId: null, sourceAnalysisSlug: "a1" }),
    backupSlot({ editingId: null }),
    backupSlot({ editingId: "p1", sourceAnalysisSlug: "a2" }),
  ];
  assert.equal(new Set(keys).size, 4, keys.join(" | "));
  // Two different analyses never share a build-from-analysis slot either.
  assert.notEqual(backupSlot({ editingId: null, sourceAnalysisSlug: "a1" }), backupSlot({ editingId: null, sourceAnalysisSlug: "a2" }));
});

test("2. same version, same baseline -> silent restore of the draft (today's behaviour kept)", () => {
  const baseline = form();
  const draft = form({ location: "Brno", displayName: "Jana K." });
  const plan = planRestore(envelope("t1", baseline, draft), { baseVersion: "t1", loaded: form() });
  assert.equal(plan.kind, "silent");
  assert.ok(plan.kind === "silent");
  assert.deepEqual(plan.state, draft);
});

test("3. the row moved and the edits do not overlap -> 'moved', recruiter edit applied, server change stands", () => {
  const baseline = form();
  const draft = form({ location: "Brno" });
  const loaded = form({ availability: "immediately" });
  const plan = planRestore(envelope("t1", baseline, draft), { baseVersion: "t2", loaded });
  assert.equal(plan.kind, "moved");
  assert.ok(plan.kind === "moved");
  assert.equal(plan.merged.location, "Brno");
  assert.equal(plan.merged.availability, "immediately");
  assert.deepEqual(plan.contested, []);
});

test("4. both sides changed the same field -> contested, the server's committed value stands", () => {
  const baseline = form({ displayName: "A." });
  const draft = form({ displayName: "Ana" });
  const loaded = form({ displayName: "Anna" });
  const plan = planRestore(envelope("t1", baseline, draft), { baseVersion: "t2", loaded });
  assert.equal(plan.kind, "moved");
  assert.ok(plan.kind === "moved");
  assert.deepEqual(plan.contested, ["displayName"]);
  assert.equal(plan.merged.displayName, "Anna");
  // "Use mine anyway" takes the recruiter's value for the contested field only.
  assert.equal(plan.mine.displayName, "Ana");
});

test("5. an envelope where nothing was typed -> none, and the slot is reported for removal", () => {
  const baseline = form();
  const plan = planRestore(envelope("t1", baseline, form()), { baseVersion: "t2", loaded: form({ location: "Praha" }) });
  assert.deepEqual(plan, { kind: "none", remove: true });
});

test("6. a legacy bare-form slot is OFFERED, never applied silently", () => {
  const loaded = form();
  const raw = JSON.stringify({ displayName: "Typed Name", location: "Brno" });
  const plan = planRestore(raw, { baseVersion: "t1", loaded });
  assert.equal(plan.kind, "offer");
  assert.ok(plan.kind === "offer");
  assert.deepEqual(plan.state, applyBackup(loaded, raw));
  assert.deepEqual([...plan.fields].sort(), ["displayName", "location"]);
});

test("7. unusable raw -> none, and no input is mutated", () => {
  const loaded = form();
  const snapshot = JSON.stringify(loaded);
  for (const raw of [null, undefined, "", "{not json", "null", "[]", '"a string"', "7"]) {
    const plan = planRestore(raw, { baseVersion: "t1", loaded });
    assert.equal(plan.kind, "none", `expected none for ${JSON.stringify(raw)}`);
  }
  const env = makeEnvelope({ baseVersion: "t1", baseline: form({ displayName: "A." }), draft: form({ displayName: "Ana" }), savedAt: "x" });
  const envSnapshot = JSON.stringify(env);
  planRestore(JSON.stringify(env), { baseVersion: "t2", loaded });
  assert.equal(JSON.stringify(loaded), snapshot);
  assert.equal(JSON.stringify(env), envSnapshot);
});

test("8. skills differing only by the client-only _id are not an edit on either side", () => {
  const row = { skill: "React", level: "advanced", provenance: "cv" };
  const baseline = form({ skills: [{ ...row, _id: "a" }] });
  const draft = form({ skills: [{ ...row, _id: "b" }], location: "Brno" });
  const loaded = form({ skills: [{ ...row, _id: "c" }] });
  // Same version: a re-hydrated load (fresh _ids) is still "unchanged" -> silent.
  const same = planRestore(envelope("t1", baseline, draft), { baseVersion: "t1", loaded });
  assert.equal(same.kind, "silent");
  // Moved version: skills are neither applied nor contested.
  const moved = planRestore(envelope("t1", baseline, draft), { baseVersion: "t2", loaded });
  assert.ok(moved.kind === "moved");
  assert.deepEqual(moved.contested, []);
  assert.equal(moved.merged.skills, loaded.skills);
  assert.equal(moved.merged.location, "Brno");
});
