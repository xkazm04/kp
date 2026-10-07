import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchScoreForPipeline, type MatchResult } from "../../../shared/matchTypes.ts";
import { matchReasonFacts, matchReasons, renderMatchReasons, MATCH_SCORER_VERSION, type MatchReasonsTranslator } from "./matchReasons.ts";
import { matchCsvRows } from "./matchCsv.ts";
import { coerceMatchReasonFacts, DIMENSION_LABEL_CODES, FIT_TIERS } from "../../../../_lib/match-verdict.ts";

// A translator over the REAL en.json `match` namespace, ICU-lite ({name} only).
const en = JSON.parse(readFileSync(new URL("../../../../../messages/en.json", import.meta.url), "utf8")).match;
const lookup = (key: string): string | undefined =>
  key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), en) as string | undefined;
const t: MatchReasonsTranslator = Object.assign(
  (key: string, values?: Record<string, string | number>) =>
    (lookup(key) ?? `?${key}`).replace(/\{(\w+)\}/g, (_, n) => String(values?.[n] ?? "")),
  { has: (key: string) => lookup(key) !== undefined }
);

const base = (over: Partial<MatchResult> = {}): MatchResult => ({
  jobId: "j1", title: "Backend Dev", total: 71, skillsScore: 0.8, careerScore: 0.6, personalScore: 0.5,
  confidence: { low: 60, high: 80, level: "moderate", drivers: [] },
  ...over,
});

const dims = [
  { key: "skills", label: "Skills", labelCode: "skills", percent: 82.4, weight: 50, contribution: 41 },
  { key: "career", label: "Career", labelCode: "career", percent: 40, weight: 30, contribution: 12 },
  { key: "personal", label: "Personal", labelCode: "personal", percent: 65, weight: 20, contribution: 13 },
];

test("a full breakdown names the tier, strongest and weakest dimension and the skills", () => {
  const r = matchReasons(
    base({ fitTier: "strong", scoreBreakdown: dims, matchedSkills: ["Java", "Kafka", "Spring", "Docker"], unprovenSkills: ["Go"], missingSkills: ["Rust"] }),
    t
  );
  assert.ok(r);
  assert.equal(
    r.line,
    "Strong fit: strongest on Skills (82), weakest on Career (40). Skills: matches Java, Kafka, Spring; claims but has not yet proven Go; lacks Rust."
  );
  assert.deepEqual(r.matched, ["Java", "Kafka", "Spring"], "at most 3 names per list");
  assert.deepEqual(r.missing, ["Rust"]);
});

test("skills only: no breakdown, no tier, still a line", () => {
  const r = matchReasons(base({ matchedSkills: ["Java"] }), t);
  assert.equal(r?.line, "Skills: matches Java.");
});

test("neither a breakdown nor any skill list returns null, even with a tier", () => {
  assert.equal(matchReasons(base({ fitTier: "partial" }), t), null);
  assert.equal(matchReasons(base({ scoreBreakdown: [], matchedSkills: [], missingSkills: ["  "] }), t), null);
});

test("a non-finite dimension percent is never quoted", () => {
  const bad = [{ ...dims[0], percent: Number.NaN }, { ...dims[1], percent: Number.POSITIVE_INFINITY }, dims[2]];
  const r = matchReasons(base({ scoreBreakdown: bad }), t);
  assert.equal(r?.line, "Personal scores 65.");
  assert.doesNotMatch(r!.line, /NaN|Infinity|null|undefined/);
  assert.equal(matchReasons(base({ scoreBreakdown: [bad[0], bad[1]] }), t), null);
});

test("CSV rows: a reasons column carries the same line; a result with none gets an empty cell", () => {
  const headers = {
    rank: "Rank", role: "Role", company: "Company", score: "Score", confLow: "Lo", confHigh: "Hi",
    fitTier: "Tier", matchedSkills: "M", unprovenSkills: "U", missingSkills: "X", reasons: "Why",
  };
  const withReasons = base({ fitTier: "promising", matchedSkills: ["Java"], missingSkills: ["Rust"] });
  const rows = matchCsvRows([withReasons, base({ jobId: "j2" })], headers, t);
  assert.equal(rows[0].length, 11);
  assert.equal(rows[0][10], "Why");
  assert.equal(rows[1][10], matchReasons(withReasons, t)!.line);
  assert.equal(rows[1][0], 1);
  assert.equal(rows[2][10], "");
  assert.ok(rows.every((r) => r.length === 11));
});

// ---- facts + renderer (ADR 0018: the add seals facts, never the sentence) --------------

test("the facts carry codes and numbers only: tier, best/worst slug + rounded percent, bounded skills, score, version", () => {
  const facts = matchReasonFacts(
    base({ fitTier: "strong", scoreBreakdown: dims, matchedSkills: ["Java", " Kafka ", "Spring", "Docker"], unprovenSkills: ["Go"], missingSkills: ["Rust"] })
  );
  assert.deepEqual(facts, {
    fitTier: "strong",
    best: { labelCode: "skills", percent: 82 },
    worst: { labelCode: "career", percent: 40 },
    matched: ["Java", "Kafka", "Spring"],
    unproven: ["Go"],
    missing: ["Rust"],
    matchScore: 71,
    scorerVersion: MATCH_SCORER_VERSION,
  });
  assert.deepEqual(coerceMatchReasonFacts(facts), facts, "what the client builds is exactly what the route accepts");
  assert.doesNotMatch(JSON.stringify(facts), /fit:|strongest|Skills \(/, "no rendered words in the facts");
});

test("rendering the facts is the line the card shows — one renderer, not two", () => {
  const m = base({ fitTier: "promising", scoreBreakdown: dims, matchedSkills: ["Java"], missingSkills: ["Rust"] });
  assert.deepEqual(renderMatchReasons(matchReasonFacts(m), t), matchReasons(m, t));
});

test("a result that cannot say why still has facts (so the add seals them); the renderer returns null", () => {
  const facts = matchReasonFacts(base({ fitTier: "partial" }));
  assert.equal(facts.best, null);
  assert.equal(facts.worst, null);
  assert.equal(renderMatchReasons(facts, t), null);
  assert.notEqual(coerceMatchReasonFacts(facts), null);
});

test("a dimension with no slug in the closed vocabulary is not quoted; its key is the fallback slug", () => {
  const facts = matchReasonFacts(
    base({ scoreBreakdown: [{ key: "skills", label: "Skills", percent: 70, weight: 50, contribution: 35 }, { key: "mystery", label: "?", labelCode: "nope", percent: 90, weight: 50, contribution: 45 }] })
  );
  assert.deepEqual(facts.best, { labelCode: "skills", percent: 70 });
  assert.equal(facts.worst, null);
});

test("the filed score in the facts follows matchScoreForPipeline exactly (the route refuses a mismatch)", () => {
  for (const total of [57, 0, 100, 71.4, Number.NaN, Number.POSITIVE_INFINITY, undefined as unknown as number]) {
    assert.equal(matchReasonFacts(base({ total })).matchScore, matchScoreForPipeline(total), String(total));
  }
});

test("a translator without `has` still names each dimension from the catalog", () => {
  const bare: MatchReasonsTranslator = (key, values) => t(key, values);
  assert.equal(renderMatchReasons(matchReasonFacts(base({ scoreBreakdown: [dims[0]] })), bare)?.line, "Skills scores 82.");
});

test("the closed vocabularies match the scorer's source and every code has a catalog entry in all four locales", () => {
  const py = readFileSync(new URL("../../../../../pipeline/jobfit/matching.py", import.meta.url), "utf8");
  const keys = /_DIMENSION_KEYS = \(([^)]*)\)/.exec(py)?.[1] ?? "";
  const early = /_DIM_SLUG_EARLY = \{([^}]*)\}/.exec(py)?.[1] ?? "";
  const tiers = /FitTier = Literal\[([^\]]*)\]/.exec(py)?.[1] ?? "";
  const quoted = (s: string) => [...s.matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
  const earlySlugs = [...early.matchAll(/"[a-z_]+":\s*"([a-z_]+)"/g)].map((x) => x[1]);
  assert.deepEqual([...DIMENSION_LABEL_CODES].sort(), [...new Set([...quoted(keys), ...earlySlugs])].sort());
  assert.deepEqual([...FIT_TIERS].sort(), quoted(tiers).sort());
  for (const locale of ["en", "cs", "de", "fr"]) {
    const match = JSON.parse(readFileSync(new URL(`../../../../../messages/${locale}.json`, import.meta.url), "utf8")).match;
    for (const code of DIMENSION_LABEL_CODES) assert.equal(typeof match.dims[code], "string", `${locale} match.dims.${code}`);
    for (const tier of FIT_TIERS) assert.equal(typeof match.fitTier[tier], "string", `${locale} match.fitTier.${tier}`);
  }
});
