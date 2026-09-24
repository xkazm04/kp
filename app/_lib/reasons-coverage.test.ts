// THE COUNTER'S OWN ACCEPTANCE BAR.
//
// A coverage metric is worth exactly as much as its ability to go DOWN. So the tests
// that matter here are not "it counts 3 of 3" — they are the two controls:
//
//   * THE POSITIVE CONTROL: take a corpus that reads 100%, delete one reasons block,
//     and the number must move. Without this, a counter that returned `ok: true`
//     unconditionally would pass every other test in this file.
//   * THE VACUITY CONTROL: a kind with nothing to count must read `null`, never 1.
//     This is the specific way the metric would rot in place — the corpus loses its
//     interviews, the scorecard arm reads "perfect", and the number keeps shipping.
//
// The last test runs the counter over the REAL demo corpus, so the headline number
// has a denominator that is a fact about this repository rather than about a fixture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REASONS_VERDICT_KINDS,
  countReasonsCoverage,
  isReasonsVerdictKind,
  reasonsBlockOf,
  reasonsCoveragePct,
  type ReasonsCatalog,
  type ReasonsVerdict,
} from "./reasons-coverage.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The real `decisions.wave.reasons.*` catalog, wrapped exactly as the meter wraps
 *  it — so what this pins is the SHIPPED catalog's ability to resolve a sealed code,
 *  not a fixture's. */
function waveCatalog(overrides?: Record<string, string>): ReasonsCatalog {
  const messages = JSON.parse(readFileSync(path.join(REPO_ROOT, "messages", "en.json"), "utf8"));
  const reasons: Record<string, string> = { ...(messages?.decisions?.wave?.reasons ?? {}), ...overrides };
  const lookup = (key: unknown) => reasons[String(key).replace(/^reasons\./, "")];
  const t = ((key: unknown, params?: Record<string, unknown>) => {
    const template = lookup(key);
    if (template === undefined) return "";
    return String(template).replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? `{${name}}`));
  }) as unknown as ReasonsCatalog;
  (t as unknown as { has: (key: unknown) => boolean }).has = (key) => lookup(key) !== undefined;
  return t;
}

const CATALOG = waveCatalog();

/** A corpus that is fully covered — one verdict of each kind, each able to say why. */
function fullyCoveredCorpus(): ReasonsVerdict[] {
  return [
    { kind: "ranking", id: "r1", explanation: "Strong fit at 83/100 — matched on Java, Kafka and Spring Boot." },
    {
      kind: "scorecard",
      id: "s1",
      ratings: [
        { competency: "Technical depth", rating: 4, evidence: "Walked through a real migration they led." },
        { competency: "System design", rating: 3, evidence: "Not assessed (auto-synthesis unavailable)." },
      ],
    },
    {
      kind: "rejection",
      id: "x1",
      reason: { reasonCode: "reject", reasonParams: { pct: 10, n: 20, count: 2, rank: 19 } },
    },
  ];
}

test("the closed vocabulary is the three kinds the goal names", () => {
  assert.deepEqual([...REASONS_VERDICT_KINDS], ["ranking", "scorecard", "rejection"]);
  assert.ok(isReasonsVerdictKind("scorecard"));
  assert.ok(!isReasonsVerdictKind("offer"));
});

test("a fully covered corpus reads 100% on every arm — the baseline the controls move", () => {
  const c = countReasonsCoverage(fullyCoveredCorpus(), CATALOG);
  assert.equal(c.total.checked, 3);
  assert.equal(c.total.withReasons, 3);
  assert.equal(reasonsCoveragePct(c.total), 100);
  assert.deepEqual(c.misses, []);
  assert.deepEqual(c.unmeasuredKinds, [], "all three arms have something to count");
  for (const kind of REASONS_VERDICT_KINDS) assert.equal(c.byKind[kind].measured, true);
});

// --- THE POSITIVE CONTROL, once per kind ---------------------------------------------
// Each removes the ONE thing that is that kind's reasons block and asserts the number
// moved. A counter that cannot fail these is measuring nothing.

test("POSITIVE CONTROL — deleting a ranking's prose drops the ranking arm", () => {
  const corpus = fullyCoveredCorpus();
  const ranking = corpus[0] as Extract<ReasonsVerdict, { kind: "ranking" }>;
  ranking.explanation = "";
  ranking.jobFitSummary = null;
  const c = countReasonsCoverage(corpus, CATALOG);
  assert.equal(c.byKind.ranking.withReasons, 0, "the arm must move when the prose is gone");
  assert.equal(c.byKind.ranking.ratio, 0);
  assert.equal(reasonsCoveragePct(c.total), 66.7);
  assert.deepEqual(c.misses.map((m) => m.id), ["r1"]);
  assert.match(c.misses[0].why, /no explanation/, "and it must name what is missing, not just count it");
});

test("POSITIVE CONTROL — a scorecard whose every axis is 'Not assessed' is a MISS, not a hit", () => {
  const corpus = fullyCoveredCorpus();
  const scorecard = corpus[1] as Extract<ReasonsVerdict, { kind: "scorecard" }>;
  // Still shaped like a complete scorecard: every axis rated, every axis carries a
  // string. Only reading the evidence tells it apart from a real verdict — which is
  // the whole reason isPlaceholderEvidence exists and why counting rows would lie.
  scorecard.ratings = [
    { competency: "Technical depth", rating: 3, evidence: "Not assessed." },
    { competency: "Communication", rating: 3, evidence: "Not assessed (auto-synthesis unavailable)." },
  ];
  const c = countReasonsCoverage(corpus, CATALOG);
  assert.equal(c.byKind.scorecard.withReasons, 0);
  assert.match(c.misses[0].why, /placeholder evidence/);
  // …and the control on the control: one real quote among the placeholders is a hit.
  scorecard.ratings = [
    { competency: "Technical depth", rating: 3, evidence: "Not assessed." },
    { competency: "Communication", rating: 2, evidence: "Answers stayed abstract when pressed." },
  ];
  assert.equal(countReasonsCoverage(corpus, CATALOG).byKind.scorecard.withReasons, 1);
});

test("POSITIVE CONTROL — a rejection whose code the catalog cannot resolve is a MISS", () => {
  const corpus = fullyCoveredCorpus();
  const rejection = corpus[2] as Extract<ReasonsVerdict, { kind: "rejection" }>;
  rejection.reason = { reasonCode: "codeNobodyTranslated", reasonParams: {} };
  const c = countReasonsCoverage(corpus, CATALOG);
  assert.equal(c.byKind.rejection.withReasons, 0);
  assert.match(c.misses[0].why, /resolves to nothing/);
  // A sealed record with no code at all is the other shape of the same miss.
  rejection.reason = null;
  assert.match(countReasonsCoverage(corpus, CATALOG).misses[0].why, /no sealed reason code/);
});

test("POSITIVE CONTROL — emptying the CATALOG drops the rejection arm", () => {
  // The counter resolves through the shipped catalog rather than pattern-matching a
  // code, so deleting the copy — the thing a candidate would actually read — has to
  // move the number too. A re-implemented resolver would sail through this.
  const emptyish = waveCatalog();
  const c = countReasonsCoverage(fullyCoveredCorpus(), {
    ...emptyish,
    has: () => false,
  } as unknown as ReasonsCatalog);
  assert.equal(c.byKind.rejection.withReasons, 0, "no copy means no reasons block, however well-sealed the code");
  assert.equal(c.byKind.ranking.withReasons, 1, "…and the other arms are untouched by it");
});

// --- THE VACUITY CONTROL --------------------------------------------------------------

test("VACUITY CONTROL — an empty arm reads null and 'not measured', NEVER 100%", () => {
  const c = countReasonsCoverage([], CATALOG);
  assert.equal(c.total.ratio, null, "an empty corpus has no ratio — it does not have a perfect one");
  assert.equal(c.total.measured, false);
  assert.equal(reasonsCoveragePct(c.total), null);
  assert.deepEqual(c.unmeasuredKinds, ["ranking", "scorecard", "rejection"]);
  for (const kind of REASONS_VERDICT_KINDS) {
    assert.equal(c.byKind[kind].ratio, null, `${kind} must not report a ratio it did not measure`);
    assert.notEqual(c.byKind[kind].ratio, 1);
  }
});

test("VACUITY CONTROL — a partially covered corpus says WHICH kinds its number leaves out", () => {
  // The dangerous reading: rankings are perfect, so the headline is 100% — while the
  // two arms that carry the actual AI verdicts were never counted. The caller cannot
  // report the headline honestly without this list, so the counter always produces it.
  const c = countReasonsCoverage([{ kind: "ranking", id: "r1", explanation: "because." }], CATALOG);
  assert.equal(reasonsCoveragePct(c.total), 100);
  assert.deepEqual(c.unmeasuredKinds, ["scorecard", "rejection"]);
});

test("a scorecard with no ratings at all is a miss, and says so distinctly", () => {
  const miss = (ratings: unknown) => reasonsBlockOf({ kind: "scorecard", id: "s", ratings }, CATALOG);
  assert.deepEqual(miss([]), { ok: false, why: "no ratings at all" });
  assert.deepEqual(miss(undefined), { ok: false, why: "no ratings at all" });
  assert.deepEqual(miss("ratings"), { ok: false, why: "no ratings at all" });
});

test("blank prose is not prose — whitespace never counts as a reasons block", () => {
  const r = reasonsBlockOf({ kind: "ranking", id: "r", explanation: "   \n ", jobFitSummary: "" }, CATALOG);
  assert.equal(r.ok, false);
});

// --- THE REAL CORPUS ------------------------------------------------------------------

test("the demo corpus's ranking arm is a real number with a real denominator", () => {
  // The number the meter (npm run kpi:reasons) reports for the seeded corpus, pinned
  // here so it is a fact about this repository. The denominator is asserted to be
  // non-trivial FIRST: without that, a corpus that shrank to one row would still show
  // a green 100% and this test would agree with it.
  const rows = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "data", "seed_analyses", "analyses.json"), "utf8")
  ) as { id: string; payload?: { explanation?: string; jobFit?: { summary?: string } } }[];
  const verdicts: ReasonsVerdict[] = rows.map((row) => ({
    kind: "ranking",
    id: `seed:${row.id}`,
    explanation: row?.payload?.explanation ?? null,
    jobFitSummary: row?.payload?.jobFit?.summary ?? null,
  }));
  const c = countReasonsCoverage(verdicts, CATALOG);
  assert.ok(c.byKind.ranking.checked >= 50, `the seeded corpus must be substantial, got ${c.byKind.ranking.checked}`);
  assert.equal(reasonsCoveragePct(c.byKind.ranking), 100, `rankings without a reasons block: ${JSON.stringify(c.misses.slice(0, 5))}`);
});
