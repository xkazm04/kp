// The JOIN that decides which saved analysis becomes a pipeline row's match score.
//
// match-score-resolve.ts is the only DB-dependent input of the canonical-score
// precedence (match-score.ts): "the freshest saved analysis fit FOR THIS JOB".
// It shipped untested, and its three axes are each a way to show a recruiter the
// WRONG number under the same "match" label:
//
//   - JOB axis. Only a `jd-<slug>` entry can carry a job-matched analysis. A
//     corpus-job entry (no jd- prefix) must fall back to its own snapshot; joining
//     on the label alone would fold a DIFFERENT role's fit into "the match score" —
//     the exact conflation this module exists to end.
//   - CANDIDATE axis. Exact label, case-insensitive and whitespace-trimmed. Looser
//     would invent history for same-named strangers; stricter would drop a real fit
//     over "Jan Novák" vs "jan novák".
//   - FRESHNESS. Newest analysis per (label, jd slug) wins; older rows never
//     resurrect.
//   - TENANCY. A fit saved in workspace B never reaches an entry scored in A.
//
// testing/unit-db.ts MUST be the first project import — it points KP_DB_PATH at a
// throwaway file before core.ts opens the store.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { saveAnalysis } from "./db/analyses.ts";
import { buildFreshestFits, fitKey, withCanonicalScores } from "./match-score-resolve.ts";

after(() => cleanupUnitDb());

const WS_A = "ws-msr-a";
const WS_B = "ws-msr-b";

const fit = (candidateLabel: string, jdSlug: string, score: number, workspace: string) =>
  saveAnalysis(
    { candidateLabel, jdSlug, score, roleFamily: "engineering_backend", seniority: "senior", payload: {} },
    workspace
  );

/** saveAnalysis stamps `new Date().toISOString()` and listJdFitRows orders by that
 *  column alone, so two saves inside one millisecond have no defined order. Wait for
 *  the clock to move before writing the row that must win. */
const tick = () => {
  const t = Date.now();
  while (Date.now() === t) {
    /* spin: the freshness axis needs two DISTINCT created_at values, not a sleep */
  }
};

const entry = (candidateLabel: string, jobId: string | null, matchScore: number | null) => ({
  candidateLabel,
  jobId,
  matchScore,
});

test("the job axis: only a jd-backed entry takes an analysis fit", () => {
  fit("Axis Person", "backend-role", 88, WS_A);
  const [jdBacked, corpus, unjobbed] = withCanonicalScores(
    [
      entry("Axis Person", "jd-backend-role", 40),
      // Same candidate, same workspace, a CORPUS job: the analysis was computed
      // against a different role, so it must not become this entry's match score.
      entry("Axis Person", "job-corpus-7", 40),
      entry("Axis Person", null, 40),
    ],
    WS_A
  );
  assert.equal(jdBacked.canonicalScore, 88);
  assert.deepEqual(jdBacked.scoreProvenance?.source, "analysis");
  assert.equal(corpus.canonicalScore, 40, "a corpus job falls back to its own snapshot");
  assert.equal(corpus.scoreProvenance?.source, "snapshot");
  assert.equal(unjobbed.canonicalScore, 40, "an entry with no job cannot be job-matched");
  assert.equal(unjobbed.scoreProvenance?.source, "snapshot");
});

test("the job axis is the SLUG, not just 'has a jd- prefix'", () => {
  fit("Slug Person", "role-one", 91, WS_A);
  const [same, other] = withCanonicalScores(
    [entry("Slug Person", "jd-role-one", 12), entry("Slug Person", "jd-role-two", 12)],
    WS_A
  );
  assert.equal(same.canonicalScore, 91);
  assert.equal(other.canonicalScore, 12, "a fit for role-one must not price role-two");
});

test("the candidate axis is an EXACT label, case-insensitively", () => {
  fit("Jan Novák", "case-role", 77, WS_A);
  const [exact, cased, padded, stranger, prefix] = withCanonicalScores(
    [
      entry("Jan Novák", "jd-case-role", 5),
      entry("JAN NOVÁK", "jd-case-role", 5),
      entry("  Jan Novák  ", "jd-case-role", 5),
      entry("Jan Nováková", "jd-case-role", 5),
      entry("Jan", "jd-case-role", 5),
    ],
    WS_A
  );
  assert.equal(exact.canonicalScore, 77);
  assert.equal(cased.canonicalScore, 77, "case must not lose a real fit");
  assert.equal(padded.canonicalScore, 77, "surrounding whitespace must not lose a real fit");
  assert.equal(stranger.canonicalScore, 5, "a different name keeps its own snapshot");
  assert.equal(prefix.canonicalScore, 5, "a prefix is not a match — no fuzzy join");
});

test("freshest wins: a newer analysis supersedes the older one, and older never resurrects", () => {
  fit("Fresh Person", "fresh-role", 30, WS_A);
  tick();
  const newer = fit("Fresh Person", "fresh-role", 82, WS_A);
  const fits = buildFreshestFits(WS_A);
  const resolved = fits.get(fitKey("Fresh Person", "fresh-role"));
  assert.equal(resolved?.score, 82, "the newest row per (label, jd slug) is the fit");
  assert.equal(resolved?.slug, newer.slug);
  const [e] = withCanonicalScores([entry("Fresh Person", "jd-fresh-role", 1)], WS_A);
  assert.equal(e.canonicalScore, 82);
  assert.equal(e.scoreProvenance?.source, "analysis");
});

test("no cross-workspace fit: another tenant's analysis never prices this entry", () => {
  fit("Tenant Person", "tenant-role", 95, WS_B);
  const [inA] = withCanonicalScores([entry("Tenant Person", "jd-tenant-role", 44)], WS_A);
  assert.equal(inA.canonicalScore, 44, "workspace A must not see B's analysis");
  assert.equal(inA.scoreProvenance?.source, "snapshot");
  const [inB] = withCanonicalScores([entry("Tenant Person", "jd-tenant-role", 44)], WS_B);
  assert.equal(inB.canonicalScore, 95, "…and B still gets its own");
  assert.equal(buildFreshestFits(WS_A).has(fitKey("Tenant Person", "tenant-role")), false);
});

test("absence stays absence — an unscored entry with no fit is null, never a fabricated 0", () => {
  const [e] = withCanonicalScores([entry("Nobody At All", "jd-empty-role", null)], WS_A);
  assert.equal(e.canonicalScore, null);
  assert.equal(e.scoreProvenance, null);
});

test("a precomputed fit map is used verbatim — the memo path takes no second query", () => {
  fit("Memo Person", "memo-role", 66, WS_A);
  // pipeline-score-cache.ts hands a per-workspace TTL memo in here; passing a map that
  // deliberately DISAGREES with the DB proves the argument is honoured, not re-derived.
  const [e] = withCanonicalScores(
    [entry("Memo Person", "jd-memo-role", 2)],
    WS_A,
    new Map([[fitKey("Memo Person", "memo-role"), { score: 21, at: "2026-01-01T00:00:00.000Z", slug: "memo-1" }]])
  );
  assert.equal(e.canonicalScore, 21);
  assert.equal(e.scoreProvenance?.source, "analysis");
});

test("the map key joins on a separator that cannot occur in either axis", () => {
  // A plain-space join would make ("Ann Lee", "role-x") and ("Ann", "Lee role-x")
  // one key. The axes are joined with a NUL, which neither a label nor a slug holds.
  assert.notEqual(fitKey("Ann Lee", "role-x"), fitKey("Ann", "Lee role-x"));
  assert.equal(fitKey(" ANN LEE ", "role-x"), fitKey("ann lee", "role-x"));
});
