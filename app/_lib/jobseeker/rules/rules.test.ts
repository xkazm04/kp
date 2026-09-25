// The rules DSL against the hand-written jobs.cz-shaped listing: validation refuses
// what the engine cannot run, the four locator kinds extract, items zip into rows,
// a required-rule miss on an `ok` page is a collapse, and the authoring reducer keeps
// the page shape while dropping what a rule cannot target.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtractionRule } from "../types.ts";
import { isRulesError, validateRules } from "./dsl.ts";
import { dryRun, findJobPosting, runRules, toIsoDate } from "./engine.ts";
import { isCollapsed, reduceHtmlForAuthoring } from "./collapse.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "__fixtures__");
const listing = readFileSync(path.join(FIXTURES, "jobscz-listing.html"), "utf8");
const detail = readFileSync(path.join(FIXTURES, "prace-detail-jsonld.html"), "utf8");
const rulesJson = JSON.parse(readFileSync(path.join(FIXTURES, "jobscz-rules.json"), "utf8")) as unknown;
const BASE = "https://www.jobs.example/prace/praha/?q=it";

function rules(): ExtractionRule[] {
  const v = validateRules(rulesJson);
  assert.ok(!isRulesError(v), `fixture rules must validate: ${JSON.stringify(v)}`);
  return v;
}

test("validateRules: accepts the fixture and refuses the shapes the engine cannot run", () => {
  assert.equal(rules().length, 6);
  const err = (v: unknown) => {
    const r = validateRules(v);
    assert.ok(isRulesError(r));
    return r.error;
  };
  assert.match(err("nope"), /array/);
  assert.match(err([]), /at least one/);
  assert.match(err([{ field: "title", locator: { kind: "css", expr: "h2" }, cardinality: "many", pick: "first", post: [], required: true }]), /url rule is required/);
  const url = { field: "url", locator: { kind: "css", expr: "a", attr: "href" }, cardinality: "many", pick: "first", post: ["absUrl"], required: false };
  assert.match(err([url]), /url rule must be required/);
  assert.match(err([{ ...url, required: true }, { ...url, required: true }]), /appears twice/);
  assert.match(err([{ ...url, required: true, locator: { kind: "regex", expr: "(a)(b)" } }]), /exactly one capture group/);
  assert.match(err([{ ...url, required: true, locator: { kind: "regex", expr: "(" } }]), /does not compile/);
  assert.match(err([{ ...url, required: true, locator: { kind: "pointer", expr: "props/x" } }]), /starts with \//);
  assert.match(err([{ ...url, required: true, post: ["shout"] }]), /post/);
  assert.match(err([{ ...url, required: true }, { field: "externalKey", locator: { kind: "css", expr: "a", attr: "data-id" }, cardinality: "many", pick: "first", post: [], required: false }]), /externalKey rule must be required/);
});

test("runRules: css + regex columns zip into three items with absolute URLs and decoded text", () => {
  const { items, perRule } = runRules(rules(), listing, BASE);
  assert.equal(items.length, 3);
  assert.deepEqual(
    items.map((i) => i.externalKey),
    ["2001001", "2001002", "2001003"]
  );
  assert.equal(items[0].url, "https://www.jobs.example/rpd/2001001/?searchId=abc&rps=233", "absUrl resolves against the base and decodes &amp;");
  assert.equal(items[1].title, "Frontend vývojář/ka (React)");
  assert.equal(items[2].company, "Gamma Cloud");
  assert.equal(items[0].location, "Praha – Karlín");
  // The salary regex matched 2 of 3 cards: the column is shorter and the third item
  // takes the SECOND card's salary — a known misalignment the preview makes visible.
  const salary = perRule.find((r) => r.field === "salaryText")!;
  assert.equal(salary.matched, 2);
  assert.equal(salary.verdict, "hit");
  assert.deepEqual(salary.samples, ["90 000 – 120 000 Kč", "od 110 000 Kč"]);
  assert.ok(perRule.every((r) => r.verdict === "hit"));
  assert.ok(perRule.every((r) => r.samples.length <= 3));
});

test("runRules: jsonld dotted paths and a pointer into application/json; cardinality one + pick", () => {
  const jp = findJobPosting(detail);
  assert.ok(jp && jp.title === "Backend vývojář (Node.js)", "the JobPosting inside @graph is found");
  const html = `${detail}<script type="application/json">{"props":{"jobs":[{"t":"A"},{"t":"B"}],"n":42}}</script>`;
  const set: ExtractionRule[] = [
    { field: "url", locator: { kind: "regex", expr: 'rel="canonical" href="([^"]+)"' }, cardinality: "one", pick: "first", post: ["trim"], required: true },
    { field: "title", locator: { kind: "jsonld", expr: "title" }, cardinality: "one", pick: "first", post: ["trim"], required: true },
    { field: "company", locator: { kind: "jsonld", expr: "hiringOrganization.name" }, cardinality: "one", pick: "first", post: [], required: false },
    { field: "location", locator: { kind: "jsonld", expr: "jobLocation.address.addressLocality" }, cardinality: "one", pick: "first", post: [], required: false },
    { field: "postedAt", locator: { kind: "jsonld", expr: "datePosted" }, cardinality: "one", pick: "first", post: ["date"], required: false },
    { field: "salaryText", locator: { kind: "jsonld", expr: "baseSalary.value.minValue" }, cardinality: "one", pick: "first", post: ["number"], required: false },
    { field: "externalKey", locator: { kind: "pointer", expr: "/props/n" }, cardinality: "one", pick: "first", post: [], required: true },
  ];
  const { items, perRule } = dryRun(set, html, "https://www.prace.example/nabidka/1700123456/");
  assert.equal(items.length, 1, "a detail page with only `one` rules is a single item");
  assert.equal(items[0].url, "https://www.prace.example/nabidka/1700123456/");
  assert.equal(items[0].company, "Fintech Morava s.r.o.");
  assert.equal(items[0].location, "Brno");
  assert.equal(items[0].postedAt, "2026-09-10");
  assert.equal(items[0].salaryText, "70000");
  assert.equal(items[0].externalKey, "42");
  assert.ok(perRule.every((r) => r.verdict === "hit"), JSON.stringify(perRule));

  // pick semantics on a `one` rule that matched several.
  const many = (pick: ExtractionRule["pick"]): ExtractionRule[] => [
    { field: "url", locator: { kind: "css", expr: "article.SearchResultCard a", attr: "href" }, cardinality: "one", pick, post: ["absUrl"], required: true },
  ];
  assert.equal(runRules(many("first"), listing, BASE).items[0].url, "https://www.jobs.example/rpd/2001001/?searchId=abc&rps=233");
  assert.equal(runRules(many("last"), listing, BASE).items[0].url, "https://www.jobs.example/rpd/2001003/?searchId=abc&rps=233");
  const failed = runRules(many("fail"), listing, BASE);
  assert.equal(failed.perRule[0].verdict, "ambiguous");
  assert.equal(failed.items.length, 0);
});

test("post ops: number and date", () => {
  const set: ExtractionRule[] = [
    { field: "url", locator: { kind: "regex", expr: 'href="(/rpd/\\d+/)' }, cardinality: "many", pick: "first", post: ["absUrl"], required: true },
    { field: "salaryText", locator: { kind: "regex", expr: "salary\">(?:od )?([\\d\\s]+)" }, cardinality: "many", pick: "first", post: ["number"], required: false },
    { field: "postedAt", locator: { kind: "regex", expr: "Přidáno ([\\d. ]+\\d{4})" }, cardinality: "many", pick: "first", post: ["date"], required: false },
  ];
  const { items } = runRules(set, listing, BASE);
  assert.equal(items[0].salaryText, "90000");
  assert.equal(items[0].postedAt, "2026-09-12", "the one absolute date on the page; relative phrases are not guessed");
  assert.equal(toIsoDate("Thu, 11 Sep 2026 07:30:00 +0000"), "2026-09-11");
  assert.equal(toIsoDate("12. 9. 2026"), "2026-09-12");
  assert.equal(toIsoDate("2026-09-10T00:00:00+02:00"), "2026-09-10");
  assert.equal(toIsoDate("před 2 dny"), null);
});

test("collapse: a required rule at 0 on a fetched page, or a baseline ≥ 5 at 0", () => {
  const set = rules();
  const redesigned = listing.replace(/SearchResultCard__titleLink/g, "Card__link");
  const { perRule } = runRules(set, redesigned, BASE);
  assert.equal(perRule.find((r) => r.field === "url")!.matched, 0);
  assert.equal(isCollapsed(perRule, set, null), true, "a required rule at zero IS the collapse");
  const healthy = runRules(set, listing, BASE).perRule;
  assert.equal(isCollapsed(healthy, set, null), false);
  // An optional rule that always matched five-plus now matches nothing → collapse too.
  const optionalGone = healthy.map((r) => (r.field === "company" ? { ...r, matched: 0, samples: [] } : r));
  assert.equal(isCollapsed(optionalGone, set, { company: 5 }), true);
  assert.equal(isCollapsed(optionalGone, set, { company: 4 }), false);
});

test("reduceHtmlForAuthoring: drops script/style, keeps 3 exemplars of repeated cards with a count note, keeps selector attributes", () => {
  const five = listing.replace("</div>\n<nav", `${listing.match(/<article[\s\S]*?<\/article>/)![0].repeat(2)}</div>\n<nav`);
  const reduced = reduceHtmlForAuthoring(five);
  assert.ok(!/window\.__tracking/.test(reduced), "inline script dropped");
  assert.ok(!/<style/.test(reduced), "style dropped");
  assert.equal((reduced.match(/<article class=/g) ?? []).length, 3, "three exemplars kept out of five");
  assert.match(reduced, /\+2 more <article> siblings/);
  assert.match(reduced, /class="SearchResultCard__titleLink|class="link-primary SearchResultCard__titleLink"/);
  assert.match(reduced, /data-jobad-id="2001001"/);
  assert.match(reduced, /href="\/rpd\/2001001\//);
  assert.ok(reduced.length < 40_000);
  // JSON-LD survives (a locator kind), scripts of other types do not.
  const withLd = reduceHtmlForAuthoring(detail);
  assert.match(withLd, /application\/ld\+json/);
  assert.match(withLd, /"@type": "JobPosting"/);
});

test("validateRules: a regex locator with a nested quantifier (catastrophic backtracking) is refused", () => {
  const url = { field: "url", locator: { kind: "css", expr: "a", attr: "href" }, cardinality: "many", pick: "first", post: ["absUrl"], required: true };
  const regexUrl = (expr: string) => validateRules([{ ...url, locator: { kind: "regex", expr } }]);
  for (const expr of ["(a+)+", "((?:ab)+)+c", "(?:x*)*(y)", String.raw`((?:\w+\s?)*)$`, "(a+){2,}", "((a|b+)+?)z"]) {
    const r = regexUrl(expr);
    assert.ok(isRulesError(r), `${expr} must be refused`);
    assert.match(r.error, /nested quantifier/, expr);
  }
  // Quantifiers that do not nest, escaped parens and quantifier chars inside a class are fine.
  for (const expr of ['href="([^"]+)"', String.raw`(\d+)-(?:x)+`, "[(+*)]+(a)", String.raw`\(a+\)+(b)`, "(a+)(?:b)?"]) {
    assert.ok(!isRulesError(regexUrl(expr)), `${expr} must be accepted`);
  }
});

test("runRules: a regex locator is capped in matches, and a stored nested-quantifier rule is a miss, never run", () => {
  const url: ExtractionRule = { field: "url", locator: { kind: "regex", expr: "(a)" }, cardinality: "many", pick: "first", post: [], required: true };
  const { perRule } = runRules([url], "a".repeat(5000), BASE);
  const matched = perRule.find((r) => r.field === "url")!.matched;
  assert.ok(matched <= 1000, `${matched} matches collected from one page`);
  // A rule saved before validation refused nested quantifiers still never runs.
  const nested: ExtractionRule = { ...url, locator: { kind: "regex", expr: "((?:ab)+)+c" } };
  assert.equal(runRules([nested], "ababc", BASE).perRule.find((r) => r.field === "url")!.matched, 0);
});
