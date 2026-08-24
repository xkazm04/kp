// Scenario loading, validation and the scripted dialog it expands into.
//
// PURE on purpose — no fetch, no fs beyond reading the scenario files — so the
// whole surface is unit-testable without a server (scenarios.test.mjs).
//
// A scenario is one JSON file:
//
//   {
//     "name": "kp-default",
//     "repo":   { "rootPath": "C:/Users/…/kp" }   | { "url": "https://github.com/…" },
//     "mode":   "keyless" | "keyed",
//     "dialog": {
//       "context":          "why now, in the requestor's own words" (optional),
//       "title":            "the role title"                        (optional),
//       "objectives":       ["gate pass rate — 95% within 60 days", …],
//       "scopeRung":        0 | 1 | 2,
//       "forbiddenClasses": "all" | ["test_deletion_or_skip", …]  ← the ones RELAXED,
//       "budgetUsd":        120,
//       "owner":            "the engineering lead",
//       "probationDays":    30,
//       "population":       "agent" | "human" | "either"
//     },
//     "nights": 1,
//     "expect": { … }          ← asserted by run.mjs, see expectations.mjs
//   }
//
// `repo.rootPath` / `repo.url` expand `${KP_ROOT}` (this checkout) and
// `${PARENT}` (its parent directory), plus any environment variable — a
// committed scenario file that hard-codes one machine's home directory is a
// scenario only that machine can run. Any other top-level key (`_comment` is
// the convention here) is ignored, so a scenario can explain itself in place.
//
// The nine answers below are the app-master slot script, IN ORDER
// (`_APP_MASTER_SCRIPT` in pipeline/jobfit/intake.py). The order is a contract:
// the driver posts them one per turn and the engine advances one slot per turn,
// so an inserted or dropped answer silently shifts every later one onto the
// wrong facet. If that list changes, this one changes with it.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCENARIO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "scenarios");

/** The six classes, and a phrase that matches each CLASS_PATTERNS regex in
 *  app/_lib/intake-brief.ts. A relaxation answer must contain both an allow
 *  verb and a phrase the composer can recognise, or nothing is relaxed. */
export const FORBIDDEN_CLASS_PHRASE = {
  test_deletion_or_skip: "skip a test",
  suppression_directive: "suppression directives",
  gate_configuration: "gate config changes",
  dependency_bump_to_satisfy_check: "dependency bumps",
  credentials_or_permissions: "credentials and permissions",
  delivery_configuration: "delivery config changes",
};

export const FORBIDDEN_CLASSES = Object.keys(FORBIDDEN_CLASS_PHRASE);

export const MODES = ["keyless", "keyed"];
export const POPULATIONS = ["agent", "human", "either"];

/** Every key `expect` may carry. An unknown one is a typo that would otherwise
 *  assert nothing at all — the worst possible failure mode for a bench. */
export const EXPECT_KEYS = [
  "population_fit",
  "minBackboneCoverage",
  "probation",
  "maxProposalsOpened",
  "noViolations",
  "budgetDegraded",
];

const RUNG_ANSWER = {
  0: "Rung 0 — read and report only. Nothing may be changed in the repository.",
  1: "Rung 1 — re-run existing work. No new change may be authored.",
  2: "Rung 2 — open a branch and propose a change a human merges.",
};

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validate a parsed scenario object. Returns `{ ok, scenario, errors }` — a
 * LIST of every problem, not the first one: fixing a scenario file one error
 * per run is how a bench stops being run at all.
 */
export function validateScenario(raw, { name = "" } = {}) {
  const errors = [];
  const push = (msg) => errors.push(msg);

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, scenario: null, errors: ["scenario must be a JSON object"] };
  }

  const scenarioName = isNonEmptyString(raw.name) ? raw.name.trim() : name;
  if (!isNonEmptyString(scenarioName)) push("name is required (or derive it from the file name)");

  const repo = raw.repo;
  if (!repo || typeof repo !== "object" || Array.isArray(repo)) {
    push("repo is required: { rootPath } or { url }");
  } else {
    const hasRoot = isNonEmptyString(repo.rootPath);
    const hasUrl = isNonEmptyString(repo.url);
    if (!hasRoot && !hasUrl) push("repo needs a non-empty rootPath or url");
    if (hasRoot && hasUrl) push("repo carries both rootPath and url — the scan takes exactly one target");
  }

  const mode = raw.mode ?? "keyless";
  if (!MODES.includes(mode)) push(`mode must be one of ${MODES.join(" | ")} (got ${JSON.stringify(raw.mode)})`);

  const dialog = raw.dialog;
  if (!dialog || typeof dialog !== "object" || Array.isArray(dialog)) {
    push("dialog is required");
  } else {
    if (!Array.isArray(dialog.objectives) || dialog.objectives.length === 0) {
      push("dialog.objectives must be a non-empty array of strings");
    } else if (!dialog.objectives.every(isNonEmptyString)) {
      push("every dialog.objectives entry must be a non-empty string");
    }
    if (!Number.isInteger(dialog.scopeRung) || dialog.scopeRung < 0 || dialog.scopeRung > 2) {
      // Rungs 3 and 4 are never grantable (MAX_AGENT_SCOPE_RUNG); a scenario
      // asking for one would be silently clamped by the composer, so refuse it
      // here where the delta is still visible.
      push("dialog.scopeRung must be 0, 1 or 2 — rungs 3+ are never grantable");
    }
    const fc = dialog.forbiddenClasses ?? "all";
    if (fc !== "all") {
      if (!Array.isArray(fc)) push('dialog.forbiddenClasses must be "all" or an array of relaxed class slugs');
      else {
        for (const cls of fc) {
          if (!FORBIDDEN_CLASSES.includes(cls)) push(`unknown forbidden class ${JSON.stringify(cls)}`);
        }
        if (fc.length >= FORBIDDEN_CLASSES.length) {
          push("relaxing every forbidden class is not grantable — the composer refuses it and all six stand");
        }
      }
    }
    if (typeof dialog.budgetUsd !== "number" || !Number.isFinite(dialog.budgetUsd) || dialog.budgetUsd <= 0) {
      push("dialog.budgetUsd must be a positive number");
    }
    if (!isNonEmptyString(dialog.owner)) push("dialog.owner is required — escalations need somewhere to go");
    if (!Number.isInteger(dialog.probationDays) || dialog.probationDays <= 0) {
      push("dialog.probationDays must be a positive integer");
    }
    const population = dialog.population ?? "agent";
    if (!POPULATIONS.includes(population)) {
      push(`dialog.population must be one of ${POPULATIONS.join(" | ")}`);
    }
  }

  const nights = raw.nights ?? 1;
  if (!Number.isInteger(nights) || nights < 0 || nights > 30) {
    push("nights must be an integer 0..30 (one tick = one compressed night)");
  }

  if (raw.expect !== undefined) {
    if (!raw.expect || typeof raw.expect !== "object" || Array.isArray(raw.expect)) {
      push("expect must be an object");
    } else {
      for (const key of Object.keys(raw.expect)) {
        if (!EXPECT_KEYS.includes(key)) push(`unknown expect key ${JSON.stringify(key)} — it would assert nothing`);
      }
    }
  }

  if (errors.length > 0) return { ok: false, scenario: null, errors };

  return {
    ok: true,
    errors: [],
    scenario: {
      name: scenarioName,
      repo: isNonEmptyString(raw.repo.rootPath)
        ? { rootPath: raw.repo.rootPath.trim() }
        : { url: raw.repo.url.trim() },
      mode,
      dialog: {
        context: isNonEmptyString(dialog.context) ? dialog.context.trim() : "",
        title: isNonEmptyString(dialog.title) ? dialog.title.trim() : "",
        objectives: dialog.objectives.map((o) => o.trim()),
        scopeRung: dialog.scopeRung,
        forbiddenClasses: dialog.forbiddenClasses ?? "all",
        budgetUsd: dialog.budgetUsd,
        owner: dialog.owner.trim(),
        probationDays: dialog.probationDays,
        population: dialog.population ?? "agent",
      },
      nights,
      expect: raw.expect ?? {},
    },
  };
}

/**
 * Expand `${…}` in a repo target. A scenario file is committed and shared, so a
 * literal `C:/Users/<someone>/kiro/kp` in it is a scenario that only ever runs
 * on one machine. Two built-ins cover every case the bench has:
 *
 *   ${KP_ROOT}  this checkout          ${PARENT}  its parent directory
 *
 * Anything else resolves from the environment; an unset variable is left as
 * written so the scan's own fail-closed allow-list refuses a visibly wrong path
 * rather than a silently empty one.
 */
export function expandPath(value, { kpRoot = process.cwd(), env = process.env } = {}) {
  return String(value).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name) => {
    if (name === "KP_ROOT") return kpRoot;
    if (name === "PARENT") return path.dirname(kpRoot);
    return env[name] ?? whole;
  });
}

/** Read + validate one scenario file. Throws with every error listed. */
export function loadScenarioFile(file, { kpRoot } = {}) {
  const name = path.basename(file).replace(/\.json$/i, "");
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`scenario ${name}: not readable JSON — ${error.message}`);
  }
  if (raw?.repo && typeof raw.repo === "object") {
    const opts = kpRoot ? { kpRoot } : {};
    if (typeof raw.repo.rootPath === "string") raw.repo.rootPath = expandPath(raw.repo.rootPath, opts);
    if (typeof raw.repo.url === "string") raw.repo.url = expandPath(raw.repo.url, opts);
  }
  const { ok, scenario, errors } = validateScenario(raw, { name });
  if (!ok) throw new Error(`scenario ${name} is invalid:\n  - ${errors.join("\n  - ")}`);
  scenario.file = file;
  return scenario;
}

/** Resolve `kp-default`, `kp-default.json` or an explicit path to a file. */
export function resolveScenarioPath(nameOrPath, dir = SCENARIO_DIR) {
  if (nameOrPath.includes("/") || nameOrPath.includes("\\")) return path.resolve(nameOrPath);
  const base = nameOrPath.endsWith(".json") ? nameOrPath : `${nameOrPath}.json`;
  return path.join(dir, base);
}

/** Every scenario in the directory, name-sorted, so `--all` is deterministic. */
export function listScenarioFiles(dir = SCENARIO_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => path.join(dir, f));
}

/** The forbidden-class answer: either "all six stand", or a relaxation the
 *  composer can actually read back (allow verb + a recognisable phrase). */
export function forbiddenAnswer(forbiddenClasses) {
  if (forbiddenClasses === "all" || !Array.isArray(forbiddenClasses) || forbiddenClasses.length === 0) {
    return "All six stand. Nothing there is negotiable for us.";
  }
  const phrases = forbiddenClasses.map((c) => FORBIDDEN_CLASS_PHRASE[c]);
  return `We allow ${phrases.join(" and ")}. Every other class stands.`;
}

/**
 * The nine scripted answers, in slot order. `runTitle` is appended to the role
 * title so two runs of the same scenario never resolve each other's roster row
 * (the same reason e2e/app-master-hire.spec.ts stamps a runId).
 */
export function dialogAnswers(scenario, runTitle = "") {
  const d = scenario.dialog;
  const appLabel = scenario.repo.rootPath ? path.basename(scenario.repo.rootPath) : scenario.repo.url;
  const title = `${d.title || `App master for ${appLabel}`}${runTitle ? ` ${runTitle}` : ""}`;
  const population = {
    agent: "An AI agent should hold it.",
    human: "A human should hold this role.",
    either: "Either — an agent or a human could hold it.",
  }[d.population];

  return [
    d.context ||
      "The verification gates keep going red between releases and nobody owns them end to end. In three months the on-call engineers should stop babysitting CI.",
    title,
    d.objectives.join("\n"),
    RUNG_ANSWER[d.scopeRung],
    forbiddenAnswer(d.forbiddenClasses),
    `${d.budgetUsd} USD per month.`,
    `${d.owner} reviews every proposal and answers escalations.`,
    `${d.probationDays} days of probation, then we decide.`,
    population,
  ];
}

/** The role title the nine answers will produce — the handle the driver uses to
 *  find its own row on the roster. Derived from the same function, never a
 *  second copy of the string. */
export function scenarioRoleTitle(scenario, runTitle = "") {
  return dialogAnswers(scenario, runTitle)[1];
}
