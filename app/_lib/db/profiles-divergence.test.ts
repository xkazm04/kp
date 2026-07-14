// profileDivergence — "rebuild that respects hand edits".
//
// A profile built FROM a CV analysis carries lineage; a later same-CV analysis flags
// it stale and offers Rebuild. If the recruiter hand-edited the profile in between,
// Rebuild must WARN before re-hydrating from the analysis (which would clobber those
// edits). This proves the divergence signal the warning reads from:
//   - a fresh build-from-analysis is NOT diverged (updated_at == lineage_stamped_at),
//   - a hand edit AFTER the build IS diverged (updated_at > lineage_stamped_at),
//   - a hand-built (NULL-lineage) profile is never diverged,
//   - a rebuild (setProfileLineage) re-anchors and clears divergence,
//   - an unknown id returns null.
//
// testing/unit-db.ts MUST be the first project import — it points KP_DB_PATH at a
// throwaway file before core.ts opens the store.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  saveProfile,
  updateProfile,
  setProfileLineage,
  profileDivergence,
} from "./profiles.ts";

after(() => cleanupUnitDb());

const WS = "ws-divergence";
const input = {
  label: "P",
  archetype: "bau",
  roleFamily: "engineering_backend",
  completeness: 0.8,
  payload: { displayName: "P" },
};
const lineage = { sourceAnalysisSlug: "a-src", sourceCvHash: "hash-x", sourceAnalyzedAt: "2026-01-01T00:00:00.000Z" };

test("a fresh build-from-analysis is not diverged", () => {
  const { id } = saveProfile({ ...input, label: "Built" }, WS, lineage);
  const div = profileDivergence(id, WS);
  assert.equal(div?.diverged, false, "just built ⇒ updated_at == lineage_stamped_at ⇒ not diverged");
  assert.ok(div?.editedAt, "editedAt is populated (seeded to created_at)");
});

test("a hand edit after the build diverges", async () => {
  const { id } = saveProfile({ ...input, label: "Edited" }, WS, lineage);
  // updateProfile stamps updated_at = now(); ensure it lands strictly after the build.
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(updateProfile(id, { ...input, label: "Edited by hand" }, WS));
  const div = profileDivergence(id, WS);
  assert.equal(div?.diverged, true, "edited after build ⇒ updated_at > lineage_stamped_at ⇒ diverged");
});

test("a hand-built (NULL lineage) profile is never diverged", () => {
  const { id } = saveProfile({ ...input, label: "HandBuilt" }, WS); // no lineage
  const div = profileDivergence(id, WS);
  assert.equal(div?.diverged, false, "no lineage_stamped_at ⇒ divergence unprovable ⇒ not diverged");
});

test("a rebuild re-anchors lineage and clears divergence", async () => {
  const { id } = saveProfile({ ...input, label: "ToRebuild" }, WS, lineage);
  await new Promise((r) => setTimeout(r, 5));
  updateProfile(id, { ...input, label: "hand edit" }, WS);
  assert.equal(profileDivergence(id, WS)?.diverged, true, "edited ⇒ diverged");
  // Rebuild path: updateProfile (re-route/score) then setProfileLineage (re-anchor).
  await new Promise((r) => setTimeout(r, 5));
  updateProfile(id, { ...input, label: "rebuilt from newer analysis" }, WS);
  setProfileLineage(id, { ...lineage, sourceAnalysisSlug: "a-newer", sourceAnalyzedAt: "2026-03-01T00:00:00.000Z" }, WS);
  assert.equal(profileDivergence(id, WS)?.diverged, false, "post-rebuild ⇒ lineage_stamped_at ≥ updated_at ⇒ clean");
});

test("an unknown id returns null", () => {
  assert.equal(profileDivergence("nope", WS), null);
});
