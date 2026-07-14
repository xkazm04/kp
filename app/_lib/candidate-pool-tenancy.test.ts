// Candidate-pool tenancy + honesty — behavioral store test.
//
// candidate-pool.ts was the last UNSCOPED resolver: buildCandidatePool /
// resolveCandidatePoolEntry read at the default workspace regardless of the
// caller's tenant, and the legacy-analysis fallback stamped archetype "bau" (a
// NOT-fairness-protected class the rest of the app abandoned for "unknown"). This
// pins the fix:
//   - every read is workspace-scoped: a job in workspace A never sees B's pool,
//     and a cross-workspace id resolves to nothing;
//   - a legacy analysis (no v2Profile) folds to the honest "unknown" sentinel,
//     never "bau";
//   - the cap-overflow is surfaced to callers as a `truncated` flag (not a silent
//     console-only drop).
//
// testing/unit-db.ts MUST be the first project import — it points KP_DB_PATH at a
// throwaway file before core.ts opens the store, so this never touches real data.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { saveAnalysis } from "./db/analyses.ts";
import { saveProfile } from "./db/profiles.ts";
import {
  ANALYSIS_POOL_CAP,
  buildCandidatePool,
  resolveCandidatePoolEntry,
  type CandidatePoolEntry,
} from "./candidate-pool.ts";

after(() => cleanupUnitDb());

const WS_A = "ws-pool-a";
const WS_B = "ws-pool-b";

const profileInput = {
  label: "Profile Person",
  archetype: "bau",
  roleFamily: "engineering_backend",
  completeness: 0.9,
  payload: { displayName: "Profile Person", skills: ["ts"] },
};
const analysisBase = {
  candidateLabel: "Legacy.pdf",
  jdSlug: null,
  score: 71,
  roleFamily: "engineering_backend",
  seniority: "senior",
};

const labelsOf = (entries: CandidatePoolEntry[]) => new Set(entries.map((e) => e.label));

test("buildCandidatePool is workspace-scoped — another tenant's profiles/analyses never leak in", () => {
  const pA = saveProfile({ ...profileInput, label: "A-profile" }, WS_A);
  saveProfile({ ...profileInput, label: "B-profile" }, WS_B);
  saveAnalysis({ ...analysisBase, candidateLabel: "A-analysis", payload: { candidate: {} } }, WS_A);
  saveAnalysis({ ...analysisBase, candidateLabel: "B-analysis", payload: { candidate: {} } }, WS_B);

  const a = buildCandidatePool(WS_A);
  const labels = labelsOf(a.entries);
  assert.ok(labels.has("A-profile"), "workspace A sees its own profile");
  assert.ok(labels.has("A-analysis"), "workspace A sees its own analysis");
  assert.ok(!labels.has("B-profile"), "workspace B's profile does NOT leak into A's pool");
  assert.ok(!labels.has("B-analysis"), "workspace B's analysis does NOT leak into A's pool");
  // The profile entry carries the payload under `profile`.
  const profEntry = a.entries.find((e) => e.id === pA.id);
  assert.ok(profEntry && "profile" in profEntry, "a saved profile becomes a `profile` pool entry");
});

test("a legacy analysis (no v2Profile) folds to the honest 'unknown' archetype, never 'bau'", () => {
  saveAnalysis(
    { ...analysisBase, candidateLabel: "NoV2.pdf", payload: { candidate: { skills: ["go"] } } },
    WS_A
  );
  const entry = buildCandidatePool(WS_A).entries.find((e) => e.label === "NoV2.pdf");
  assert.ok(entry && "candidate" in entry, "a v2-less analysis becomes a flat `candidate` entry");
  assert.equal(entry.candidate.archetype, "unknown", "the fallback is the honest sentinel, not 'bau'");
});

test("resolveCandidatePoolEntry resolves within a workspace and NOT across tenants", () => {
  const prof = saveProfile({ ...profileInput, label: "Resolvable" }, WS_A);
  const ana = saveAnalysis({ ...analysisBase, candidateLabel: "ResolvableCV.pdf", payload: { candidate: {} } }, WS_A);

  assert.ok(resolveCandidatePoolEntry(prof.id, undefined, WS_A), "a profile resolves in its own workspace");
  assert.ok(resolveCandidatePoolEntry(ana.slug, undefined, WS_A), "an analysis resolves in its own workspace");
  assert.equal(resolveCandidatePoolEntry(prof.id, undefined, WS_B), null, "a profile id does NOT resolve in another tenant");
  assert.equal(resolveCandidatePoolEntry(ana.slug, undefined, WS_B), null, "an analysis slug does NOT resolve in another tenant");
  assert.equal(resolveCandidatePoolEntry("does-not-exist", undefined, WS_A), null, "an unknown id resolves null");
});

test("truncated is false under the caps and true once a cap fills", () => {
  const ws = "ws-pool-cap";
  // A small pool never trips the flag.
  saveProfile({ ...profileInput, label: "solo" }, ws);
  assert.equal(buildCandidatePool(ws).truncated, false, "a pool under the caps is not truncated");

  // Fill the (smaller) analysis cap exactly — the overflow signal must fire.
  for (let i = 0; i < ANALYSIS_POOL_CAP; i++) {
    saveAnalysis({ ...analysisBase, candidateLabel: `cap-${i}.pdf`, payload: { candidate: {} } }, ws);
  }
  assert.equal(buildCandidatePool(ws).truncated, true, "hitting a cap surfaces truncated=true to callers");
});
