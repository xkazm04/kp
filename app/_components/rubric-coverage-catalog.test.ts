// RubricCoverageNote renders a message keyed by a DISCLOSED RubricCoverageGap — an
// enum, so
// the catalog must be derived from the CODE's canonical list, never authored from
// a guess. This is the same guard devcases/outbox-kind-catalog.test.ts exists for:
// there, a 4-key catalog shipped against a 13-kind vocabulary and 23 of 40 rows
// rendered English inside a German UI, past three green gates — because a MISSING
// key is invisible to `npm run i18n:check` (it compares locales to each other, not
// to the domain vocabulary).
//
// Here the failure mode would be worse than cosmetic: the message IS the honesty
// disclosure. A missing key means next-intl throws or renders the raw key where a
// recruiter should have been told the rubric lost its industry axes.
//
// Runner: Node's built-in test runner with type stripping — npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { RUBRIC_COVERAGE_GAPS, RUBRIC_COVERAGE_DISCLOSED_GAPS } from "@/app/_lib/interview-rubric.ts";

// app/_components/ -> repo root is two levels up.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOCALES = ["en", "cs", "de", "fr"] as const;

function coverageCatalog(locale: string): Record<string, string> {
  const raw = readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8");
  const catalog = JSON.parse(raw) as { rubricCoverage?: Record<string, string> };
  return catalog.rubricCoverage ?? {};
}

test("every locale's rubricCoverage catalog covers exactly RUBRIC_COVERAGE_DISCLOSED_GAPS", () => {
  const expected: string[] = [...RUBRIC_COVERAGE_DISCLOSED_GAPS].sort();
  for (const locale of LOCALES) {
    const actual = Object.keys(coverageCatalog(locale)).sort();
    const missing = expected.filter((k) => !actual.includes(k));
    const extra = actual.filter((k) => !expected.includes(k));
    assert.deepEqual(
      missing,
      [],
      `messages/${locale}.json rubricCoverage is missing ${missing.join(", ")} — a recruiter in ` +
        `that locale would get no disclosure that the rubric lost its industry axes. Add to ALL four catalogs.`
    );
    assert.deepEqual(extra, [], `messages/${locale}.json rubricCoverage has ${extra.join(", ")}, which no DISCLOSED gap emits.`);
  }
});

test("no locale leaves a rubricCoverage message empty, and every locale is genuinely translated", () => {
  const en = coverageCatalog("en");
  for (const locale of LOCALES) {
    const catalog = coverageCatalog(locale);
    for (const [gap, message] of Object.entries(catalog)) {
      assert.ok(message.trim().length > 0, `messages/${locale}.json rubricCoverage.${gap} is empty`);
      if (locale !== "en") {
        assert.notEqual(
          message,
          en[gap],
          `messages/${locale}.json rubricCoverage.${gap} is byte-identical to English — an untranslated copy-paste.`
        );
      }
    }
  }
});

test("a gap that must stay SILENT has no string it could ever render", () => {
  // The structural half of the disclosure policy. `family_no_axes` is the designed
  // state for 10 of the 16 canonical role families (software_engineering, data_ai,
  // finance_accounting …) — the base rubric IS the intended rubric there, and a
  // notice on the majority of interviews is wallpaper that would cost `no_family`
  // its signal value. RubricCoverageNote gates on isDisclosedGap, but a gate can be
  // edited; a message that does not exist cannot be rendered by anyone.
  const silent = RUBRIC_COVERAGE_GAPS.filter((g) => !(RUBRIC_COVERAGE_DISCLOSED_GAPS as readonly string[]).includes(g));
  assert.deepEqual([...silent], ["family_no_axes"], "the silent set is exactly the by-design-bare case");
  for (const locale of LOCALES) {
    for (const gap of silent) {
      assert.equal(
        coverageCatalog(locale)[gap],
        undefined,
        `messages/${locale}.json rubricCoverage.${gap} must NOT exist — that gap is deliberately silent.`
      );
    }
  }
});

test("the {family} placeholder survives translation in every locale", () => {
  // family_unrecognized names the anomalous family it found — the "why" half of the
  // cue. A translation that drops the placeholder degrades it to a vague line.
  for (const locale of LOCALES) {
    assert.match(
      coverageCatalog(locale).family_unrecognized ?? "",
      /\{family\}/,
      `messages/${locale}.json rubricCoverage.family_unrecognized must interpolate {family}`
    );
    // …and no_family must NOT, since there is no family to name (that is the gap).
    assert.doesNotMatch(
      coverageCatalog(locale).no_family ?? "",
      /\{family\}/,
      `messages/${locale}.json rubricCoverage.no_family cannot reference a family it does not have`
    );
  }
});
