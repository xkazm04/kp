// Direction 1 — proves the JD builder's authoring surface actually SURFACES the
// finished jd-lint engine (which shipped with zero importers). The builder derives
// its advisory findings through builderLintFindings; JdBuilder renders JdLintPanel
// whenever that returns any. This pins the wiring at the pure seam the harness can
// run (no DOM/RTL): the debounce + <JdLintPanel/> render are thin over this.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { builderLintFindings, jdMarketResearchAvailable, jdMustHaveCount, LINT_MIN_BODY_CHARS } from "./jdsLibrary.ts";

test("a planted vague phrase surfaces as a lint finding in the builder", () => {
  const body =
    "We offer a competitive salary and a dynamic team. Remote from Prague. You will ship features and own outcomes.";
  const findings = builderLintFindings(body, { marketResearch: false });
  const vague = findings.filter((f) => f.kind === "vague").map((f) => f.phrase.toLowerCase());
  assert.ok(vague.some((p) => p.includes("competitive salary")), `expected a 'competitive salary' vague finding, got ${JSON.stringify(vague)}`);
  assert.ok(vague.some((p) => p.includes("dynamic team")), "expected a 'dynamic team' vague finding");
});

test("a thin draft is held below the threshold — no nagging on an empty form", () => {
  assert.deepEqual(builderLintFindings("hire a dev", { marketResearch: false }), []);
  assert.ok("x".repeat(LINT_MIN_BODY_CHARS - 1).length < LINT_MIN_BODY_CHARS);
});

test("marketResearch suppresses the missing-salary finding (engine salaryAvailable)", () => {
  // A substantive body with no pay figure and no place keyword.
  const body = "We need someone to lead the redesign of our onboarding funnel and mentor two juniors over the year.";
  const withMarket = builderLintFindings(body, { marketResearch: true });
  const withoutMarket = builderLintFindings(body, { marketResearch: false });
  assert.ok(!withMarket.some((f) => f.kind === "missing" && f.what === "salary"), "market research suppresses missing-salary");
  assert.ok(withoutMarket.some((f) => f.kind === "missing" && f.what === "salary"), "without it, missing-salary is flagged");
});

// --- the POST-BUILD suppression seam (jdMarketResearchAvailable) --------------
// The ledger read-view and the public page's editor don't have the checklist — they
// resolve `salaryAvailable` from the FINISHED build's artifacts. Only a usable band
// is evidence: `options.marketResearch` is the recruiter's pre-build INTENT, and
// runMarketSalary legitimately returns `available: false` (the CLI's 0–0 taxonomy
// miss, a keyless deterministic run with no band). composeMarkdown then OMITS the
// salary line entirely, so trusting the tick published a JD with no pay figure
// anywhere under a lint all-clear.

test("a ticked market-research build that produced NO band does not suppress missing-salary", () => {
  // The exact keyless/taxonomy-miss shape runJdBuild persists: options ticked,
  // salary normalized to an unusable 0–0 band.
  assert.equal(jdMarketResearchAvailable({ options: { marketResearch: true }, salary: null }), false);
  assert.equal(
    jdMarketResearchAvailable({ options: { marketResearch: true }, salary: { suggestedMinimum: 0, suggestedMaximum: 0 } }),
    false
  );
});

test("a grounded band still suppresses missing-salary, ticked option or not", () => {
  const band = { suggestedMinimum: 65000, suggestedMaximum: 95000, currency: "CZK" };
  assert.equal(jdMarketResearchAvailable({ options: { marketResearch: true }, salary: band }), true);
  // A band with no ticked option (legacy row / re-run) is still real money.
  assert.equal(jdMarketResearchAvailable({ salary: band }), true);
  // No artifacts at all (a plain draft save) lints without suppression.
  assert.equal(jdMarketResearchAvailable(null), false);
});

test("read-view wiring: a bandless build's JD body is flagged for missing salary", () => {
  // The body composeMarkdown produces when the band is unavailable: no salary line.
  const body = "# Backend Engineer\n**Acme · Praha**\n\n## About the role\nWe are hiring a Backend Engineer at Acme.";
  const artifacts = { options: { marketResearch: true }, salary: { suggestedMinimum: 0, suggestedMaximum: 0 } };
  const findings = builderLintFindings(body, { marketResearch: jdMarketResearchAvailable(artifacts) });
  assert.ok(
    findings.some((f) => f.kind === "missing" && f.what === "salary"),
    `a JD with no pay figure must not lint clean, got ${JSON.stringify(findings)}`
  );
});

// manyMustHaves could not see the BUILDER's own output. composeMarkdown renders
// role.mustHaves as plain bullets under "What you'll bring" and the seeded template
// under {{heading_requirements}}; neither emits a marker word, so an eleven-dealbreaker
// RoleSpec produced a body whose prose count was ZERO and linted clean. The rule only
// ever fired on recruiter-TYPED prose — the one case the AI did not produce — while the
// Python coercion deliberately does NOT clamp the list (a blind slice can drop a
// confirmed dealbreaker listed ninth), which makes this lint the compensating control.
test("a generated JD's structured must-haves reach the lint even with no marker prose", () => {
  // A real composeMarkdown shape: bullets, no must/required/musí anywhere.
  const body = [
    "# Backend Engineer",
    "**Acme · Praha**",
    "## About the role",
    "We are hiring a Backend Engineer at Acme in Praha. Pay is 90 000 Kč monthly.",
    "## What you'll bring",
    ...Array.from({ length: 11 }, (_, i) => `- Skill number ${i + 1}`),
  ].join("\n");
  assert.equal((body.match(/\b(?:must|required)\b/gi) ?? []).length, 0, "fixture must carry no marker prose");

  const blind = builderLintFindings(body, { marketResearch: true });
  assert.equal(
    blind.filter((f) => f.kind === "manyMustHaves").length,
    0,
    "without the structured count the rule is unreachable — this is the defect",
  );

  const wired = builderLintFindings(body, { marketResearch: true, mustHaveCount: 11 });
  const flagged = wired.filter((f) => f.kind === "manyMustHaves");
  assert.equal(flagged.length, 1, "the structured count must reach the rule");
  assert.equal((flagged[0] as { count: number }).count, 11, "and it must report the real number");
});

test("jdMustHaveCount reads the artifacts, and stays undefined when there is nothing to say", () => {
  assert.equal(jdMustHaveCount({ role: { mustHaves: ["a", "b", "c"] } }), 3);
  assert.equal(jdMustHaveCount({ role: { mustHaves: [] } }), undefined, "an empty list is not a count");
  assert.equal(jdMustHaveCount({}), undefined);
  assert.equal(jdMustHaveCount(null), undefined);
});

// A count at or below the threshold must NOT flag — otherwise the fix above would
// trade an unreachable rule for a rule that nags every generated JD.
test("the structured count respects the threshold rather than firing on any list", () => {
  const body = "# Role\n**Acme · Praha**\n## About\nWe are hiring at Acme in Praha for 90 000 Kč monthly.\n";
  assert.equal(
    builderLintFindings(body, { marketResearch: true, mustHaveCount: 8 }).filter((f) => f.kind === "manyMustHaves").length,
    0,
    "8 is the threshold, not over it",
  );
  assert.equal(
    builderLintFindings(body, { marketResearch: true, mustHaveCount: 9 }).filter((f) => f.kind === "manyMustHaves").length,
    1,
  );
});
