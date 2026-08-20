// Direction 1 — prep-pack staleness. A prep artifact is generated once and only
// regenerates on an explicit click, so a JD edited AFTER generation flows silently
// stale into the interview. prepJdEditedAt joins the entry to its JD via the
// load-bearing jd-<slug> identity; isPrepStale compares that to the prep's
// createdAt; listPreparedEntries carries the flag onto each schedule card. This
// mirrors the analyses roster's jdEditedAt treatment (jd-staleness.test.ts) for the
// prep artifact, and proves the honest derivation end-to-end against an isolated DB.
//
//   npm run test:unit
import "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { saveJd, updateJd } from "./db/jobs.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import { jdJobId } from "./jd-limits.ts";
import { saveInterviewPrep, getInterviewPrep, prepJdEditedAt, isPrepStale, listPreparedEntries } from "./interview-prep.ts";

after(() => cleanupUnitDb());

const WS = "ws-prep-stale";

/** Advance the wall clock by at least one millisecond. Both timestamps compared
 *  here (a prep's created_at, a jd_revisions row) are ISO milliseconds written by
 *  sub-millisecond SQLite writes, so without this the ordering a test asserts can
 *  collapse into a single tick and the assertion turns into a coin flip. */
const tick = () => {
  const t = Date.now();
  while (Date.now() === t) {
    /* spin — at most 1ms */
  }
};

// Seed a JD-backed pipeline entry + a prep artifact for it, returning the ids so
// the test drives the real jobId → jd-<slug> identity, not a hand-derived one.
function seedPreparedEntry(suffix: string): { entryId: string; slug: string } {
  const jd = saveJd({ title: `Role ${suffix}`, body: "v1" }, WS);
  const { entry } = createPipelineEntry({
    candidateId: `cand-${suffix}`,
    candidateLabel: `Cand ${suffix}`,
    jobId: jdJobId(jd.slug),
    jobTitle: `Role ${suffix}`,
    stage: "Interview",
    workspaceId: WS,
  });
  saveInterviewPrep(entry.id, entry.candidateLabel, entry.jobTitle, {
    scenario: "A 20-minute structured interview.",
    durationMin: 20,
    focusAreas: [],
    chronology: [],
    signals: [],
    source: "llm",
  });
  return { entryId: entry.id, slug: jd.slug };
}

test("isPrepStale: only a JD edit AFTER the prep counts", () => {
  assert.equal(isPrepStale("2026-01-02T00:00:00.000Z", null), false, "no JD edit ⇒ never stale");
  assert.equal(isPrepStale("2026-01-02T00:00:00.000Z", "2026-01-01T00:00:00.000Z"), false, "edit before the prep ⇒ fresh");
  assert.equal(isPrepStale("2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z"), true, "edit after the prep ⇒ stale");
});

test("a never-edited JD leaves the prep fresh; an edit makes it stale", () => {
  const { entryId, slug } = seedPreparedEntry("a");
  // No JD edit yet — no last-edited timestamp, so the pack is not stale.
  assert.equal(prepJdEditedAt(entryId, WS), null);
  assert.equal(listPreparedEntries([entryId], WS)[entryId].stale, false);

  // Edit the JD body AFTER the prep was generated → the pack now reflects old text.
  const ok = updateJd(slug, { title: "Role a", body: "v2" }, undefined, WS);
  assert.deepEqual(ok, { ok: true });
  assert.ok(prepJdEditedAt(entryId, WS), "an edited JD advances the last-edited marker");
  assert.equal(listPreparedEntries([entryId], WS)[entryId].stale, true, "the schedule card now flags the pack stale");
});

test("staleness is workspace-scoped: another team's JD edit doesn't leak", () => {
  const { entryId } = seedPreparedEntry("scoped");
  // Reading under a different workspace resolves no entry → no JD → no chip.
  assert.equal(prepJdEditedAt(entryId, "ws-other"), null);
});

// A non-regeneration write must NOT move the generation stamp. The import (POST)
// and weave (PATCH) routes round-trip the payload through saveInterviewPrep, and
// while that upsert bumped created_at unconditionally, importing a question after
// a JD edit pushed the stamp past the edit and the stale chip silently vanished —
// on a pack whose chronology still described the OLD role.
test("an import-style payload write keeps the pack stale (created_at is the GENERATION stamp)", () => {
  const { entryId, slug } = seedPreparedEntry("import");
  const generatedAt = listPreparedEntries([entryId], WS)[entryId].createdAt;

  // JD edited after the pack was generated → stale. (These stamps are ISO
  // milliseconds and the writes are sub-millisecond, so step the clock explicitly
  // rather than letting the ordering depend on how fast SQLite happened to be.)
  tick();
  assert.deepEqual(updateJd(slug, { title: "Role import", body: "v2" }, undefined, WS), { ok: true });
  assert.equal(listPreparedEntries([entryId], WS)[entryId].stale, true, "the JD edit makes the pack stale");
  tick();

  // The exact read-merge-write the import POST / weave PATCH perform: same plan,
  // one extra payload key, no regeneration.
  const existing = getInterviewPrep(entryId)!;
  saveInterviewPrep(entryId, existing.candidateLabel, existing.jobTitle, {
    ...existing.payload,
    importedQuestions: ["Describe a system you owned end-to-end."],
  });

  const after = listPreparedEntries([entryId], WS)[entryId];
  assert.equal(after.createdAt, generatedAt, "an import must not move the generation stamp");
  assert.equal(after.stale, true, "the pack is still built against the OLD JD — the chip must stay");
});

test("a regeneration DOES move the stamp and clears the stale flag", () => {
  const { entryId, slug } = seedPreparedEntry("regen");
  tick();
  assert.deepEqual(updateJd(slug, { title: "Role regen", body: "v2" }, undefined, WS), { ok: true });
  assert.equal(listPreparedEntries([entryId], WS)[entryId].stale, true);
  tick();

  // What runInterviewPrep does: rebuild the plan and declare it a regeneration.
  const existing = getInterviewPrep(entryId)!;
  saveInterviewPrep(entryId, existing.candidateLabel, existing.jobTitle, { ...existing.payload, scenario: "rebuilt" }, { regenerated: true });

  assert.equal(listPreparedEntries([entryId], WS)[entryId].stale, false, "a rebuilt pack is current again");
});

test("an entry with no JD-backed job is never stale (no chip)", () => {
  const { entry } = createPipelineEntry({
    candidateId: "cand-corpus",
    candidateLabel: "Corpus Cand",
    jobId: "seeded-corpus-job", // not a jd-<slug> id
    jobTitle: "Seeded Role",
    stage: "Interview",
    workspaceId: WS,
  });
  saveInterviewPrep(entry.id, entry.candidateLabel, entry.jobTitle, {
    scenario: "x",
    durationMin: 20,
    focusAreas: [],
    chronology: [],
    signals: [],
    source: "llm",
  });
  assert.equal(prepJdEditedAt(entry.id, WS), null);
  assert.equal(listPreparedEntries([entry.id], WS)[entry.id].stale, false);
});
