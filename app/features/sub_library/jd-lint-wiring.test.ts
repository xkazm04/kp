// Direction 1 — proves the JD builder's authoring surface actually SURFACES the
// finished jd-lint engine (which shipped with zero importers). The builder derives
// its advisory findings through builderLintFindings; JdBuilder renders JdLintPanel
// whenever that returns any. This pins the wiring at the pure seam the harness can
// run (no DOM/RTL): the debounce + <JdLintPanel/> render are thin over this.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { builderLintFindings, LINT_MIN_BODY_CHARS } from "./jd-library.ts";

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
