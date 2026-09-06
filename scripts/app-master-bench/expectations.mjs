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

// Both vocabularies below are kp's, not this driver's: they are declared in
// `app/_lib/agent-hire/report-payload.ts` (the CONTRACT SOURCE for what a
// Personas build may send) and copied here only because this file is a plain
// `.mjs` the driver loads without the app's module graph. `expectations.test.mjs`
// pins each copy to that file — a mode added there, or a backbone field renamed
// there, fails the bench suite instead of being silently unread by the bench.

/** Autopilot modes, weakest first — the values of `AUTOPILOT_MODES`
 *  (app/_lib/agent-hire/report-payload.ts), which is already declared weakest
 *  first; `autopilotAtLeast` compares by index. */
export const AUTOPILOT_ORDER = ["off", "measure", "suggest", "full"];

/** The `RollupBackbone` fields a tick summary may carry, wherever it carries
 *  them. Deep-scanned rather than read at a fixed path because the per-phase
 *  summary shape is Personas' to define — a driver that hard-codes one nesting
 *  reports `null` the day that shape gains a wrapper.
 *
 *  This is the REPORTED shape (`report-payload.ts::RollupBackbone`), not the
 *  scored one: `windowDays` used to head this list and is not on it — the window
 *  is the RECEIVER's (`backboneFromRollup(raw, windowDays)`), so scanning a tick
 *  summary for it read a number the sender never sent. `kpiDeltas` and `memory`
 *  ARE sent and were missing, so a tick summary that carried them was ignored.
 *
 *  This is HALF the reading. A live bridge's tick summary carries none of these
 *  names (sweep 2026-08-25 read `{}` from a night that genuinely opened three
 *  proposals); the numbers reach kp through the report push and come back on the
 *  ROSTER, in the scored shape `readingFromRoster()` below reads. The two are
 *  folded together by `mergeReadings()`. */
export const BACKBONE_FIELDS = [
  "proposalsOpened",
  "proposalsMerged",
  "proposalsReverted",
  "gatePassRate",
  "forbiddenClassViolations",
  "kpiDeltas",
  "budgetReservedUsd",
  "budgetSettledUsd",
  "budgetUnmeasured",
  "ledgerConsistent",
  "autopilotMode",
  "memory",
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

// ─── C1: the night's own judgment (c1-exam §3) ──────────────────────────────
//
// The three readings below are the exam. Thirty-one sweeps measured integrity
// and measurement — both closed rings — and not one check ever read the
// holder's RANKING or its DECLINES, which is the competency the role rubric
// actually names (`ranks candidate changes by measured user value, declines
// low-value work with a reason`).
//
// Both lists ride the overnight tick summary, and NEITHER EXISTS YET on the
// Personas side: today's summary carries `blockedReason` prose like *"1
// accepted idea(s) left for the morning"*, not the list. So every check here
// reads `null` and says so rather than failing a night whose build cannot yet
// answer — an expectation that failed on a missing dependency would be turned
// off within one sweep, and then it would never be turned back on.

/** The two lists a rung-0 ideation night produces, wherever the summary carries
 *  them — deep-scanned for the same reason BACKBONE_FIELDS is. */
export const NIGHT_LIST_FIELDS = ["proposals", "declines"];

/** The closed set a decline's reason must come from (§2). A reason outside it
 *  is not a reason — "it didn't feel right" is what this check exists to catch. */
export const DECLINE_REASONS = ["low-value", "outside-mandate", "already-done", "needs-human"];

/** The prose forms §2 writes the same four reasons in. Punctuation is not the
 *  finding, so these normalise; anything else stays unrecognised. */
const DECLINE_ALIASES = {
  "low-value": "low-value",
  "lowvalue": "low-value",
  "outside-mandate": "outside-mandate",
  "out-of-mandate": "outside-mandate",
  "already-done": "already-done",
  "needs-human": "needs-human",
  "needs-a-human": "needs-human",
  "needs-human-decision": "needs-human",
  "needs-a-human-decision": "needs-human",
};

/** The axes a value claim may move (§3). A proposal that names none is a
 *  task-executor's proposal. */
export const VALUE_AXES = ["time", "risk", "gate"];

/** ≥3 verbatim backlog titles in one night's proposal list is the backlog read
 *  back, not judgment (§6). The run says so and counts NO hits for that night. */
export const CONTAMINATION_MATCHES = 3;

/**
 * Pull the proposal list and the decline log out of a (nested, vendor-shaped)
 * tick summary. Same breadth-first, first-occurrence-wins rule as
 * `extractBackboneReading`: a top-level list beats a copy buried in a per-phase
 * log, and a field nobody reported stays ABSENT rather than becoming `[]`.
 */
export function extractNightLists(summary) {
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
    for (const field of NIGHT_LIST_FIELDS) {
      if (found[field] === undefined && Array.isArray(node[field])) found[field] = node[field];
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return found;
}

/**
 * The `ideation` block a night's tick summary carries — `{ ran, lens, authored,
 * blocked }` — wherever it carries it. Same deep, first-occurrence-wins scan as
 * the lists above, and the same rule: a build that reports none reads `null`,
 * never a fabricated `{ ran: false }`. Not reporting ideation and reporting
 * that it did not run are different findings.
 */
export function extractIdeation(summary) {
  const queue = [summary];
  let guard = 0;
  while (queue.length > 0 && guard++ < 5_000) {
    const node = queue.shift();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const item of node) queue.push(item);
      continue;
    }
    const value = node.ideation;
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    for (const child of Object.values(node)) {
      if (child && typeof child === "object") queue.push(child);
    }
  }
  return null;
}

// ─── since-hire: whose ideas are these? (c1-exam §3) ────────────────────────
//
// MEASURED 2026-08-30, on the first live tenure night: the overnight tick
// triaged and dispatched the project's 58 PRE-TENURE accepted ideas (~$8 of
// fleet sessions) and the summary reported that deck back as the holder's
// `proposals[]`. Grading it would have scored the operator's own backlog as the
// App master's judgment — the exact contamination §6 calls invalid, arriving
// through a door §6 did not name.
//
// So on a tenure run the three C1 checks read ONLY rows created at or after the
// tenure's `hiredAt`. Everything else is partitioned rather than dropped:
//
//   preTenure  the inherited deck — counted, reported, not graded
//   undated    a row with no parseable `createdAt`. NEITHER the holder's nor
//              discarded in silence: a Personas build that does not ship
//              createdAt must degrade to "cannot attribute", never to
//              "everything here is the holder's work".

/**
 * Split rows by the tenure's hire date. `rows` non-array (nobody reported a
 * list) stays `null` — an absent list is not an empty one. A `hiredAt` that is
 * missing or unparseable disables the split rather than guessing an epoch.
 */
export function partitionByHire(rows, hiredAt) {
  if (!Array.isArray(rows)) return { rows: null, preTenure: 0, undated: 0, applied: false };
  const boundary = typeof hiredAt === "string" ? Date.parse(hiredAt) : NaN;
  if (!Number.isFinite(boundary)) return { rows, preTenure: 0, undated: 0, applied: false };
  const kept = [];
  let preTenure = 0;
  let undated = 0;
  for (const row of rows) {
    const raw = row && typeof row === "object" && !Array.isArray(row) ? row.createdAt : null;
    const at = typeof raw === "string" ? Date.parse(raw) : NaN;
    if (!Number.isFinite(at)) undated += 1;
    else if (at < boundary) preTenure += 1;
    else kept.push(row);
  }
  return { rows: kept, preTenure, undated, applied: true };
}

/**
 * Whether this run's C1 checks filter by hire date, and on what boundary.
 *
 * The driver writes `result.sinceHire` (it is the half that knows about
 * `--no-since-hire`); a hand-built record without one derives the default —
 * ON for a tenure run that carries a `hiredAt`, OFF otherwise, because on a
 * FRESH hire every row on the wire is by construction this run's own.
 */
export function sinceHirePlan(result) {
  const explicit = result?.sinceHire;
  if (explicit && typeof explicit === "object" && !Array.isArray(explicit)) {
    const hiredAt = typeof explicit.hiredAt === "string" ? explicit.hiredAt : null;
    return {
      enabled: explicit.enabled === true && !!hiredAt,
      hiredAt,
      reason: typeof explicit.reason === "string" ? explicit.reason : null,
    };
  }
  const hiredAt = typeof result?.tenure?.hiredAt === "string" ? result.tenure.hiredAt : null;
  return {
    enabled: !!hiredAt,
    hiredAt,
    reason: hiredAt ? null : "not a tenure run — every row on the wire is this run's own hire",
  };
}

/** The sentence a filtered check appends to its `note`: what was excluded, and
 *  why that is a reading rather than a loss. `null` when nothing was. */
export function sinceHireNote(plan, { preTenure = 0, undated = 0, noun = "row" } = {}) {
  const parts = [];
  if (plan?.enabled && preTenure > 0) {
    parts.push(
      `since-hire: ${preTenure} ${noun}(s) created before the tenure's hiredAt (${plan.hiredAt}) were EXCLUDED — that is the operator's inherited deck, not the holder's work`
    );
  }
  if (undated > 0) {
    parts.push(
      `${undated} ${noun}(s) carried no createdAt and could not be attributed to the holder — excluded, and unmeasured rather than counted either way`
    );
  }
  // A filter that is OFF says so only where it COULD have applied — a tenure
  // whose rows are being graded whole. On a fresh hire there is nothing to
  // disclose: every row is this run's own by construction, and a note on every
  // C1 check saying so is noise, not disclosure.
  if (!plan?.enabled && plan?.hiredAt && plan?.reason) parts.push(plan.reason);
  return parts.length > 0 ? parts.join("; ") : null;
}

/**
 * One NIGHT's two lists. The driver stores what it extracted under `night.c1`;
 * a record that predates that (or a hand-built one) is deep-scanned from the
 * tick summary instead. Absent stays `null` on both sides.
 *
 * With a `plan` from `sinceHirePlan()`, the lists come back NARROWED to the
 * holder's own tenure, and what was taken out is counted rather than lost:
 * `preTenure` / `undated` are the totals across both lists (what the night's
 * `c1` record carries) and `byList` is the per-list split each check quotes.
 */
export function nightLists(night, plan = null) {
  const stored = night?.c1;
  const source =
    stored && (Array.isArray(stored.proposals) || Array.isArray(stored.declines))
      ? stored
      : extractNightLists(night?.tick ?? null);
  const raw = {
    proposals: Array.isArray(source.proposals) ? source.proposals : null,
    declines: Array.isArray(source.declines) ? source.declines : null,
  };
  const on = plan?.enabled === true && typeof plan.hiredAt === "string";
  const proposals = on ? partitionByHire(raw.proposals, plan.hiredAt) : null;
  const declines = on ? partitionByHire(raw.declines, plan.hiredAt) : null;
  return {
    proposals: proposals ? proposals.rows : raw.proposals,
    declines: declines ? declines.rows : raw.declines,
    preTenure: (proposals?.preTenure ?? 0) + (declines?.preTenure ?? 0),
    undated: (proposals?.undated ?? 0) + (declines?.undated ?? 0),
    filtered: on,
    byList: {
      proposals: { preTenure: proposals?.preTenure ?? 0, undated: proposals?.undated ?? 0 },
      declines: { preTenure: declines?.preTenure ?? 0, undated: declines?.undated ?? 0 },
    },
  };
}

/** Title identity for overlap and contamination: case, punctuation and the
 *  bench's own `[bench <stamp>]` suffix are not part of what a title IS. */
export function normalizeTitle(value) {
  return String(value ?? "")
    .replace(/\[bench [^\]]*\]/gi, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const titleOf = (row) => (typeof row === "string" ? row : (row?.title ?? row?.name ?? null));

/** A decline's reason as one of the four slugs, or `null` when it carried none
 *  the closed set recognises. A wrong reason and a missing one are different
 *  findings, so the raw text rides along. */
export function declineReason(decline) {
  const raw = typeof decline === "string" ? decline : (decline?.reason ?? decline?.why ?? null);
  if (typeof raw !== "string" || !raw.trim()) return { reason: null, raw: raw ?? null };
  const slug = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return { reason: DECLINE_ALIASES[slug] ?? null, raw: raw.trim() };
}

/** Does this proposal name the journey it moves and the axis it moves it on? */
export function proposalLiteracy(proposal) {
  const journey = proposal?.journey ?? proposal?.target?.journey ?? null;
  const rawAxis = proposal?.axis ?? proposal?.value?.axis ?? null;
  const axis = typeof rawAxis === "string" ? rawAxis.trim().toLowerCase() : null;
  return {
    journey: typeof journey === "string" && journey.trim() ? journey.trim() : null,
    axis: axis && VALUE_AXES.includes(axis) ? axis : null,
  };
}

/** Rank rows (the holder's proposals, or the operator's backlog) by their
 *  PRE-SCORED value, keeping the given order where nothing is scored — a list
 *  nobody scored is still a list somebody ordered. */
function rankedTitles(rows, topK) {
  return (rows ?? [])
    .map((row, index) => ({ index, title: titleOf(row), value: typeof row?.value === "number" ? row.value : null }))
    .filter((row) => typeof row.title === "string" && row.title.trim())
    .sort((a, b) => (b.value ?? Number.NEGATIVE_INFINITY) - (a.value ?? Number.NEGATIVE_INFINITY) || a.index - b.index)
    .slice(0, topK)
    .map((row) => row.title);
}

/**
 * ONE night's rank reading against the operator's backlog.
 *
 * Deterministic where it can be (§3): the overlap is a normalised-title match
 * between the holder's top-k and the operator's top-k. The human half — "was
 * this decline's reason TRUE" — is the 10-minute spot-check the protocol keeps
 * for a person, and this module does not pretend to do it.
 */
export function rankNight(proposals, backlog, { topK = 5 } = {}) {
  const holder = rankedTitles(proposals, topK);
  const operator = rankedTitles(backlog, topK);
  const operatorTop = new Set(operator.map(normalizeTitle));
  const everyBacklogTitle = new Set((backlog ?? []).map((row) => normalizeTitle(titleOf(row))).filter(Boolean));
  const hits = holder.filter((title) => operatorTop.has(normalizeTitle(title)));
  // Contamination is measured against the WHOLE backlog, not its top-5: a list
  // that echoes five middling backlog rows is just as much a read-back as one
  // that echoes the top.
  const verbatim = (proposals ?? [])
    .map((row) => titleOf(row))
    .filter((title) => typeof title === "string" && everyBacklogTitle.has(normalizeTitle(title)));
  const contaminated = verbatim.length >= CONTAMINATION_MATCHES;
  return { holderTop: holder, operatorTop: operator, hits: contaminated ? [] : hits, verbatim, contaminated };
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
// survive only in the reason string the scorer writes.
//
// THREE pins make parsing that string a checked read rather than prose mining,
// and the third is the one that protects THIS file:
//
//   1. `backbone.ts` and `pipeline/jobfit/appmaster.py` write the string
//      character-for-character, fixture-tested against each other.
//   2. A reason that does NOT match leaves the field ABSENT — never a zero.
//   3. `expectations.test.mjs` drives the REAL `backboneScore` (imported from
//      `app/_lib/app-master/backbone.ts`) through the regexes below, so a
//      copy-edit to a `reason:` fails in the run that makes it. Until it did,
//      such an edit turned a delivered night into "unmeasured" in silence and
//      the bench kept reporting under its own "unmeasured is not zero" rule.
//
// Every regex here therefore has an arm exercised from the producer; if you add
// one, add its producer-driven case beside the others.

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

/** Append a sentence to the note of the check just pushed. Written this way so
 *  a check's own note expression stays exactly what it was — the since-hire
 *  disclosure is an addition to a reading, never a rewrite of one. */
function noteOn(checks, extra) {
  const row = checks.at(-1);
  if (!row || !extra) return;
  row.note = row.note ? `${row.note} · ${extra}` : extra;
}

/**
 * Evaluate `scenario.expect` against a run record.
 * Returns `{ ok, checks }` — `ok` false when ANY check failed.
 */
export function evaluateExpectations(scenario, result) {
  const expect = scenario?.expect ?? {};
  const nights = result?.nights ?? [];
  const checks = [];

  // ALWAYS-ON, not an expect key: a night whose tick itself failed has no
  // instrument, and a scenario must never PASS over a dead one. Measured
  // 2026-08-31: an ideate tick died at undici's 300s headers timeout, every C1
  // check honestly read null, nothing failed, and the banner said PASS — the
  // one arrangement worse than a red run, because the ledger records a clean
  // night nobody measured.
  const deadTicks = nights.filter((n) => n?.tickOk === false);
  if (deadTicks.length > 0) {
    checks.push({
      name: "nightIntegrity",
      ok: false,
      expected: "every night's tick answers",
      actual: `${deadTicks.length} night(s) with a failed tick`,
      delta: deadTicks
        .map((n) => `night ${n.night}: the overnight tick failed (${n.tickError ?? n.error ?? "no error recorded"}) — nothing that night claims was measured`)
        .join("; "),
    });
  }

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

  // ── C1: value judgment (c1-exam §3) ───────────────────────────────────────
  //
  // The three readings the exam grades. All three share one rule: a night whose
  // tick summary carries no list reads `null`, SAYS so, and does not fail —
  // Personas does not carry these lists yet, and an expectation that failed on
  // a missing dependency would be switched off before the dependency landed.
  //
  // And all three read only the HOLDER's rows: on a tenure run everything the
  // deck held before `hiredAt` is the operator's, and grading it would score the
  // backlog as the App master's judgment (see `sinceHirePlan` above).
  const sinceHire = sinceHirePlan(result);

  if (expect.rankVsBacklog !== undefined && expect.rankVsBacklog !== false) {
    const config = typeof expect.rankVsBacklog === "object" ? expect.rankVsBacklog : { minHits: Number(expect.rankVsBacklog) };
    const topK = Number.isFinite(config.topK) ? config.topK : 5;
    const minHits = Number.isFinite(config.minHits) ? config.minHits : 1;
    const backlog = result?.backlog?.items ?? null;
    const readings = [];
    let preTenure = 0;
    let undated = 0;
    for (const night of nights) {
      const { proposals, byList } = nightLists(night, sinceHire);
      preTenure += byList.proposals.preTenure;
      undated += byList.proposals.undated;
      if (!proposals) continue;
      // A night whose WHOLE list was excluded read no ranking at all — scoring
      // it zero would turn "none of this is attributable to the holder" into
      // "the holder ranked badly", which is the unmeasured-is-not-zero rule in
      // the one place it costs a FAIL.
      if (proposals.length === 0 && byList.proposals.preTenure + byList.proposals.undated > 0) continue;
      readings.push({ night: night.night, ...rankNight(proposals, backlog ?? [], { topK }) });
    }
    const contaminated = readings.filter((r) => r.contaminated);
    const best = readings.length === 0 ? null : Math.max(...readings.map((r) => r.hits.length));
    const unmeasured = !backlog || backlog.length === 0 || readings.length === 0;
    // `null` PASSES, and is flagged: the operator's backlog is supplied by the
    // caller (--backlog) and the proposal list by a Personas build that does
    // not ship it yet. Neither absence is the holder's failing.
    const ok = unmeasured || best >= minHits;
    const hitTitles = readings.flatMap((r) => r.hits);
    checks.push(
      check(
        "rankVsBacklog",
        ok,
        `>= ${minHits} of the holder's top-${topK} in the operator's top-${topK}`,
        unmeasured ? null : best,
        !backlog || backlog.length === 0
          ? "no operator backlog was supplied (--backlog <file> takes pre-scored {title, value} rows), so nothing could be compared"
          : readings.length === 0
            ? "no night carried a proposal list — today's tick summary does not ship one (c1-exam §7, the Personas-side dependency)"
            : best >= minHits
              ? `the best night put ${best} proposal(s) in the operator's top-${topK}: ${hitTitles.join(" · ")}`
              : `no night's top-${topK} overlapped the operator's top-${topK} across ${readings.length} night(s)`,
        contaminated.length > 0
          ? `CONTAMINATED — night(s) ${contaminated.map((r) => r.night).join(", ")} repeated ${contaminated
              .map((r) => r.verbatim.length)
              .join("/")} backlog titles verbatim (>= ${CONTAMINATION_MATCHES}); that is the backlog read back, not a ranking, and those nights count no hits (c1-exam §6)`
          : unmeasured
            ? "unmeasured — an absent proposal list or backlog is not a zero overlap"
            : null
      )
    );
    noteOn(checks, sinceHireNote(sinceHire, { preTenure, undated, noun: "proposal" }));
  }

  if (expect.declineQuality !== undefined && expect.declineQuality !== false) {
    const minShare = typeof expect.declineQuality === "number" ? expect.declineQuality : 1;
    const declines = [];
    let preTenure = 0;
    let undated = 0;
    for (const night of nights) {
      const { declines: list, byList } = nightLists(night, sinceHire);
      preTenure += byList.declines.preTenure;
      undated += byList.declines.undated;
      if (list) for (const row of list) declines.push({ night: night.night, ...declineReason(row) });
    }
    const withReason = declines.filter((d) => d.reason !== null);
    const share = declines.length === 0 ? null : Number((withReason.length / declines.length).toFixed(4));
    const bad = declines.filter((d) => d.reason === null);
    const ok = share === null || share >= minShare;
    checks.push(
      check(
        "declineQuality",
        ok,
        `${Math.round(minShare * 100)}% of declines carry a reason from: ${DECLINE_REASONS.join(" | ")}`,
        share,
        share === null
          ? "no night carried a decline log — what the holder considered and did not propose is unrecorded"
          : `${withReason.length} of ${declines.length} decline(s) carry a reason from the closed set${
              bad.length > 0 ? ` — unrecognised: ${bad.map((d) => JSON.stringify(d.raw)).join(", ")}` : ""
            }`,
        share === null
          ? "unmeasured — an absent decline log is not a clean one"
          : "the deterministic half only: whether each reason is TRUE is the operator's 3-per-night spot-check (c1-exam §3)"
      )
    );
    noteOn(checks, sinceHireNote(sinceHire, { preTenure, undated, noun: "decline" }));
  }

  if (expect.valueLiteracy !== undefined && expect.valueLiteracy !== false) {
    const minShare = typeof expect.valueLiteracy === "number" ? expect.valueLiteracy : 0.8;
    const proposals = [];
    let preTenure = 0;
    let undated = 0;
    for (const night of nights) {
      const { proposals: list, byList } = nightLists(night, sinceHire);
      preTenure += byList.proposals.preTenure;
      undated += byList.proposals.undated;
      if (list) for (const row of list) proposals.push({ night: night.night, row, ...proposalLiteracy(row) });
    }
    const literate = proposals.filter((p) => p.journey && p.axis);
    const share = proposals.length === 0 ? null : Number((literate.length / proposals.length).toFixed(4));
    const ok = share === null || share >= minShare;
    const missing = proposals
      .filter((p) => !p.journey || !p.axis)
      .map((p) => `${JSON.stringify(p.row?.title ?? "(untitled)")} names ${[p.journey ? null : "no journey", p.axis ? null : `no axis in ${VALUE_AXES.join("/")}`].filter(Boolean).join(" and ")}`);
    checks.push(
      check(
        "valueLiteracy",
        ok,
        `>= ${Math.round(minShare * 100)}% of proposals name a journey and an axis (${VALUE_AXES.join(" | ")})`,
        share,
        share === null
          ? "no night carried a proposal list, so nothing could be read for a value claim"
          : `${literate.length} of ${proposals.length} proposal(s) name both${missing.length > 0 ? ` — ${missing.slice(0, 5).join("; ")}` : ""}`,
        share === null
          ? "unmeasured — an absent proposal list is not an illiterate one"
          : null
      )
    );
    noteOn(checks, sinceHireNote(sinceHire, { preTenure, undated, noun: "proposal" }));
  }

  return { ok: checks.every((c) => c.ok), checks };
}
