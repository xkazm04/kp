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
 *  reports `null` the day that shape gains a wrapper.
 *
 *  This is HALF the reading. A live bridge's tick summary carries none of these
 *  names (sweep 2026-08-25 read `{}` from a night that genuinely opened three
 *  proposals); the numbers reach kp through the report push and come back on the
 *  ROSTER, in the scored shape `readingFromRoster()` below reads. The two are
 *  folded together by `mergeReadings()`. */
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

/**
 * One phase's own result block out of a tick summary.
 *
 * Two shapes are read, because two servers produce them: the real bridge
 * answers `phases: [{ phase: "overnight", counts: {…} }, …]` (§13.6) and the
 * in-process stub answers `phases: { overnight: {…} }`. Returns `null` when the
 * summary has no such phase at all — an absence, never `{}`.
 */
export function phaseEntry(summary, phaseName) {
  const phases = summary?.phases;
  if (Array.isArray(phases)) return phases.find((p) => p?.phase === phaseName) ?? null;
  if (phases && typeof phases === "object") return phases[phaseName] ?? null;
  return null;
}

/** A phase's `counts` block, or `null` when the phase or the block is absent. */
export function phaseCounts(summary, phaseName) {
  return phaseEntry(summary, phaseName)?.counts ?? null;
}

/** The `overnight` phase's own `counts` block out of one NIGHT record. */
export function overnightCounts(night) {
  return phaseCounts(night?.tick, "overnight");
}

/** The `reconcile` phase's own `counts` block out of a tick summary — what the
 *  settle loop watches: `{ projects, branchesSeen, newlyRecorded, gated, errors }`. */
export function reconcileCounts(summary) {
  return phaseCounts(summary, "reconcile");
}

// ─── the roster reading ─────────────────────────────────────────────────────
//
// `GET /api/agents` does NOT serve the raw rollup counters. It serves the
// SCORED backbone (`app/_lib/app-master/backbone.ts::backboneScore`) — one row
// per rule with `measured` / `value` / `reason`, plus the `gates` array, plus
// `kpiDeltas` and `appMaster.autopilotMode`. So the night's reading is
// reconstructed from the scored shape, structured fields first:
//
//   gatePassRate             ← rules.gates.value          (the rate itself, 0..1)
//   forbiddenClassViolations ← gates.forbidden_classes.value
//   ledgerConsistent         ← rules.ledger.value          (boolean)
//   budget*                  ← rules.budget                (measured flag + reason)
//   proposalsOpened/Merged   ← rules.delivery.reason       ← LAST RESORT
//   proposalsReverted        ← rules.durability.reason     ← LAST RESORT
//
// The two count pairs are the only fields with no structured carrier: the
// delivery rule's `value` is the merged/opened RATIO, and the counts behind it
// survive only in the reason string the scorer writes. That string is pinned on
// both sides (`backbone.ts` and `pipeline/jobfit/appmaster.py` write it
// character-for-character, fixture-tested against each other), so parsing it is
// a narrow, checked read rather than prose mining — and a reason that does NOT
// match leaves the field ABSENT rather than guessing a zero.

/** `"0 of 3 proposals merged"` — backbone.ts delivery, measured arm. */
const DELIVERY_REASON = /^(\d+) of (\d+) proposals merged$/;
/** `"1 of 4 merged proposals reverted"` — backbone.ts durability, measured arm. */
const DURABILITY_REASON = /^(\d+) of (\d+) merged proposals reverted$/;
/** `"$0.00 settled against $4.50 reserved"` — backbone.ts budget, measured arm. */
const BUDGET_REASON = /^\$(\d+(?:\.\d+)?) settled against \$(\d+(?:\.\d+)?) reserved$/;
/** `"$1.85 settled against no reservation"` — same rule, reserved <= 0 arm. */
const BUDGET_NO_RESERVATION = /^\$(\d+(?:\.\d+)?) settled against no reservation$/;

function ruleOf(backbone, key) {
  return Array.isArray(backbone?.rules) ? (backbone.rules.find((r) => r?.rule === key) ?? null) : null;
}

function gateOf(backbone, key) {
  return Array.isArray(backbone?.gates) ? (backbone.gates.find((g) => g?.gate === key) ?? null) : null;
}

/**
 * The backbone reading a ROSTER ROW carries — the record kp stored and scored,
 * which is the only place a live night's delivery numbers actually surface.
 *
 * Absence stays absence. A rule the roster did not carry, or one whose reason
 * does not match the pinned string, leaves its field out of the object entirely
 * — the caller's `null` semantics then read "nobody reported this", never zero.
 * A rule that IS present and says a count was zero is a reported zero and is
 * recorded as one: kp scores no backbone at all until a v2 rollup arrives
 * (`hasBackboneFields`), so a present rule is a sender's reading, not a default.
 */
export function readingFromRoster(row) {
  const out = {};
  const mode = row?.appMaster?.autopilotMode;
  if (typeof mode === "string" && mode) out.autopilotMode = mode;

  const backbone = row?.backbone;
  if (!backbone || typeof backbone !== "object") return out;

  const gates = ruleOf(backbone, "gates");
  if (gates?.measured === true && typeof gates.value === "number") out.gatePassRate = gates.value;

  const forbidden = gateOf(backbone, "forbidden_classes");
  if (typeof forbidden?.value === "number") out.forbiddenClassViolations = forbidden.value;

  const ledger = ruleOf(backbone, "ledger");
  if (typeof ledger?.value === "boolean") out.ledgerConsistent = ledger.value;

  const delivery = ruleOf(backbone, "delivery");
  if (delivery) {
    const reason = String(delivery.reason ?? "");
    const matched = DELIVERY_REASON.exec(reason);
    if (delivery.measured === true && matched) {
      out.proposalsMerged = Number(matched[1]);
      out.proposalsOpened = Number(matched[2]);
    } else if (delivery.measured === false && /^no proposals were opened in the window/.test(reason)) {
      // The scorer only writes this when `proposalsOpened === 0`. Nothing opened
      // ⇒ nothing merged; both are readings, and `minProposalsOpened` is
      // supposed to FAIL on them rather than call them unmeasured.
      out.proposalsOpened = 0;
      out.proposalsMerged = 0;
    }
  }

  const durability = ruleOf(backbone, "durability");
  if (durability) {
    const reason = String(durability.reason ?? "");
    const matched = DURABILITY_REASON.exec(reason);
    if (durability.measured === true && matched) {
      out.proposalsReverted = Number(matched[1]);
      if (out.proposalsMerged === undefined) out.proposalsMerged = Number(matched[2]);
    } else if (durability.measured === false && /^no proposals merged in the window/.test(reason)) {
      out.proposalsReverted = 0;
    }
  }

  const budget = ruleOf(backbone, "budget");
  if (budget) {
    const reason = String(budget.reason ?? "");
    if (budget.measured === false) {
      // "spend was not metered for this window" is the ONE reason that means the
      // meter was never read; "nothing reserved and nothing spent" is a metered
      // pair of zeroes the scorer simply had nothing to rate.
      if (/not metered/.test(reason)) out.budgetUnmeasured = true;
      else if (/^nothing was reserved and nothing was spent/.test(reason)) {
        out.budgetUnmeasured = false;
        out.budgetReservedUsd = 0;
        out.budgetSettledUsd = 0;
      }
    } else {
      const paired = BUDGET_REASON.exec(reason);
      const unreserved = paired ? null : BUDGET_NO_RESERVATION.exec(reason);
      if (paired) {
        out.budgetUnmeasured = false;
        out.budgetSettledUsd = Number(paired[1]);
        out.budgetReservedUsd = Number(paired[2]);
      } else if (unreserved) {
        out.budgetUnmeasured = false;
        out.budgetSettledUsd = Number(unreserved[1]);
        out.budgetReservedUsd = 0;
      }
    }
  }

  return out;
}

/**
 * Fold the tick-summary reading and the roster reading into ONE night reading,
 * plus a per-field provenance map.
 *
 * The ROSTER WINS every field it carries. The tick summary is Personas' own
 * live shape and may echo a rollup, a stale one, or nothing at all; the roster
 * row is what kp received, stored and scored, and it is the record every other
 * surface (the workforce table, the report) reads. Where the roster is silent
 * the tick reading stands, so a Personas build that reports counters inline is
 * still read.
 */
export function mergeReadings(tickReading = {}, rosterReading = {}) {
  const reading = {};
  const source = {};
  for (const [key, value] of Object.entries(tickReading ?? {})) {
    if (value === undefined || value === null) continue;
    reading[key] = value;
    source[key] = "tick";
  }
  for (const [key, value] of Object.entries(rosterReading ?? {})) {
    if (value === undefined || value === null) continue;
    reading[key] = value;
    source[key] = "roster";
  }
  return { reading, source };
}

/** The night's blocked reason(s), wherever the ledger rows carry them. */
function blockedReasons(night) {
  const details = phaseEntry(night?.tick, "overnight")?.details ?? [];
  const out = [];
  for (const row of Array.isArray(details) ? details : [details]) {
    const reason = row?.blockedReason ?? row?.blocked_reason ?? null;
    if (typeof reason === "string" && reason.trim()) out.push(reason);
  }
  return out;
}

function readsAsBudgetRefusal(text) {
  return typeof text === "string" && BUDGET_WORD.test(text) && STOPPED_WORD.test(text);
}

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

  if (expect.minProposalsOpened !== undefined) {
    const actual = maxReading(nights, (n) => n?.reading?.proposalsOpened ?? null);
    // Strictly the mirror of maxProposalsOpened: an ABSENT count fails here.
    // "nothing reported a proposal count" is precisely the reading sweeps #11
    // and #12 produced, and calling it a pass would hide the very hole this
    // expectation exists to close.
    const ok = actual !== null && actual >= expect.minProposalsOpened;
    const dispatched = maxReading(nights, (n) => overnightCounts(n)?.dispatched ?? null);
    checks.push(
      check(
        "minProposalsOpened",
        ok,
        `>= ${expect.minProposalsOpened}`,
        actual,
        actual === null
          ? `no night reported a proposal count${
              dispatched === null ? "" : ` (the busiest overnight dispatched ${dispatched})`
            } — seed the scenario and check the overnight phase actually dispatched`
          : `the busiest night opened ${actual} proposal(s)`,
        actual === null ? "unmeasured — an absent count is not a reported zero, and it is not a pass either" : null
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
    // FULL-MODE SEMANTICS. Before the seed phase existed this check could only
    // read prose and autopilot modes, because no night ever reached the
    // governor: with nothing to dispatch, `run_project_night` never enters the
    // budget arm at all. A seeded night does, and the tick summary's own
    // `overnight.counts` (§13.6: `{projects, dispatched, blocked, degraded}`)
    // is the primary evidence.
    //
    // STRICT on purpose. `degraded` is set in exactly ONE place in
    // `overnight::run_project_night` — the `BudgetVerdict::Block` arm, which
    // also persists the `full → suggest` downgrade — so a `degraded ≥ 1` is a
    // budget refusal by construction. `blocked ≥ 1` is NOT: the same counter
    // increments for "mode `suggest` triages but does not dispatch", for a
    // mandate rung refusal and for "no free fleet live slots tonight". So a
    // block only counts when the ledger row's `blockedReason` READS as a budget
    // refusal — otherwise this check would pass on a night the budget never
    // touched, which is the failure it exists to catch.
    const evidence = [];
    const seenModes = [];
    const otherBlocks = [];
    for (const night of nights) {
      const counts = overnightCounts(night);
      // (a) the governor's own degrade flag.
      if (typeof counts?.degraded === "number" && counts.degraded >= 1) {
        evidence.push(
          `night ${night.night}: overnight reported degraded=${counts.degraded} — the budget governor refused the dispatch and downgraded full → suggest`
        );
      }
      // (b) a block whose reason is budget-shaped.
      if (typeof counts?.blocked === "number" && counts.blocked >= 1) {
        const reasons = blockedReasons(night);
        const budgetReason = reasons.find(readsAsBudgetRefusal);
        if (budgetReason) {
          evidence.push(`night ${night.night}: overnight blocked — "${budgetReason.slice(0, 160)}"`);
        } else {
          otherBlocks.push(
            `n${night.night}: blocked=${counts.blocked} for a non-budget reason${
              reasons.length > 0 ? ` ("${reasons[0].slice(0, 80)}")` : ""
            }`
          );
        }
      }
      const mode = night?.appMaster?.autopilotMode ?? night?.reading?.autopilotMode ?? null;
      if (mode) seenModes.push(`n${night.night}:${mode}`);
      // (c) autopilot degraded below `suggest`, the probation mode a hire starts on.
      if (mode && AUTOPILOT_ORDER.indexOf(mode) >= 0 && AUTOPILOT_ORDER.indexOf(mode) < AUTOPILOT_ORDER.indexOf("suggest")) {
        evidence.push(`night ${night.night}: autopilot reported "${mode}" — below the probation mode "suggest"`);
      }
      // (d) a metered spend that reached the ceiling. Only when the spend was
      //     actually metered: budgetUnmeasured means nobody read the meter.
      const reading = night?.reading ?? {};
      const settled = reading.budgetSettledUsd;
      if (reading.budgetUnmeasured === false && typeof settled === "number" && settled >= scenario.dialog.budgetUsd) {
        evidence.push(`night ${night.night}: settled $${settled} against a $${scenario.dialog.budgetUsd} ceiling`);
      }
      // (e) a refusal the reporter stated in prose anywhere in the summary.
      for (const text of collectStrings(night?.tick ?? null)) {
        if (readsAsBudgetRefusal(text)) {
          evidence.push(`night ${night.night}: "${text.slice(0, 120)}"`);
          break;
        }
      }
    }
    const ok = evidence.length > 0;
    const context = [...otherBlocks, ...seenModes];
    checks.push(
      check(
        "budgetDegraded",
        ok,
        "an overnight budget refusal: counts.degraded >= 1, a budget-shaped block, autopilot below suggest, or a metered spend at the ceiling",
        ok ? evidence : context.length > 0 ? context : null,
        ok
          ? evidence[0]
          : otherBlocks.length > 0
            ? `the night was blocked, but not by the budget — ${otherBlocks.join("; ")}. A dispatch that never reached the governor does not measure it.`
            : seenModes.length > 0
              ? `no budget refusal was reported; autopilot stayed at ${seenModes.join(", ")}`
              : "no night reported an overnight counts block, an autopilot mode or a metered spend — the budget lane is unmeasured"
      )
    );
  }

  return { ok: checks.every((c) => c.ok), checks };
}
