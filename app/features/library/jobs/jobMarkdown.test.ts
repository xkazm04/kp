// Pins the salary-unit contract of the copy-to-job-board posting.
//
// The bug this guards: fmtSalary hardcoded `toLocaleString("cs-CZ")` + the literal
// "CZK / month" OUTSIDE the bilingual JOB_MARKDOWN_STRINGS table sitting right above
// it — so the ENGLISH posting emitted Czech digit grouping, and the CZECH posting
// told a Czech job board "CZK / month". Both the grouping locale and the unit now
// live in the strings table (the currency itself coming from the app-wide
// APP_CURRENCY constant), which is the only place a posting-language literal is
// allowed to exist. These tests run against the REAL exported helpers.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Same minimal module hooks as JobsTypes.test.ts: resolve the tsconfig "@/*" alias
// and extensionless local imports, and load .json without an import attribute, so we
// exercise the real modules instead of reimplementing them.
const ROOT = new URL("../../../../", import.meta.url).href; // app/features/library/jobs/ -> repo root
registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier;
    if (spec.startsWith("@/")) spec = new URL(spec.slice(2), ROOT).href;
    // Relative specifiers must be made absolute before the extension probe below —
    // jobMarkdown imports "./JobsTypes" extensionless, which no bare probe can stat.
    else if (spec.startsWith("./") || spec.startsWith("../")) {
      if (context.parentURL) spec = new URL(spec, context.parentURL).href;
    }
    if (spec.startsWith("file:") && !/\.[a-z0-9]+$/i.test(spec) && existsSync(fileURLToPath(spec + ".ts"))) {
      spec += ".ts";
    }
    return nextResolve(spec, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".json")) {
      const source = "export default " + readFileSync(fileURLToPath(url), "utf8") + ";";
      return { format: "module", source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { jobToMarkdown, JOB_MARKDOWN_STRINGS, POSTING_LOCALES } = await import("./jobsMarkdown.ts");
const { formatBand } = await import("./JobsTypes.ts");
const { APP_CURRENCY } = await import("@/app/_lib/format.ts");

const JOB = { id: "j1", title: "Backend Engineer", salaryBand: [80000, 110000] };
// Grouping separators differ by ICU build (NBSP vs narrow NBSP for cs-CZ), so
// compare on whitespace-normalized text — the assertion is about the DIGITS, the
// separator character and the unit, not about which flavour of space ICU picked.
const flat = (s: string) => s.replace(/\s+/g, " ");

test("the English posting groups digits in English and names the unit in English", () => {
  const md = flat(jobToMarkdown(JOB, JOB_MARKDOWN_STRINGS.en));
  assert.ok(md.includes(`80,000 – 110,000 ${APP_CURRENCY} / month`), md);
});

test("the Czech posting groups digits in Czech and names the unit in Czech", () => {
  const md = flat(jobToMarkdown(JOB, JOB_MARKDOWN_STRINGS.cs));
  assert.ok(md.includes("80 000 – 110 000 Kč / měsíc"), md);
  // The regression: a Czech job board was being handed an English unit.
  assert.ok(!md.includes("/ month"), md);
});

test("every posting locale declares its own grouping locale and unit — no literal escapes the table", () => {
  for (const locale of POSTING_LOCALES) {
    const s = JOB_MARKDOWN_STRINGS[locale];
    assert.equal(typeof s.numberLocale, "string");
    assert.ok(s.numberLocale.length > 0, locale);
    assert.ok(s.salaryUnit.length > 0, locale);
  }
  // Distinct per language — a shared value would mean the table is decorative.
  const units = POSTING_LOCALES.map((l) => JOB_MARKDOWN_STRINGS[l].salaryUnit);
  assert.equal(new Set(units).size, units.length);
});

test("a taxonomy-anchored band is still labelled a market estimate, not stated pay", () => {
  const md = jobToMarkdown({ ...JOB, defaultedFields: ["salary_band"] }, JOB_MARKDOWN_STRINGS.en);
  assert.ok(md.includes(JOB_MARKDOWN_STRINGS.en.salaryEstimate), md);
});

test("no band => no salary line at all (never a fabricated 0)", () => {
  const md = jobToMarkdown({ id: "j2", title: "Role" }, JOB_MARKDOWN_STRINGS.en);
  assert.ok(!md.includes(JOB_MARKDOWN_STRINGS.en.salary), md);
  assert.ok(!md.includes(APP_CURRENCY), md);
});

test("the compact table cell stays unitless thousands — the column header carries the unit", () => {
  assert.equal(formatBand([80000, 110000]), "80–110k");
  assert.equal(formatBand(undefined), "—");
});
