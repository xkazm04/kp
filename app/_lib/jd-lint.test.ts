// Pins the JD specificity lint (Erika gap E7): which boilerplate phrases are
// caught (EN + CS, inflected forms), what counts as a stated pay figure and
// place of work, and the salaryAvailable suppression. The rule lists will grow;
// these tests keep the boundary semantics from drifting while they do.
//
// Runner: Node's built-in test runner with type stripping — npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { findVaguePhrases, jdLintMessage, lintJd, type JdLintFinding } from "./jd-lint.ts";

// ---------------------------------------------------------------------------
// findVaguePhrases — English boilerplate
// ---------------------------------------------------------------------------

test("catches the canonical English offenders", () => {
  const text =
    "We offer a competitive salary. Join our team in a dynamic environment — a fast-paced environment for a true rockstar.";
  const phrases = findVaguePhrases(text).map((p) => p.toLowerCase());
  assert.deepEqual(phrases, [
    "competitive salary",
    "join our team",
    "dynamic environment",
    "fast-paced environment",
    "rockstar",
  ]);
});

test("is case-insensitive and reports the phrase as written", () => {
  assert.deepEqual(findVaguePhrases("COMPETITIVE Salary on offer"), ["COMPETITIVE Salary"]);
});

test("dedupes repeated phrases case-insensitively (first occurrence wins)", () => {
  const phrases = findVaguePhrases("Dynamic team. We are a dynamic team.");
  assert.deepEqual(phrases, ["Dynamic team"]);
});

// ---------------------------------------------------------------------------
// findVaguePhrases — Czech boilerplate, inflected forms
// ---------------------------------------------------------------------------

test("catches Czech salary boilerplate across inflections", () => {
  assert.deepEqual(findVaguePhrases("Nabízíme konkurenceschopný plat."), ["konkurenceschopný plat"]);
  assert.deepEqual(findVaguePhrases("konkurenceschopné platové ohodnocení"), ["konkurenceschopné platové"]);
  assert.deepEqual(findVaguePhrases("atraktivní finanční ohodnocení a benefity"), ["atraktivní finanční ohodnocení"]);
  assert.deepEqual(findVaguePhrases("motivující ohodnocení"), ["motivující ohodnocení"]);
});

test("catches Czech culture boilerplate", () => {
  const text = "Čeká tě mladý kolektiv, dynamické prostředí a rodinná atmosféra. Staňte se součástí!";
  const phrases = findVaguePhrases(text);
  assert.deepEqual(phrases, ["mladý kolektiv", "dynamické prostředí", "rodinná atmosféra", "Staňte se součástí"]);
});

test("leaves concrete, specific copy alone", () => {
  const text = "Senior React developer in Brno, 65 000–95 000 Kč/month, hybrid (2 days in office). Stack: React 19, TypeScript, Node.";
  assert.deepEqual(findVaguePhrases(text), []);
});

// ---------------------------------------------------------------------------
// lintJd — missing concretes
// ---------------------------------------------------------------------------

const CLEAN_BODY = "Senior React developer. Brno, hybrid. 65 000–95 000 Kč/month. Stack: React, TypeScript.";

test("a concrete JD lints clean", () => {
  assert.deepEqual(lintJd({ body: CLEAN_BODY }), []);
});

test("flags a missing salary figure", () => {
  const findings = lintJd({ body: "Senior React developer. Brno, hybrid. Stack: React." });
  assert.deepEqual(findings, [{ kind: "missing", what: "salary" }]);
});

test("salaryAvailable suppresses the salary finding (the structured band will carry the figure)", () => {
  const findings = lintJd({ body: "Senior React developer. Brno, hybrid. Stack: React.", salaryAvailable: true });
  assert.deepEqual(findings, []);
});

test("recognizes pay written in several currency shapes", () => {
  for (const body of [
    "Pay: 65 000 Kč monthly. Brno office.",
    "Salary 65,000 CZK. Brno office.",
    "Salary €3,200. Remote.",
    "Salary $120k. Remote.",
    "Mzda 70 000 Kč. Praha.",
  ]) {
    assert.deepEqual(lintJd({ body }), [], `should accept: ${body}`);
  }
});

test("flags a missing place of work", () => {
  const findings = lintJd({ body: "Senior React developer. 65 000 Kč/month. Stack: React." });
  assert.deepEqual(findings, [{ kind: "missing", what: "place" }]);
});

test("any work-mode signal counts as a place (remote IS a place for tech roles)", () => {
  for (const place of ["fully remote", "hybridní režim", "on-site", "práce z domova", "v kanceláři v Olomouci"]) {
    const findings = lintJd({ body: `Senior developer, ${place}. 65 000 Kč/month.` });
    assert.deepEqual(findings, [], `should accept place signal: ${place}`);
  }
});

test("a boilerplate-laden JD missing both concretes reports everything at once", () => {
  const findings = lintJd({ body: "Join our team! We offer a competitive salary in a dynamic environment." });
  assert.deepEqual(findings, [
    { kind: "vague", phrase: "Join our team" },
    { kind: "vague", phrase: "competitive salary" },
    { kind: "vague", phrase: "dynamic environment" },
    // "competitive salary" is NOT a salary — a figure is still missing.
    { kind: "missing", what: "salary" },
    { kind: "missing", what: "place" },
  ]);
});

// --- inclusive-language extension (7469c05f) ---------------------------------

test("flags exclusionary / coded language (gendered, masculine-coded, ageist)", () => {
  const body =
    "We want a young, aggressive rockstar. He/she will join our salesman team. " +
    "Prague, remote. 80 000 Kč.";
  const findings = lintJd({ body });
  const exclusionary = findings.filter((f) => f.kind === "exclusionary").map((f) => (f as { phrase: string }).phrase.toLowerCase());
  assert.ok(exclusionary.includes("young"), "ageist 'young' flagged");
  assert.ok(exclusionary.includes("aggressive"), "masculine-coded 'aggressive' flagged");
  assert.ok(exclusionary.includes("he/she"), "gendered 'he/she' flagged");
  assert.ok(exclusionary.includes("salesman"), "gendered 'salesman' flagged");
  // rockstar stays under `vague` (not duplicated as exclusionary).
  assert.ok(findings.some((f) => f.kind === "vague"));
});

test("flags an over-long must-have list", () => {
  const body =
    "Prague remote 80000 Kc. Required: A. must have B. must have C. required D. " +
    "must have E. required F. must have G. required H. must have I.";
  const findings = lintJd({ body, salaryAvailable: true });
  const many = findings.find((f) => f.kind === "manyMustHaves") as { count: number } | undefined;
  assert.ok(many, "long must-have list flagged");
  assert.ok((many?.count ?? 0) > 8);
});

test("flags an over-long must-have list written in CZECH (diacritic-final markers count)", () => {
  // The Czech markers are the reason this regression is invisible: `\b` is
  // ASCII-only, so /musí\b/ never matched ("í" and " " are both non-\w) and a
  // Czech JD with a dozen hard requirements counted ZERO must-haves — lint clean,
  // while the identical English JD flagged. This assertion FAILS against the
  // trailing-\b regex (findings has no manyMustHaves at all).
  const body =
    "Praha, hybrid. 80 000 Kč. Kandidát musí mít 5 let praxe. Musí umět Javu. " +
    "musí znát SQL. Musí ovládat Kubernetes. musí mít VŠ. Musí umět anglicky. " +
    "musí znát Docker. Musí mít ŘP. musí umět Python. Nutné je němčina. Povinná je čeština.";
  const findings = lintJd({ body });
  const many = findings.find((f) => f.kind === "manyMustHaves") as { count: number } | undefined;
  assert.ok(many, "a Czech must-have pile-up must flag, exactly as the English one does");
  assert.ok((many?.count ?? 0) > 8, `expected >8 Czech markers, counted ${many?.count}`);
});

test("Czech negation and unrelated words are not counted as must-have markers", () => {
  // "nemusí" (need NOT) is the opposite claim, and no ordinary word may pad the
  // count into a false manyMustHaves finding.
  const body =
    "Praha, remote. 80 000 Kč. Nemusíte umět německy, nemusí to být senior. " +
    "Máme muzeum a museum-grade kávovar.";
  const findings = lintJd({ body });
  assert.equal(findings.filter((f) => f.kind === "manyMustHaves").length, 0);
});

test("an inclusive, concrete JD has no exclusionary findings", () => {
  const body = "Backend engineer in Prague (hybrid). 90 000–110 000 Kč. You will own our payments service.";
  const findings = lintJd({ body });
  assert.equal(findings.filter((f) => f.kind === "exclusionary").length, 0);
  assert.equal(findings.filter((f) => f.kind === "manyMustHaves").length, 0);
});

// --- jdLintMessage exhaustiveness (bug-ui-scan-2026-07-09 jd-authoring #5) -----

test("jdLintMessage maps every finding kind to its own translation key + values", () => {
  assert.deepEqual(jdLintMessage({ kind: "vague", phrase: "rockstar" }), { key: "lintVague", values: { phrase: "rockstar" } });
  assert.deepEqual(jdLintMessage({ kind: "exclusionary", phrase: "young" }), { key: "lintExclusionary", values: { phrase: "young" } });
  assert.deepEqual(jdLintMessage({ kind: "manyMustHaves", count: 9 }), { key: "lintManyMustHaves", values: { count: 9 } });
  assert.deepEqual(jdLintMessage({ kind: "missing", what: "salary" }), { key: "lintMissingSalary" });
  assert.deepEqual(jdLintMessage({ kind: "missing", what: "place" }), { key: "lintMissingPlace" });
});

test("jdLintMessage throws on an unknown kind instead of mislabeling it 'missing place'", () => {
  // Pre-fix the panel's ternary fell through to lintMissingPlace for ANY kind it
  // didn't match; jdLintMessage rejects it (assertNever) so a new kind must be
  // handled explicitly. This assertion FAILS against that fall-through behaviour
  // (which would return lintMissingPlace, not throw).
  assert.throws(() => jdLintMessage({ kind: "tooShort" } as unknown as JdLintFinding));
});
