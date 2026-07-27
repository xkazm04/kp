// gap-followup-candidate — the persistence half: an entry's still-unmet profile
// checklist gaps are RECORDED on the row (additive column) so the candidate can
// be asked about them after applying, and so an unanswered one survives. Runs
// against an ISOLATED throwaway DB (testing/unit-db.ts must stay the first
// project import).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { ensureDb } from "./core.ts";
import {
  createPipelineEntry,
  ensureLeadEnrichToken,
  entryProfileGaps,
  findEntryByLeadToken,
  setEntryProfileGaps,
} from "./pipeline.ts";

after(() => cleanupUnitDb());

let seq = 0;
function addEntry() {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `gaps-c${seq}`,
    candidateLabel: `Gap Tester ${seq}`,
    jobId: `gaps-job-${seq}`,
    jobTitle: "Gap Test Role",
  });
  return entry;
}

test("gaps round-trip on the entry and are REPLACED, never appended", () => {
  const entry = addEntry();
  assert.deepEqual(entryProfileGaps(entry.id), [], "a fresh entry has nothing recorded");

  setEntryProfileGaps(entry.id, [
    { check: "has_project_or_thesis", label: "A project or thesis" },
    { check: "has_languages", label: "Languages" },
  ]);
  assert.deepEqual(
    entryProfileGaps(entry.id).map((g) => g.check),
    ["has_project_or_thesis", "has_languages"]
  );

  // What the follow-up route writes after a merge: the FRESH list from the
  // re-normalization. The answered gap is gone; the unanswered one stays.
  setEntryProfileGaps(entry.id, [{ check: "has_languages", label: "Languages" }]);
  assert.deepEqual(
    entryProfileGaps(entry.id).map((g) => g.check),
    ["has_languages"],
    "the previous list is replaced wholesale — a closed gap can't resurrect"
  );

  // Everything answered ⇒ nothing left to ask.
  setEntryProfileGaps(entry.id, []);
  assert.deepEqual(entryProfileGaps(entry.id), []);
});

test("the recorded list is bounded at write, and unknown entries are a no-op", () => {
  const entry = addEntry();
  setEntryProfileGaps(
    entry.id,
    Array.from({ length: 30 }, (_, i) => ({ check: `check_${i}`, label: "x".repeat(400) }))
  );
  const stored = entryProfileGaps(entry.id);
  assert.ok(stored.length <= 12, `expected the list capped, got ${stored.length}`);
  assert.ok(stored.every((g) => g.label.length <= 160), "labels are capped");

  assert.equal(setEntryProfileGaps("no-such-entry", [{ check: "has_years", label: "Years" }]), false);
  assert.deepEqual(entryProfileGaps("no-such-entry"), []);
});

test("the candidate reaches their own gaps through the capability token, never an entry id", () => {
  const entry = addEntry();
  setEntryProfileGaps(entry.id, [{ check: "has_years", label: "Years of experience" }]);
  const token = ensureLeadEnrichToken(entry.id);
  assert.ok(token && token !== entry.id, "the token is opaque and is NOT the entry id");

  const target = findEntryByLeadToken(token);
  assert.ok(target, "the token resolves to its entry");
  assert.equal(target.entry.id, entry.id);
  assert.deepEqual(
    target.profileGaps.map((g) => g.check),
    ["has_years"],
    "the token lookup carries the recorded gaps to the candidate surface"
  );

  // A wrong/blank token resolves to nothing at all.
  assert.equal(findEntryByLeadToken("ld-not-a-real-token"), null);
  assert.equal(findEntryByLeadToken(""), null);
  // …and the entry id is NOT a usable key.
  assert.equal(findEntryByLeadToken(entry.id), null);
});

test("a corrupt gaps column degrades to no questions, never a crash or a fabricated one", () => {
  const entry = addEntry();
  setEntryProfileGaps(entry.id, [{ check: "has_job", label: "Work experience" }]);
  // Simulate a garbled column the same way the read boundary must survive it.
  ensureDb().prepare(`UPDATE pipeline_entries SET profile_gaps_json = ? WHERE id = ?`).run("{not json", entry.id);
  assert.deepEqual(entryProfileGaps(entry.id), []);
});
