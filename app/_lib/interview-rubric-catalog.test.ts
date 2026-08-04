// F5 — the `rubric` catalog namespace is the DISPLAY overlay for
// pipeline/jobfit/interview-rubrics.json, which stays the single scoring source
// shared with automation.py. Two things have to hold, and neither is visible to
// `npm run i18n:check` (that compares locales to each other, never to the domain
// vocabulary — the same blind spot rubric-coverage-catalog.test.ts exists for):
//
//   1. Every locale covers EXACTLY the competencies + BARS levels the JSON
//      defines. A missing key means a recruiter silently reads the canonical
//      English inside a localized rubric — the defect this migration closed, in a
//      new disguise.
//   2. The ENGLISH catalog is byte-identical to the JSON. English is duplicated
//      into the catalog so `i18n:check` can enforce four-locale parity at all;
//      this assertion is what keeps that duplicate from becoming a second source
//      of truth and re-opening the TS/JSON/Python drift the module header
//      promises is structurally impossible.
//
// Runner: Node's built-in test runner with type stripping — npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { competencyKey } from "@/app/_lib/interview-rubric.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOCALES = ["en", "cs", "de", "fr"] as const;

type RawCompetency = { competency: string; description: string; anchors?: Record<string, string> };
type RawRubrics = {
  ratingAnchors: Record<string, string>;
  rubrics: Record<string, RawCompetency[]>;
  industryAxes?: Record<string, RawCompetency[]>;
};

// Read straight off disk, independent of the module under test.
const SOURCE: RawRubrics = JSON.parse(readFileSync(path.join(ROOT, "pipeline", "jobfit", "interview-rubrics.json"), "utf8"));
const ALL: RawCompetency[] = [
  ...Object.values(SOURCE.rubrics).flat(),
  ...Object.values(SOURCE.industryAxes ?? {}).flat(),
];

function rubricCatalog(locale: string) {
  const raw = readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8");
  const catalog = JSON.parse(raw) as {
    rubric?: {
      ratingAnchor?: Record<string, string>;
      competency?: Record<string, { label?: string; description?: string; anchor?: Record<string, string> }>;
    };
  };
  return catalog.rubric ?? {};
}

test("every locale's rubric catalog covers exactly the competencies the JSON defines", () => {
  const expected = ALL.map((c) => competencyKey(c.competency)).sort();
  for (const locale of LOCALES) {
    const actual = Object.keys(rubricCatalog(locale).competency ?? {}).sort();
    assert.deepEqual(
      actual,
      expected,
      `messages/${locale}.json rubric.competency must match interview-rubrics.json exactly — ` +
        `a missing entry renders English inside a ${locale} rubric, an extra one is a stale key.`
    );
  }
});

test("every locale carries a label, a description, and the JSON's BARS levels", () => {
  for (const locale of LOCALES) {
    const cat = rubricCatalog(locale);
    for (const c of ALL) {
      const key = competencyKey(c.competency);
      const entry = cat.competency?.[key];
      assert.ok(entry?.label?.trim(), `messages/${locale}.json rubric.competency.${key}.label is missing/empty`);
      assert.ok(entry?.description?.trim(), `messages/${locale}.json rubric.competency.${key}.description is missing/empty`);
      // All-or-nothing: localizedRubric drops a partial ladder back to English, so a
      // partial ladder is silent English rather than a visible gap.
      assert.deepEqual(
        Object.keys(entry?.anchor ?? {}).sort(),
        Object.keys(c.anchors ?? {}).sort(),
        `messages/${locale}.json rubric.competency.${key}.anchor must cover the same BARS levels as the JSON`
      );
    }
    assert.deepEqual(
      Object.keys(cat.ratingAnchor ?? {}).sort(),
      Object.keys(SOURCE.ratingAnchors).sort(),
      `messages/${locale}.json rubric.ratingAnchor must cover the same 1..5 scale as the JSON`
    );
  }
});

test("the ENGLISH catalog is the JSON verbatim — the duplicate never becomes a second source", () => {
  const cat = rubricCatalog("en");
  for (const c of ALL) {
    const key = competencyKey(c.competency);
    assert.equal(cat.competency?.[key]?.label, c.competency, `en rubric.competency.${key}.label must equal the canonical competency`);
    assert.equal(cat.competency?.[key]?.description, c.description, `en rubric.competency.${key}.description drifted from the JSON`);
    if (c.anchors) assert.deepEqual(cat.competency?.[key]?.anchor, c.anchors, `en rubric.competency.${key}.anchor drifted from the JSON`);
  }
  assert.deepEqual(cat.ratingAnchor, SOURCE.ratingAnchors, "en rubric.ratingAnchor drifted from the JSON");
});

test("no non-English locale left a rubric string as an untranslated English copy", () => {
  const en = rubricCatalog("en");
  for (const locale of LOCALES.filter((l) => l !== "en")) {
    const cat = rubricCatalog(locale);
    for (const c of ALL) {
      const key = competencyKey(c.competency);
      // "Communication" and "Motivation" are genuinely identical words in several of
      // these languages, so only the DESCRIPTION (a full sentence) is asserted — a
      // sentence that survives verbatim is a copy-paste, not a coincidence.
      assert.notEqual(
        cat.competency?.[key]?.description,
        en.competency?.[key]?.description,
        `messages/${locale}.json rubric.competency.${key}.description is byte-identical to English`
      );
    }
  }
});
