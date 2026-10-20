// Pins the rebuild-from-a-newer-CV plan (challenge-r03 candidate-profile/B).
//
// A profile is built from a CV analysis (the SOURCE), then hand-edited (CURRENT), then
// a NEWER analysis of the same CV lands. The rebuild used to be a two-button choice:
// keep the edits and lose the newer CV, or take the newer CV and lose every edit. The
// plan is a three-way, field-level merge: a field nobody touched takes the newer CV, a
// field the recruiter edited that the newer CV did not change is kept silently, and
// only a field BOTH sides changed (differently) is contested — the one thing worth a
// question. No contested field means no dialog at all.
//
// Runner: Node's built-in test runner with type stripping. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankFormState, PROFILE_FORM_FIELDS, type ProfileFormState } from "./profileDraftMerge.ts";
import {
  planRebuild,
  planRebuildFromPayloads,
  rebuildDialogModel,
  rebuildEditorState,
  REBUILD_FIELD_LABEL_KEY,
} from "./profileRebuildMerge.ts";

function state(over: Partial<ProfileFormState> = {}): ProfileFormState {
  return { ...blankFormState(), ...over };
}

const P = state({
  displayName: "Jana Novak",
  availability: "from July",
  location: "Praha",
  skills: [{ skill: "Python", level: "working", provenance: "cv", _id: "a" }],
});

test("case 1: no hand edits -> the newer CV wins everywhere and no dialog is raised", () => {
  const newer = { ...P, skills: [{ skill: "Go", level: "working", provenance: "cv" }, { skill: "SQL", level: "working", provenance: "cv" }] };
  const plan = planRebuild({ current: P, source: P, newer });
  assert.deepEqual(plan.merged.skills, newer.skills);
  assert.deepEqual(plan.contested, []);
  assert.deepEqual(plan.preserved, []);
  assert.equal(plan.needsConfirm, false);
  assert.equal(plan.mode, "three-way");
});

test("case 2: an edit the newer CV also changed is contested; an edit it did not touch is preserved silently", () => {
  const source = P;
  const current = { ...P, displayName: "Jana Nováková", availability: "immediately" };
  const newer = { ...P, displayName: "J. Novak", skills: [{ skill: "Go", level: "strong", provenance: "cv" }] };
  const plan = planRebuild({ current, source, newer });
  assert.equal(plan.merged.displayName, "Jana Nováková", "the hand edit is kept");
  assert.equal(plan.merged.availability, "immediately", "an edit the new CV did not change is kept");
  assert.deepEqual(plan.merged.skills, newer.skills, "an untouched field takes the newer CV");
  assert.deepEqual(plan.contested, ["displayName"], "only fields BOTH sides changed are contested");
  assert.deepEqual(plan.preserved, ["availability"]);
  assert.equal(plan.needsConfirm, true);
});

test("case 3: re-minted skill-row _ids are not hand edits", () => {
  const current = { ...P, skills: P.skills.map((s) => ({ ...s, _id: "re-minted-1" })) };
  const newer = { ...P, displayName: "J. Novak", skills: P.skills.map((s) => ({ ...s, _id: "re-minted-2" })) };
  const plan = planRebuild({ current, source: P, newer });
  assert.deepEqual(plan.contested, []);
  assert.deepEqual(plan.preserved, []);
  assert.equal(plan.merged.displayName, "J. Novak");
});

test("case 4: no source baseline -> keep current everywhere, contest every field that differs from the newer CV", () => {
  const current = { ...P, displayName: "Jana Nováková" };
  const newer = { ...P, displayName: "J. Novak", location: "Brno" };
  const plan = planRebuild({ current, source: null, newer });
  assert.equal(plan.mode, "unknown-baseline");
  assert.deepEqual(plan.merged, current, "never silently overwrite what cannot be attributed");
  assert.deepEqual(plan.contested, ["displayName", "location"]);
  assert.equal(plan.needsConfirm, true);
});

test("case 5: the editor opens on the merge with the rebuild as an undoable pending draft", () => {
  const current = { ...P, displayName: "Jana Nováková" };
  const newer = { ...P, displayName: "J. Novak", location: "Brno" };
  const plan = planRebuild({ current, source: P, newer });
  const seed = rebuildEditorState(plan);
  assert.deepEqual(seed.state, plan.merged);
  assert.deepEqual(seed.pending, { before: current, draft: newer, kept: ["displayName"], origin: "rebuild" });
});

test("case 7: the dialog view-model names the contested fields and offers merge / keep / replace, merge by default", () => {
  const current = { ...P, displayName: "Jana Nováková" };
  const newer = { ...P, displayName: "J. Novak" };
  assert.deepEqual(rebuildDialogModel(planRebuild({ current, source: P, newer })), {
    contestedFields: ["displayName"],
    actions: ["merge", "keep", "replace"],
    default: "merge",
  });
  assert.equal(rebuildDialogModel(planRebuild({ current: P, source: P, newer })), null, "nothing contested -> no dialog");
});

test("payloads are planned through the ONE payload->form mapping", () => {
  const plan = planRebuildFromPayloads(
    { displayName: "Jana Nováková", location: "Praha" },
    { displayName: "Jana Novak", location: "Praha" },
    { displayName: "J. Novak", location: "Brno" }
  );
  assert.deepEqual(plan.contested, ["displayName"]);
  assert.equal(plan.merged.location, "Brno");
  assert.equal(plan.merged.displayName, "Jana Nováková");
});

test("every form field has a localized label key that exists in the profile catalog", () => {
  const en = JSON.parse(readFileSync(new URL("../../../../messages/en.json", import.meta.url), "utf8")) as {
    profile: Record<string, Record<string, unknown>>;
  };
  for (const field of PROFILE_FORM_FIELDS) {
    const key = REBUILD_FIELD_LABEL_KEY[field];
    assert.ok(key, `${field} has a label key`);
    const [ns, leaf] = key.split(".");
    assert.equal(typeof en.profile[ns]?.[leaf], "string", `profile.${key} exists`);
  }
});
