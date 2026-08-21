// Pins the salary-unit contract of the copy-to-job-board posting.
//
// The bug this guards: fmtSalary hardcoded `toLocaleString("cs-CZ")` + the literal
// "CZK / month" OUTSIDE the strings table sitting right above it — so the ENGLISH
// posting emitted Czech digit grouping, and the CZECH posting told a Czech job
// board "CZK / month". Both the grouping locale and the unit still travel with the
// strings table (the currency itself coming from the app-wide APP_CURRENCY
// constant), which is the only place a posting-language literal is allowed to exist.
//
// F5 — that table used to be a two-locale object literal in jobsMarkdown.ts, so a
// de/fr recruiter was pinned back to English. It is now built per posting language
// from `jobs.posting.doc.*` + the shared `enums.*` labels, so these tests run over
// EVERY app locale and the real catalog. These tests run against the REAL helpers.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

// Module resolution (the "@/" alias, extensionless imports, JSON attributes) comes
// from the shared scripts/test-alias-loader.mjs the test:unit script --imports; the
// local registerHooks copy this file used to carry broke next-intl's React interop
// once the strings started coming from the real catalog.

const { jobToMarkdown, buildJobMarkdownStrings, POSTING_LOCALES } = await import("./jobsMarkdown.ts");
const { namespaceTranslator } = await import("@/app/_lib/catalog-translator.ts");

// One strings table per posting language, from the real catalog — the same call
// the Posting tab makes for a language other than the app's.
const STRINGS = Object.fromEntries(
  await Promise.all(
    POSTING_LOCALES.map(async (l) => [l, buildJobMarkdownStrings(l, await namespaceTranslator(l))] as const)
  )
) as Record<(typeof POSTING_LOCALES)[number], ReturnType<typeof buildJobMarkdownStrings>>;
const { formatBand } = await import("./JobsTypes.ts");
const { APP_CURRENCY } = await import("@/app/_lib/format.ts");

const JOB = { id: "j1", title: "Backend Engineer", salaryBand: [80000, 110000] };
// Grouping separators differ by ICU build (NBSP vs narrow NBSP for cs-CZ), so
// compare on whitespace-normalized text — the assertion is about the DIGITS, the
// separator character and the unit, not about which flavour of space ICU picked.
const flat = (s: string) => s.replace(/\s+/g, " ");

test("the English posting groups digits in English and names the unit in English", () => {
  const md = flat(jobToMarkdown(JOB, STRINGS.en));
  assert.ok(md.includes(`80,000 – 110,000 ${APP_CURRENCY} / month`), md);
});

test("the Czech posting groups digits in Czech and names the unit in Czech", () => {
  const md = flat(jobToMarkdown(JOB, STRINGS.cs));
  assert.ok(md.includes("80 000 – 110 000 Kč / měsíc"), md);
  // The regression: a Czech job board was being handed an English unit.
  assert.ok(!md.includes("/ month"), md);
});

test("every posting locale declares its own grouping locale and unit — no literal escapes the table", () => {
  for (const locale of POSTING_LOCALES) {
    const s = STRINGS[locale];
    assert.equal(typeof s.numberLocale, "string");
    assert.ok(s.numberLocale.length > 0, locale);
    assert.ok(s.salaryUnit.length > 0, locale);
  }
  // Distinct per language — a shared value would mean the table is decorative.
  const units = POSTING_LOCALES.map((l) => STRINGS[l].salaryUnit);
  assert.equal(new Set(units).size, units.length);
});

test("a taxonomy-anchored band is still labelled a market estimate, not stated pay", () => {
  const md = jobToMarkdown({ ...JOB, defaultedFields: ["salary_band"] }, STRINGS.en);
  assert.ok(md.includes(STRINGS.en.salaryEstimate), md);
});

test("no band => no salary line at all (never a fabricated 0)", () => {
  const md = jobToMarkdown({ id: "j2", title: "Role" }, STRINGS.en);
  assert.ok(!md.includes(STRINGS.en.salary), md);
  assert.ok(!md.includes(APP_CURRENCY), md);
});

test("the compact table cell stays unitless thousands — the column header carries the unit", () => {
  assert.equal(formatBand([80000, 110000]), "80–110k");
  assert.equal(formatBand(undefined), "—");
});

// --- The education floor (JOB3 scaffolding, same rule as family/seniority/workMode) --
//
// `min_education` is a closed EDU_LEVELS slug (jobs.py), not recruiter prose, and
// "none" is its canonical "no requirement" value — every scorer says so explicitly
// (`if job.min_education and job.min_education != "none"` in matching.ko_filter AND
// winnability.loose_gates). The posting used to print the slug verbatim, so a role
// with no education requirement published a phantom "Education none" line, and a
// role with one published the raw English slug onto a Czech/German/French board.
const tCs = await namespaceTranslator("cs");

test("a 'none' education floor prints NO education line — it is the taxonomy's 'no requirement' value", () => {
  const md = jobToMarkdown({ ...JOB, minEducation: "none" }, STRINGS.en);
  assert.ok(!md.includes(STRINGS.en.education), md);
  assert.ok(!md.includes("none"), md);
});

test("a real education floor is localized through enums.education — never the raw English slug", () => {
  const md = jobToMarkdown({ ...JOB, minEducation: "bachelor" }, STRINGS.cs);
  assert.ok(md.includes(STRINGS.cs.education), md);
  assert.ok(md.includes(tCs("enums.education.bachelor")), md);
  // The regression: a Czech job board was handed the English taxonomy slug.
  assert.ok(!md.includes("bachelor"), md);
});

test("an education level outside the catalog still degrades to the slug, never a key path", () => {
  const md = jobToMarkdown({ ...JOB, minEducation: "high_school" }, STRINGS.en);
  assert.ok(md.includes(`${STRINGS.en.education}** high_school`), md);
  assert.ok(!md.includes("enums."), md);
});
