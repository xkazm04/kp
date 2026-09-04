// First coverage for the JD builder — the largest and most expensive file in the
// context, and until now the only one with no test at all.
//
// What is driven directly: the pure halves (composeMarkdown, the option-default
// reconciliation, the market-salary trust boundary). What is driven through the real
// handler: the FAILURE persistence path, which reaches failJdAnalysis without
// spawning anything because the min-need contract refuses first. The success path is
// not driven here — it spawns a 1-2 minute AI build, and its persistence half is
// covered against the store in db/jd-build-cas.test.ts.
//
// Isolated throwaway DB — unit-db.ts must be the first project import (it sets
// KP_DB_PATH before any store opens a connection).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import {
  composeJdBody,
  composeMarkdown,
  normalizeMarketSalaryPayload,
  readJdBuildOptions,
  resolveBuildOptions,
  runJdBuild,
  JD_BUILD_DEFAULT_OPTIONS,
  JD_BUILD_NO_OPTIONS,
} from "./jd-build-run.ts";
import { normalizeMarketSalary } from "./salary-band.ts";
import { insertAnalyzingJd, loadJd } from "./db/jobs.ts";

after(() => cleanupUnitDb());

const ROLE = {
  title: "Platform Engineer",
  seniority: "senior",
  responsibilities: ["Own the ingest pipeline"],
  mustHaves: ["TypeScript"],
  niceToHaves: ["Rust"],
  languages: ["English"],
};

// --- composeMarkdown --------------------------------------------------------

test("composeMarkdown prints the salary line only when the band is usable", () => {
  const band = normalizeMarketSalary({
    available: true,
    suggestedMinimum: 90000,
    suggestedMaximum: 120000,
    currency: "CZK",
    confidence: "medium",
    summary: "Mid-market band.",
  });
  const withBand = composeMarkdown(ROLE, { company: "Acme", location: "Prague", salary: band, lang: "en" });
  assert.match(withBand, /\*\*Salary:\*\*/, "a usable band must be advertised");
  assert.match(withBand, /# Platform Engineer/);
  assert.match(withBand, /\*\*Acme · Prague · senior level\*\*/);
  assert.match(withBand, /## Responsibilities/);
  assert.match(withBand, /- TypeScript/);
});

test("composeMarkdown omits the salary line entirely when the band is unavailable", () => {
  // Omission is the graceful degradation: a published JD must never print
  // "Salary: 0 CZK" or "salary unavailable" to candidates.
  const md = composeMarkdown(ROLE, { salary: normalizeMarketSalary(undefined), lang: "en" });
  assert.doesNotMatch(md, /Salary/i);
  assert.doesNotMatch(md, /undefined/, "an unavailable band must never bake `undefined` into the body");
});

test("composeMarkdown localizes its scaffolding, not just its content", () => {
  const md = composeMarkdown(ROLE, { company: "Acme", salary: normalizeMarketSalary(undefined), lang: "cs" });
  assert.match(md, /## O pozici/);
  assert.match(md, /## Odpovědnosti/);
  assert.doesNotMatch(md, /## About the role/);
  // An unknown lang falls back to en rather than rendering half a document.
  assert.match(composeMarkdown(ROLE, { salary: normalizeMarketSalary(undefined), lang: "zz" }), /## About the role/);
});

// --- the template-vs-default branch -----------------------------------------

const TOKENS = {
  heading_about: "About the role",
  heading_responsibilities: "Responsibilities",
  heading_requirements: "What you'll bring",
  heading_nice: "Nice to have",
  offer_note: "What we offer",
  apply_note: "How to apply",
} as unknown as Parameters<typeof composeJdBody>[1]["tokens"];

test("a chosen company template wins; no template falls back to the AI layout", () => {
  const salary = normalizeMarketSalary({
    available: true,
    suggestedMinimum: 90000,
    suggestedMaximum: 120000,
    currency: "CZK",
    confidence: "medium",
  });
  const templated = composeJdBody(ROLE, {
    templateBody: "## {{title}} at {{company}}\n{{seniority}} - {{salary}}\n{{responsibilities}}",
    title: "Platform Engineer",
    company: "Acme",
    salary,
    lang: "en",
    tokens: TOKENS,
  });
  assert.match(templated, /## Platform Engineer at Acme/, "the template's own layout must survive");
  assert.doesNotMatch(templated, /## About the role/, "the AI-default layout must NOT be composed too");
  assert.match(templated, /- Own the ingest pipeline/, "the role's fields fill the template's slots");

  const defaulted = composeJdBody(ROLE, { title: "Platform Engineer", company: "Acme", salary, lang: "en", tokens: TOKENS });
  assert.match(defaulted, /## About the role/);
});

test("a blank template is not a template — it falls back rather than persisting an empty body", () => {
  // A 1-2 minute build that lands an empty JD is the worst outcome of this branch.
  const md = composeJdBody(ROLE, {
    templateBody: "   \n  ",
    title: "Platform Engineer",
    salary: normalizeMarketSalary(undefined),
    lang: "en",
    tokens: TOKENS,
  });
  assert.match(md, /## About the role/);
});

// --- the option defaults ----------------------------------------------------

test("the checklist has ONE declaration of each default set", () => {
  // A caller that sends nothing at all gets today's effective output…
  assert.deepEqual(resolveBuildOptions(undefined), JD_BUILD_DEFAULT_OPTIONS);
  assert.deepEqual(JD_BUILD_DEFAULT_OPTIONS, { description: true, marketResearch: true, caseDesign: false });
  // …and a partial object still resolves every field against it.
  assert.deepEqual(resolveBuildOptions({ caseDesign: true }), {
    description: true,
    marketResearch: true,
    caseDesign: true,
  });
  assert.deepEqual(resolveBuildOptions({ description: false, marketResearch: false }), {
    description: false,
    marketResearch: false,
    caseDesign: false,
  });
});

test("the route reader and the handler defaults are the SAME two answers, not two literals", () => {
  // The divergence this pins: POST /api/jds/generate reads an EXPLICIT recruiter
  // checklist (an absent box is unticked, and all-off is refused), while the handler
  // resolves a caller that sent NO options at all to the defaults. Both used to be
  // written as literals in two files with nothing keeping them honest.
  assert.deepEqual(readJdBuildOptions(undefined), JD_BUILD_NO_OPTIONS);
  assert.deepEqual(readJdBuildOptions({}), JD_BUILD_NO_OPTIONS);
  assert.deepEqual(readJdBuildOptions({ description: "yes", marketResearch: 1 }), JD_BUILD_NO_OPTIONS);
  assert.deepEqual(readJdBuildOptions({ description: true }), {
    description: true,
    marketResearch: false,
    caseDesign: false,
  });
  assert.notDeepEqual(JD_BUILD_NO_OPTIONS, JD_BUILD_DEFAULT_OPTIONS, "the two answers must stay distinguishable");
});

// --- the market-salary trust boundary ---------------------------------------

test("a malformed market-salary payload degrades instead of reaching the JD body", () => {
  const out = normalizeMarketSalaryPayload({
    result: { suggestedMaximum: 120000 }, // half a band — the classic white-screen shape
    sources: "https://example.com", // a string where a list was promised
    source: 7,
  });
  assert.equal(out.result.available, false, "a partial band must become an unavailable one");
  assert.deepEqual(out.sources, [], "a non-array `sources` must not reach safeHttpLinks as one");
  assert.equal(out.source, "deterministic", "a non-string provenance falls back, never renders as 7");
  // …and the degraded band must not print a salary line.
  assert.doesNotMatch(composeMarkdown(ROLE, { salary: out.result, lang: "en" }), /Salary/i);
});

test("a well-formed payload passes through with its list filtered, not dropped", () => {
  const out = normalizeMarketSalaryPayload({
    result: { available: true, suggestedMinimum: 1, suggestedMaximum: 2, currency: "CZK", confidence: "low" },
    sources: ["https://a.example", 42, "https://b.example"],
    source: "llm",
  });
  assert.equal(out.result.available, true);
  assert.deepEqual(out.sources, ["https://a.example", "https://b.example"]);
  assert.equal(out.source, "llm");
});

// --- failure persistence ----------------------------------------------------

test("a build that refuses its own input marks the placeholder failed and rethrows", async () => {
  const { slug } = insertAnalyzingJd({ title: "Doomed Role", options: JD_BUILD_DEFAULT_OPTIONS });
  await assert.rejects(
    // A description was requested with a need too thin to design a role from: the
    // min-need contract refuses BEFORE anything spawns, so this reaches the failure
    // persistence without paying for a build.
    () => runJdBuild({ title: "Doomed Role", needText: "x", jdSlug: slug, options: JD_BUILD_DEFAULT_OPTIONS }),
  );
  const row = loadJd(slug);
  assert.equal(row?.analysis_status, "failed", "the Ledger must show a failed chip + retry, not Analyzing forever");
  assert.ok(row?.analysis_error, "the reason must be on the row");
  assert.equal(row?.body, "", "a failed build leaves the body untouched");
});

test("an empty checklist is refused before anything spawns", async () => {
  const { slug } = insertAnalyzingJd({ title: "Nothing Ticked", options: JD_BUILD_NO_OPTIONS });
  await assert.rejects(
    () => runJdBuild({ title: "Nothing Ticked", needText: "a".repeat(200), jdSlug: slug, options: JD_BUILD_NO_OPTIONS }),
    /at least one/i,
  );
  assert.equal(loadJd(slug)?.analysis_status, "failed");
});

test("a return-only build (no jdSlug) persists nothing at all", async () => {
  // The legacy in-memory contract: without a jdSlug the handler owns no row, so a
  // failure must not go looking for one.
  await assert.rejects(() => runJdBuild({ title: "", needText: "", options: JD_BUILD_NO_OPTIONS }));
});
