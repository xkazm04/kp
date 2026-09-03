// Pins mergeDraft — the rule that decides what an AI draft is allowed to overwrite
// inside the OPEN profile editor.
//
// Before this existed, `applyDraft` set every field from the draft unconditionally:
// a recruiter who typed a name, three skills and an availability line, then pasted
// notes into the AI panel, lost all of it with no diff, no confirm and no undo —
// while the tab-level rebuild path guarded exactly this case with a divergence
// check and a warn modal. mergeDraft is that guard, made pure and testable.
//
// The rule, in one line: a field the recruiter has CHANGED SINCE LOAD wins over a
// differing draft value, and every such field is reported so the UI can offer
// "use the draft anyway".
//
// Runner: Node's built-in test runner with type stripping. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { blankFormState, mergeDraft, type ProfileFormState } from "./profileDraftMerge.ts";

function state(over: Partial<ProfileFormState> = {}): ProfileFormState {
  return { ...blankFormState(), ...over };
}

test("an untouched field takes the draft's value", () => {
  const baseline = state({ displayName: "", location: "" });
  const current = state({ displayName: "", location: "" });
  const draft = state({ displayName: "Jana Nováková", location: "Praha" });

  const { merged, kept } = mergeDraft(current, baseline, draft);
  assert.equal(merged.displayName, "Jana Nováková");
  assert.equal(merged.location, "Praha");
  assert.deepEqual(kept, []);
});

test("a field the recruiter changed since load is KEPT, and reported", () => {
  const baseline = state({ displayName: "", availability: "" });
  // The recruiter typed a name by hand; availability is still untouched.
  const current = state({ displayName: "Jana N.", availability: "" });
  const draft = state({ displayName: "Jana Nováková", availability: "from July" });

  const { merged, kept } = mergeDraft(current, baseline, draft);
  assert.equal(merged.displayName, "Jana N.", "the hand-typed name survives the draft");
  assert.equal(merged.availability, "from July", "an untouched field still hydrates");
  assert.deepEqual(kept, ["displayName"]);
});

test("a hand edit that AGREES with the draft is not a conflict", () => {
  const baseline = state({ location: "" });
  const current = state({ location: "Praha" });
  const draft = state({ location: "Praha" });

  const { merged, kept } = mergeDraft(current, baseline, draft);
  assert.equal(merged.location, "Praha");
  assert.deepEqual(kept, [], "identical values are not a conflict to confirm");
});

test("a draft that leaves a field EMPTY never blanks a value the recruiter typed", () => {
  const baseline = state({ aspirations: "" });
  const current = state({ aspirations: "Junior frontend developer" });
  const draft = state({ aspirations: "" });

  const { merged, kept } = mergeDraft(current, baseline, draft);
  assert.equal(merged.aspirations, "Junior frontend developer");
  assert.deepEqual(kept, ["aspirations"]);
});

test("row lists compare by content, ignoring the client-only _id", () => {
  const rows = [{ skill: "React", level: "working", provenance: "self_declared", _id: "a" }];
  const same = [{ skill: "React", level: "working", provenance: "self_declared", _id: "b" }];
  const baseline = state({ skills: rows });
  const current = state({ skills: same });
  const draft = state({ skills: [{ skill: "TypeScript", level: "strong", provenance: "professional", _id: "c" }] });

  // current == baseline once _id is ignored ⇒ untouched ⇒ the draft's rows win.
  const { merged, kept } = mergeDraft(current, baseline, draft);
  assert.equal(merged.skills[0].skill, "TypeScript");
  assert.deepEqual(kept, []);
});

test("edited skill rows are kept and reported", () => {
  const baseline = state({ skills: [] });
  const current = state({ skills: [{ skill: "React", level: "working", provenance: "self_declared", _id: "a" }] });
  const draft = state({ skills: [{ skill: "Go", level: "strong", provenance: "professional", _id: "z" }] });

  const { merged, kept } = mergeDraft(current, baseline, draft);
  assert.equal(merged.skills[0].skill, "React");
  assert.deepEqual(kept, ["skills"]);
});

test("boolean signals follow the same rule", () => {
  const baseline = state({ isEnrolled: false, wantsDomainChange: false });
  const current = state({ isEnrolled: true, wantsDomainChange: false });
  const draft = state({ isEnrolled: false, wantsDomainChange: true });

  const { merged, kept } = mergeDraft(current, baseline, draft);
  assert.equal(merged.isEnrolled, true, "the recruiter's tick survives");
  assert.equal(merged.wantsDomainChange, true, "an untouched flag takes the draft");
  assert.deepEqual(kept, ["isEnrolled"]);
});

test("mergeDraft is pure — it mutates none of its three inputs", () => {
  const baseline = state({ displayName: "" });
  const current = state({ displayName: "Jana N.", skills: [{ skill: "React", level: "working", provenance: "self_declared" }] });
  const draft = state({ displayName: "Jana Nováková" });
  const currentSnapshot = JSON.stringify(current);
  const draftSnapshot = JSON.stringify(draft);

  mergeDraft(current, baseline, draft);
  assert.equal(JSON.stringify(current), currentSnapshot);
  assert.equal(JSON.stringify(draft), draftSnapshot);
});

test("every form field participates in the merge — no field silently always-overwrites", () => {
  const baseline = blankFormState();
  // Every key differs from blank in BOTH current and draft, in different ways.
  const current = state({
    choice: "student", isEnrolled: true, expectedGraduation: "2026", wantsDomainChange: true,
    hasSubstantialExperience: true, displayName: "A", roleFamily: "data_ai", educationLevel: "master",
    educationDetail: "A", languages: "cs", location: "Brno", availability: "now", yearsExperience: "3",
    seniority: "medior", aspirations: "A",
    skills: [{ skill: "A", level: "working", provenance: "self_declared" }],
    evidence: [{ kind: "project", title: "A", text: "", skills: "", link: "" }],
  });
  const draft = state({
    choice: "bau", isEnrolled: false, expectedGraduation: "2030", wantsDomainChange: false,
    hasSubstantialExperience: false, displayName: "B", roleFamily: "finance_accounting", educationLevel: "phd",
    educationDetail: "B", languages: "de", location: "Praha", availability: "later", yearsExperience: "9",
    seniority: "senior", aspirations: "B",
    skills: [{ skill: "B", level: "strong", provenance: "professional" }],
    evidence: [{ kind: "job", title: "B", text: "", skills: "", link: "" }],
  });

  const { merged, kept } = mergeDraft(current, baseline, draft);
  assert.deepEqual(kept.slice().sort(), Object.keys(baseline).sort(), "every field must be conflict-aware");
  assert.deepEqual(JSON.parse(JSON.stringify(merged)), JSON.parse(JSON.stringify(current)));
});
