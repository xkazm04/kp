// The expectation evaluator: a scenario's `expect` block asserted against the
// run record it produced.
//
// PURE (expectations.test.mjs covers it end to end). Two rules shape every
// check here, and they are the same two the performance backbone itself runs on:
//
//   * **Unmeasured is not zero.** A field nothing reported comes back `null`,
//     and a check says so in its `note` instead of scoring the absence. Where a
//     null legitimately satisfies the expectation (nothing was proposed BECAUSE
//     nothing may be proposed), the check passes and still records that it read
//     an absence rather than a reading.
//   * **A failed expectation is a scenario FAIL, not an exception.** Every
//     check returns a row with `expected`, `actual` and a `delta` sentence a
//     human can act on. The driver prints them and exits non-zero; it never
//     throws out of this module.

/** Autopilot modes, weakest first (app/_lib/agent-hire/report-payload.ts). */
export const AUTOPILOT_ORDER = ["off", "measure", "suggest", "full"];

/** The PerformanceBackbone fields a tick summary may carry, wherever it carries
 *  them. Deep-scanned rather than read at a fixed path because the per-phase
 *  summary shape is Personas' to define — a driver that hard-codes one nesting
 *  reports `null` the day that shape gains a wrapper. */
export const BACKBONE_FIELDS = [
  "windowDays",
  "proposalsOpened",
  "proposalsMerged",
  "proposalsReverted",
  "gatePassRate",
  "forbiddenClassViolations",
  "budgetReservedUsd",
  "budgetSettledUsd",
  "budgetUnmeasured",
  "ledgerConsistent",
  "autopilotMode",
];

/**
 * Pull whatever backbone reading a (nested, vendor-shaped) tick summary holds.
 * First occurrence of each field wins — breadth-first, so a top-level rollup
 * beats a copy buried in a per-phase log. Fields nobody reported stay absent,
 * which is what keeps `null` distinguishable from a reported zero.
 */
export function extractBackboneReading(summary) {
  const found = {};
  const queue = [summary];
  let guard = 0;
  while (queue.length > 0 && guard++ < 5_000) {
    const node = queue.shift();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const item of node) queue.push(item);
      continue;
    }
    for (const field of BACKBONE_FIELDS) {
      if (found[field] === undefined && node[field] !== undefined && node[field] !== null) {
        found[field] = node[field];
      }
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return found;
}

/** Every string value anywhere in a structure — the evidence pool a "did the
 *  budget gate trip" question is answered from when the reporter says it in
 *  prose rather than in a flag. */
export function collectStrings(node, out = [], guard = { n: 0 }) {
  if (guard.n++ > 5_000) return out;
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  if (!node || typeof node !== "object") return out;
  for (const value of Object.values(node)) collectStrings(value, out, guard);
  return out;
}

const BUDGET_WORD = /budget|spend|ceiling|cap\b/i;
const STOPPED_WORD = /block|trip|exceed|halt|degrad|refus|over(-|\s)?budget|out of budget|paused/i;

/** Max of the readings that exist; `null` when none did. */
function maxReading(nights, read) {
  let best = null;
  for (const night of nights ?? []) {
    const value = read(night);
    if (typeof value === "number" && Number.isFinite(value)) best = best === null ? value : Math.max(best, value);
  }
  return best;
}

function asSet(expected) {
  return String(expected)
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

function check(name, ok, expected, actual, delta, note = null) {
  return { name, ok, expected, actual, delta, ...(note ? { note } : {}) };
}

/**
 * Evaluate `scenario.expect` against a run record.
 * Returns `{ ok, checks }` — `ok` false when ANY check failed.
 */
export function evaluateExpectations(scenario, result) {
  const expect = scenario?.expect ?? {};
  const nights = result?.nights ?? [];
  const checks = [];

  if (expect.population_fit !== undefined) {
    const allowed = asSet(expect.population_fit);
    const actual = result?.populationFit?.verdict ?? null;
    const ok = actual !== null && allowed.includes(actual);
    checks.push(
      check(
        "population_fit",
        ok,
        allowed.join(" | "),
        actual,
        ok
          ? "the compose recorded the expected population verdict"
          : actual === null
            ? "no population verdict was recorded — the compose never returned a fit"
            : `the compose recorded "${actual}"`
      )
    );
  }

  if (expect.minBackboneCoverage !== undefined) {
    const actual = maxReading(nights, (n) => n?.backbone?.coverage ?? null);
    const ok = actual !== null && actual >= expect.minBackboneCoverage;
    checks.push(
      check(
        "minBackboneCoverage",
        ok,
        `>= ${expect.minBackboneCoverage}`,
        actual,
        actual === null
          ? "no night produced a scored backbone — nothing reported one, so coverage is unmeasured, not zero"
          : `best coverage across ${nights.length} night(s) was ${actual}`
      )
    );
  }

  if (expect.probation !== undefined) {
    const allowed = asSet(expect.probation);
    const actual = result?.probation?.decision ?? null;
    const ok = actual !== null && allowed.includes(actual);
    checks.push(
      check(
        "probation",
        ok,
        allowed.join(" | "),
        actual,
        ok
          ? "the forced probation review decided as expected"
          : actual === null
            ? "the probation phase returned no decision — a review with no decision is not a review"
            : `the review decided "${actual}"`
      )
    );
  }

  if (expect.maxProposalsOpened !== undefined) {
    const actual = maxReading(nights, (n) => n?.reading?.proposalsOpened ?? null);
    // `null` satisfies the ceiling — a rung-0 mandate that opened nothing may
    // legitimately report nothing at all — but it is recorded as an absence.
    const ok = actual === null || actual <= expect.maxProposalsOpened;
    checks.push(
      check(
        "maxProposalsOpened",
        ok,
        `<= ${expect.maxProposalsOpened}`,
        actual,
        actual === null
          ? "no night reported a proposal count"
          : `the busiest night opened ${actual} proposal(s)`,
        actual === null ? "unmeasured — an absent count is not a reported zero" : null
      )
    );
  }

  if (expect.noViolations !== undefined && expect.noViolations !== false) {
    const actual = maxReading(nights, (n) => n?.reading?.forbiddenClassViolations ?? null);
    const ok = actual === null || actual === 0;
    checks.push(
      check(
        "noViolations",
        ok,
        "0",
        actual,
        actual === null
          ? "no night reported a forbidden-class violation count"
          : `${actual} forbidden-class violation(s) were recorded`,
        actual === null ? "unmeasured — an absent count is not a clean run" : null
      )
    );
  }

  if (expect.budgetDegraded !== undefined && expect.budgetDegraded !== false) {
    const evidence = [];
    const seenModes = [];
    for (const night of nights) {
      const mode = night?.appMaster?.autopilotMode ?? night?.reading?.autopilotMode ?? null;
      if (mode) seenModes.push(`n${night.night}:${mode}`);
      // (a) autopilot degraded below `suggest`, the probation mode a hire starts on.
      if (mode && AUTOPILOT_ORDER.indexOf(mode) >= 0 && AUTOPILOT_ORDER.indexOf(mode) < AUTOPILOT_ORDER.indexOf("suggest")) {
        evidence.push(`night ${night.night}: autopilot reported "${mode}" — below the probation mode "suggest"`);
      }
      // (b) a metered spend that reached the ceiling. Only when the spend was
      //     actually metered: budgetUnmeasured means nobody read the meter.
      const reading = night?.reading ?? {};
      const settled = reading.budgetSettledUsd;
      if (reading.budgetUnmeasured === false && typeof settled === "number" && settled >= scenario.dialog.budgetUsd) {
        evidence.push(`night ${night.night}: settled $${settled} against a $${scenario.dialog.budgetUsd} ceiling`);
      }
      // (c) the reporter said so in prose.
      for (const text of collectStrings(night?.tick ?? null)) {
        if (BUDGET_WORD.test(text) && STOPPED_WORD.test(text)) {
          evidence.push(`night ${night.night}: "${text.slice(0, 120)}"`);
          break;
        }
      }
    }
    const ok = evidence.length > 0;
    checks.push(
      check(
        "budgetDegraded",
        ok,
        "the budget gate trips, or autopilot degrades below suggest",
        ok ? evidence : seenModes.length > 0 ? seenModes : null,
        ok
          ? evidence[0]
          : seenModes.length > 0
            ? `no budget refusal was reported; autopilot stayed at ${seenModes.join(", ")}`
            : "no night reported an autopilot mode or a metered spend — the budget lane is unmeasured"
      )
    );
  }

  return { ok: checks.every((c) => c.ok), checks };
}
