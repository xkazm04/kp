import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { MatchResult } from "../../../shared/matchTypes.ts";
import { matchReasons, type MatchReasonsTranslator } from "./matchReasons.ts";
import { matchCsvRows } from "./matchCsv.ts";

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
