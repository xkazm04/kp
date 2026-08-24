// The scenario loader/validator and the dialog it expands into — the parts of
// the bench driver that can be proven without a server.
//
//   node --test scripts/app-master-bench/
//
// The dialog assertions are the load-bearing ones: the nine answers are posted
// one per turn against the app_master slot script (`_APP_MASTER_SCRIPT` in
// pipeline/jobfit/intake.py), so a dropped or reordered answer would silently
// land every later one on the wrong facet — a bench that composes the wrong
// mandate and reports a confident number about it.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  EXPECT_KEYS,
  FORBIDDEN_CLASSES,
  dialogAnswers,
  expandPath,
  forbiddenAnswer,
  listScenarioFiles,
  loadScenarioFile,
  resolveScenarioPath,
  scenarioRoleTitle,
  validateScenario,
} from "./scenarios.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

const VALID = {
  name: "unit",
  repo: { rootPath: "/tmp/app" },
  mode: "keyless",
  dialog: {
    objectives: ["gate pass rate — 95% within 60 days"],
    scopeRung: 2,
    forbiddenClasses: "all",
    budgetUsd: 120,
    owner: "the engineering lead",
    probationDays: 30,
    population: "agent",
  },
  nights: 1,
};

const clone = (over = {}) => ({ ...structuredClone(VALID), ...over });

test("a well-formed scenario validates and normalises", () => {
  const { ok, scenario, errors } = validateScenario(clone());
  assert.equal(ok, true, errors.join("; "));
  assert.equal(scenario.name, "unit");
  assert.deepEqual(scenario.repo, { rootPath: "/tmp/app" });
  assert.equal(scenario.nights, 1);
  assert.deepEqual(scenario.expect, {});
});

test("the file name is the fallback name", () => {
  const raw = clone();
  delete raw.name;
  const { ok, scenario } = validateScenario(raw, { name: "from-file" });
  assert.equal(ok, true);
  assert.equal(scenario.name, "from-file");
});

test("every problem is reported at once, not the first one", () => {
  const { ok, errors } = validateScenario({ repo: {}, mode: "sometimes", dialog: {}, nights: 99 });
  assert.equal(ok, false);
  // repo target, mode, objectives, rung, budget, owner, probation, nights.
  assert.ok(errors.length >= 7, `expected several errors, got: ${errors.join(" | ")}`);
  assert.ok(errors.some((e) => e.includes("rootPath")));
  assert.ok(errors.some((e) => e.includes("mode must be")));
  assert.ok(errors.some((e) => e.includes("nights must be")));
});

test("a repo target is exactly one of rootPath / url", () => {
  const both = validateScenario(clone({ repo: { rootPath: "/a", url: "https://example.com/x" } }));
  assert.equal(both.ok, false);
  assert.ok(both.errors.some((e) => e.includes("exactly one")));
  const url = validateScenario(clone({ repo: { url: "https://github.com/x/y" } }));
  assert.equal(url.ok, true);
  assert.deepEqual(url.scenario.repo, { url: "https://github.com/x/y" });
});

test("a rung the composer would silently clamp is refused here instead", () => {
  const raw = clone();
  raw.dialog.scopeRung = 3;
  const { ok, errors } = validateScenario(raw);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("never grantable")));
});

test("relaxing every forbidden class is refused — the composer would not apply it", () => {
  const raw = clone();
  raw.dialog.forbiddenClasses = [...FORBIDDEN_CLASSES];
  const { ok, errors } = validateScenario(raw);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("not grantable")));
});

test("an unknown expect key is refused — it would assert nothing", () => {
  const raw = clone({ expect: { probaton: "activated" } });
  const { ok, errors } = validateScenario(raw);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("probaton")));
  assert.ok(EXPECT_KEYS.includes("probation"));
});

test("the dialog expands to the nine slot answers, in slot order", () => {
  const { scenario } = validateScenario(clone());
  const answers = dialogAnswers(scenario, "r1");
  assert.equal(answers.length, 9, "the app_master script has exactly nine slots");
  assert.match(answers[1], /App master for app r1$/, "slot 2 is the title, run-tagged");
  assert.equal(answers[2], "gate pass rate — 95% within 60 days", "slot 3 is the value ledger");
  assert.match(answers[3], /^Rung 2 —/, "slot 4 is the mandate rung");
  assert.match(answers[4], /All six stand/, "slot 5 is the forbidden-class answer");
  assert.match(answers[5], /^120 USD per month\.$/, "slot 6 is the budget");
  assert.match(answers[6], /^the engineering lead reviews/, "slot 7 is the review owner");
  assert.match(answers[7], /^30 days of probation/, "slot 8 is the probation length");
  assert.match(answers[8], /AI agent/, "slot 9 is the population");
});

test("multiple objectives ride one turn, one per line", () => {
  const raw = clone();
  raw.dialog.objectives = ["a — 95% within 60 days", "b — 80% within 60 days"];
  const { scenario } = validateScenario(raw);
  assert.equal(dialogAnswers(scenario)[2], "a — 95% within 60 days\nb — 80% within 60 days");
});

test("scenarioRoleTitle is the same string the dialog sends", () => {
  const { scenario } = validateScenario(clone());
  assert.equal(scenarioRoleTitle(scenario, "tag"), dialogAnswers(scenario, "tag")[1]);
});

test("a relaxation answer carries an allow verb AND a recognisable class phrase", () => {
  const answer = forbiddenAnswer(["suppression_directive"]);
  // Both halves are required by app/_lib/intake-brief.ts: ALLOW_MARKER must
  // match, and so must the class's own CLASS_PATTERNS regex.
  assert.match(answer, /\ballow\b/i);
  assert.match(answer, /suppress/i);
  assert.match(forbiddenAnswer("all"), /All six stand/);
  assert.match(forbiddenAnswer([]), /All six stand/);
});

test("every rung has an answer the composer can read a number out of", () => {
  for (const rung of [0, 1, 2]) {
    const raw = clone();
    raw.dialog.scopeRung = rung;
    const { scenario } = validateScenario(raw);
    assert.match(dialogAnswers(scenario)[3], new RegExp(`Rung ${rung}\\b`));
  }
});

test("path tokens expand, and an unknown one is left visibly unresolved", () => {
  assert.equal(expandPath("${KP_ROOT}/x", { kpRoot: "/repo" }), "/repo/x");
  assert.equal(expandPath("${PARENT}/personas", { kpRoot: "/home/me/kp" }), `${path.dirname("/home/me/kp")}/personas`);
  assert.equal(expandPath("${SOME_VAR}/x", { kpRoot: "/repo", env: { SOME_VAR: "/from-env" } }), "/from-env/x");
  assert.equal(expandPath("${NOPE}/x", { kpRoot: "/repo", env: {} }), "${NOPE}/x");
});

test("every shipped scenario loads, validates and names a real repo target", () => {
  const files = listScenarioFiles();
  assert.ok(files.length >= 4, "the four shipped scenarios should be there");
  const names = new Set();
  for (const file of files) {
    const scenario = loadScenarioFile(file, { kpRoot: REPO_ROOT });
    assert.ok(!names.has(scenario.name), `duplicate scenario name ${scenario.name}`);
    names.add(scenario.name);
    assert.equal(dialogAnswers(scenario).length, 9);
    if (scenario.repo.rootPath) {
      assert.ok(path.isAbsolute(scenario.repo.rootPath), `${scenario.name}: rootPath must expand to an absolute path`);
      assert.ok(!scenario.repo.rootPath.includes("${"), `${scenario.name}: an unresolved token survived expansion`);
    }
  }
  for (const expected of ["kp-default", "kp-tight-budget", "kp-rung0", "personas-self"]) {
    assert.ok(names.has(expected), `missing scenario ${expected}`);
  }
});

test("the shipped scenarios encode what each one is FOR", () => {
  const byName = Object.fromEntries(
    listScenarioFiles().map((f) => {
      const s = loadScenarioFile(f, { kpRoot: REPO_ROOT });
      return [s.name, s];
    })
  );
  assert.equal(byName["kp-rung0"].dialog.scopeRung, 0, "the read-only scenario must be rung 0");
  assert.equal(byName["kp-rung0"].expect.maxProposalsOpened, 0, "a rung-0 mandate may open nothing");
  assert.match(byName["kp-rung0"].expect.probation, /extended|retired/);
  assert.equal(byName["kp-tight-budget"].dialog.budgetUsd, 5, "the tight-budget scenario runs on $5");
  assert.equal(byName["kp-tight-budget"].expect.budgetDegraded, true);
  assert.ok(byName["personas-self"].repo.rootPath.endsWith("personas"), "R2's first repo is the Personas checkout");
});

test("resolveScenarioPath takes a bare name, a file name or a path", () => {
  assert.equal(path.basename(resolveScenarioPath("kp-default")), "kp-default.json");
  assert.equal(path.basename(resolveScenarioPath("kp-default.json")), "kp-default.json");
  assert.equal(resolveScenarioPath("./some/where/x.json"), path.resolve("./some/where/x.json"));
});
