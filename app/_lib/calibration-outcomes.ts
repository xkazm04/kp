// Score validation against what people decided (idea 5, BACKLOG "Matching & scoring" +
// "Pipeline & comms"). calibration.ts measures the match score against the ROW's current
// stage (a rewritten column); this module reads the APPEND-ONLY pipeline_events trail
// instead, so every outcome has an event time and an author, and it answers three
// questions the curve cannot:
//   1. Outcome ladder: the furthest stage each scored candidate reached, and WHO moved
//      them there. Only a person's decision is ground truth: an automated advance is
//      what the score/model did, not evidence that it was right.
//   2. Score vs outcome: per score band, how many a PERSON took to each stage (Wilson
//      interval), and a rank measure (AUC) per score — match, potential, and potential's
//      four components, so the 35/25/25/15 weighting can be read term by term.
//   3. Auto-advance band audit: of candidates advanced automatically at screening
//      confidence >= 80, how many did a person later reject or move back, versus the
//      band just below (70-79, which never auto-advances and reached a person instead).
// Pure and import-free so node:test loads it without the @/ graph. It NEVER changes a
// threshold or a weight: a "would support" line is display-only, above the floor only.

/** Minimum decided candidates in a cell before a RATE is shown. One observation in 8
 *  moves a rate by 12.5 points, the coarsest step a reader would still act on; it is
 *  also calibration.ts's MIN_CALIBRATION_BAND_OUTCOMES, so the bar to show a band rate
 *  is the bar the existing floor recommendation already uses to move a threshold. */
export const OUTCOME_RATE_FLOOR = 8;

/** Minimum candidates in EACH class (reached / did not) before an AUC is shown. A rank
 *  measure compares two groups, so the floor is per arm, never on the total: with 3
 *  positives one candidate swings AUC by a third. */
export const OUTCOME_RANK_FLOOR = 8;

/** The screening confidence at or above which a model "advance" moves a candidate
 *  unattended: pipeline/jobfit/automation.py POLICY["screen_advance_conf"]. Pinned by
 *  calibration-outcomes.test.ts reading that file, so the two cannot drift silently. */
export const AUTO_ADVANCE_CONFIDENCE = 80;
/** Width of the comparison band just below the bar (70-79). */
export const AUTO_ADVANCE_BELOW_WIDTH = 10;

/** Score bands on the 0-100 scale, [lo, hi) with the top band closed at 100. Five, not
 *  ten: at the rate floor a ten-band table needs 80 decided candidates per stage before
 *  a single row can show anything. */
export const OUTCOME_BANDS: readonly { lo: number; hi: number }[] = [
  { lo: 0, hi: 20 },
  { lo: 20, hi: 40 },
  { lo: 40, hi: 60 },
  { lo: 60, hi: 80 },
  { lo: 80, hi: 100 },
];

export const OUTCOME_SCORE_KEYS = [
  "match",
  "potential",
  "potentialDepth",
  "potentialVelocity",
  "potentialFoundation",
  "potentialInitiative",
] as const;
export type OutcomeScoreKey = (typeof OUTCOME_SCORE_KEYS)[number];

/** Where an entry's evidence came from. Only `live` rows are evidence. */
export type EvidenceProvenance = "live" | "seeded" | "simulation";
export type DecisionAuthor = "human" | "automation" | "other";

export type OutcomeEvent = {
  entryId: string;
  kind: string;
  fromStage: string | null;
  toStage: string | null;
  actor: string | null;
  at: string;
};

export type OutcomeEntry = {
  entryId: string;
  /** All scores on a 0-100 scale; null = this score was not recorded for the entry. */
  scores: Partial<Record<OutcomeScoreKey, number | null>>;
};

/** The screening confidence an advance acted on: an automated advance's own event
 *  (pipeline_events.inputs_json screeningConfidence, recorded since owner ruling 6) or the
 *  card a person advanced from (decision_records inputs.aiConfidence). */
export type AdvanceConfidence = { entryId: string; kind: string; confidence: number; at: string };

export type OutcomeAxis = {
  stages: readonly string[]; // ordered stage ids of the workspace's board
  advanceIndex: number; // first stage past the screen gate
  terminalIndex: number; // the hire stage
};

// The kinds a RECRUITER writes when they move or close a candidate (DECISION_META
// auto:false), and their automated twins (auto:true). Pinned against DECISION_META by
// the test. `scheduled` (the candidate's own slot pick) and comms kinds are not decisions.
const HUMAN_FORWARD = new Set(["advanced", "moved"]);
const AUTO_FORWARD = new Set(["auto_advanced"]);
const HUMAN_REJECT = new Set(["rejected"]);
const AUTO_REJECT = new Set(["auto_rejected"]);
/** The demo seeder (core.ts seedPipeline) is the only writer of `matched`. */
export const SEED_SIGNATURE_KIND = "matched";
/** The guided simulation's actor (pipeline-entry-action.ts `auto:sim`). */
const SIM_ACTOR_PREFIX = "auto:sim";

/** Who made a stage decision. The actor column wins when it names a class; a null
 *  actor (legacy rows) falls back to the kind, which the writers already split by
 *  author (actOnPipelineEntry: actor "system" writes the auto_* kind). */
export function decisionAuthor(e: Pick<OutcomeEvent, "kind" | "actor">): DecisionAuthor {
  const decision = HUMAN_FORWARD.has(e.kind) || AUTO_FORWARD.has(e.kind) || HUMAN_REJECT.has(e.kind) || AUTO_REJECT.has(e.kind) || e.kind === "reinstated";
  if (!decision) return "other";
  if (e.actor?.startsWith("auto:")) return "automation";
  if (e.actor?.startsWith("human:")) return "human";
  return AUTO_FORWARD.has(e.kind) || AUTO_REJECT.has(e.kind) ? "automation" : "human";
}

export type LadderRow = {
  entryId: string;
  provenance: EvidenceProvenance;
  /** Furthest stage index a PERSON took them to (-1 = none). A hire counts when the
   *  candidate accepted an offer: the accept is the candidate's act, not automation's. */
  humanFurthest: number;
  /** Furthest stage index reached by any route, automation included. */
  anyFurthest: number;
  /** A person's reject stands (not reinstated afterwards). */
  humanRejected: boolean;
  automatedAdvances: number;
  automatedRejects: number;
  /** Automated advances a person later rejected or moved back. */
  overturnedAutoAdvances: number;
};

function ms(at: string): number {
  const t = Date.parse(at);
  return Number.isFinite(t) ? t : 0;
}

/** Furthest stage, human decisions and automated actions per entry, from the trail. */
export function buildOutcomeLadder(events: readonly OutcomeEvent[], axis: OutcomeAxis): Map<string, LadderRow> {
  const idx = (s: string | null) => (s == null ? -1 : axis.stages.indexOf(s));
  const byEntry = new Map<string, OutcomeEvent[]>();
  for (const e of events) {
    const list = byEntry.get(e.entryId) ?? [];
    list.push(e);
    byEntry.set(e.entryId, list);
  }
  const out = new Map<string, LadderRow>();
  for (const [entryId, raw] of byEntry) {
    // Stable sort: equal timestamps keep the store's insertion (id) order.
    const list = [...raw].sort((a, b) => ms(a.at) - ms(b.at));
    const row: LadderRow = {
      entryId,
      provenance: "live",
      humanFurthest: -1,
      anyFurthest: -1,
      humanRejected: false,
      automatedAdvances: 0,
      automatedRejects: 0,
      overturnedAutoAdvances: 0,
    };
    let pendingAuto = 0; // automated advances not yet overturned
    for (const e of list) {
      if (e.kind === SEED_SIGNATURE_KIND) row.provenance = "seeded";
      else if (row.provenance === "live" && e.actor?.startsWith(SIM_ACTOR_PREFIX)) row.provenance = "simulation";
      const from = idx(e.fromStage);
      const to = idx(e.toStage);
      row.anyFurthest = Math.max(row.anyFurthest, from, to);
      if (e.kind === "offer_accepted") row.humanFurthest = Math.max(row.humanFurthest, axis.terminalIndex);
      const author = decisionAuthor(e);
      if (author === "other") continue;
      if (HUMAN_FORWARD.has(e.kind) || AUTO_FORWARD.has(e.kind)) {
        const backward = from >= 0 && to >= 0 && to < from;
        if (author === "human") {
          if (backward) {
            row.overturnedAutoAdvances += pendingAuto;
            pendingAuto = 0;
          } else row.humanFurthest = Math.max(row.humanFurthest, to);
        } else {
          row.automatedAdvances += 1;
          pendingAuto += 1;
        }
      } else if (HUMAN_REJECT.has(e.kind) || AUTO_REJECT.has(e.kind)) {
        if (author === "human") {
          row.humanRejected = true;
          row.overturnedAutoAdvances += pendingAuto;
          pendingAuto = 0;
        } else row.automatedRejects += 1;
      } else if (e.kind === "reinstated" && author === "human") {
        row.humanRejected = false;
      }
    }
    out.set(entryId, row);
  }
  return out;
}

// ─── Interval and rank maths ──────────────────────────────────────────────────

/** Wilson score interval (95%) for k of n. null on n = 0. */
export function wilsonInterval(k: number, n: number, z = 1.96): { lo: number; hi: number } | null {
  if (!(n > 0) || k < 0 || k > n) return null;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/** AUC (Mann-Whitney, mid-rank ties): the chance a random positive outscores a random
 *  negative. null when either class is empty. */
export function rankAuc(pairs: readonly { score: number; positive: boolean }[]): number | null {
  const pos = pairs.filter((p) => p.positive).length;
  const neg = pairs.length - pos;
  if (pos === 0 || neg === 0) return null;
  const sorted = [...pairs].sort((a, b) => a.score - b.score);
  let rankSumPos = 0;
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].score === sorted[i].score) j += 1;
    const midRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) if (sorted[k].positive) rankSumPos += midRank;
    i = j + 1;
  }
  return (rankSumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

/** One rate cell. `measured` = n at or above the floor (rate + interval present);
 *  `thin` = some observations, counts only; `empty` = none. Never a rate below the floor. */
export type RateCell = {
  n: number;
  k: number;
  state: "measured" | "thin" | "empty";
  rate: number | null;
  lo: number | null;
  hi: number | null;
  floor: number;
};

export function rateCell(k: number, n: number, floor = OUTCOME_RATE_FLOOR): RateCell {
  if (n === 0) return { n, k, state: "empty", rate: null, lo: null, hi: null, floor };
  if (n < floor) return { n, k, state: "thin", rate: null, lo: null, hi: null, floor };
  const ci = wilsonInterval(k, n)!;
  return { n, k, state: "measured", rate: k / n, lo: ci.lo, hi: ci.hi, floor };
}

// ─── The report ───────────────────────────────────────────────────────────────

export type BandRow = {
  lo: number;
  hi: number;
  /** Per target stage (index into axis.stages, from advanceIndex - 1 … terminal). */
  cells: { stage: string; cell: RateCell }[];
  /** Candidates in the band moved only by automation: never counted as evidence. */
  automationOnly: number;
};

export type RankRow = {
  key: OutcomeScoreKey;
  /** Live entries carrying this score at all. 0 = no producer records it. */
  recorded: number;
  target: "advance" | "hired";
  positives: number;
  negatives: number;
  state: "measured" | "thin" | "not-recorded";
  auc: number | null;
  floor: number;
};

export type BandAudit = {
  bar: number;
  /** Live automated advances in the trail, how many recorded the confidence they acted
   *  on, and how many did not (made before it was recorded: left out, never imputed). */
  automatedAdvances: number;
  withConfidence: number;
  notRecorded: number;
  above: RateCell; // auto-advanced at >= bar: k = later overturned by a person
  below: RateCell; // person-advanced at bar-10 … bar-1: k = later overturned by a person
  /** Display-only: set only when BOTH cells are measured and the above-bar overturn
   *  interval sits entirely above the below-bar one. Nothing applies it. */
  support: "raise-bar" | null;
};

export type ScoreOutcomeReport = {
  stages: string[];
  advanceStage: string | null;
  terminalStage: string | null;
  population: { scored: number; live: number; seeded: number; simulation: number; untracked: number };
  /** Live scored candidates by who made their decisive move. */
  ladder: { decidedByPerson: number; automationOnly: number; undecided: number; humanRejected: number };
  bands: BandRow[];
  rank: RankRow[];
  audit: BandAudit;
  floors: { rate: number; rank: number };
};

function inBand(score: number, lo: number, hi: number): boolean {
  return score >= lo && (hi >= 100 ? score <= 100 : score < hi);
}

/** Is the outcome for target stage S known from a PERSON? true = reached, false = a
 *  person rejected them before S, null = not known (in flight or automation only). */
export function humanLabel(row: LadderRow, target: number): boolean | null {
  if (row.humanFurthest >= target) return true;
  if (row.humanRejected) return false;
  return null;
}

export function computeScoreOutcomes(
  entries: readonly OutcomeEntry[],
  events: readonly OutcomeEvent[],
  confidences: readonly AdvanceConfidence[],
  axis: OutcomeAxis
): ScoreOutcomeReport {
  const ladder = buildOutcomeLadder(events, axis);
  const population = { scored: 0, live: 0, seeded: 0, simulation: 0, untracked: 0 };
  const live: { entry: OutcomeEntry; row: LadderRow }[] = [];
  for (const entry of entries) {
    if (entry.scores.match == null || !Number.isFinite(entry.scores.match)) continue;
    population.scored += 1;
    const row = ladder.get(entry.entryId);
    if (!row) {
      population.untracked += 1; // no trail at all: no decision can be read for it
      continue;
    }
    population[row.provenance] += 1;
    if (row.provenance === "live") live.push({ entry, row });
  }

  const summary = { decidedByPerson: 0, automationOnly: 0, undecided: 0, humanRejected: 0 };
  for (const { row } of live) {
    if (row.humanFurthest >= 0 || row.humanRejected) summary.decidedByPerson += 1;
    else if (row.automatedAdvances + row.automatedRejects > 0) summary.automationOnly += 1;
    else summary.undecided += 1;
    if (row.humanRejected) summary.humanRejected += 1;
  }

  const firstTarget = Math.max(1, axis.advanceIndex - 1);
  const targets: number[] = [];
  for (let s = firstTarget; s <= axis.terminalIndex && s < axis.stages.length; s += 1) targets.push(s);

  const bands: BandRow[] = OUTCOME_BANDS.map(({ lo, hi }) => {
    const members = live.filter(({ entry }) => inBand(entry.scores.match as number, lo, hi));
    return {
      lo,
      hi,
      cells: targets.map((s) => {
        let n = 0;
        let k = 0;
        for (const { row } of members) {
          const label = humanLabel(row, s);
          if (label == null) continue;
          n += 1;
          if (label) k += 1;
        }
        return { stage: axis.stages[s], cell: rateCell(k, n) };
      }),
      automationOnly: members.filter(
        ({ row }) => row.humanFurthest < 0 && !row.humanRejected && row.automatedAdvances + row.automatedRejects > 0
      ).length,
    };
  });

  const rank: RankRow[] = [];
  const rankTargets: { target: "advance" | "hired"; index: number }[] = [
    { target: "advance", index: axis.advanceIndex },
    { target: "hired", index: axis.terminalIndex },
  ];
  for (const key of OUTCOME_SCORE_KEYS) {
    const withScore = live.filter(({ entry }) => {
      const v = entry.scores[key];
      return v != null && Number.isFinite(v);
    });
    for (const { target, index } of rankTargets) {
      const pairs: { score: number; positive: boolean }[] = [];
      for (const { entry, row } of withScore) {
        const label = humanLabel(row, index);
        if (label != null) pairs.push({ score: entry.scores[key] as number, positive: label });
      }
      const positives = pairs.filter((p) => p.positive).length;
      const negatives = pairs.length - positives;
      const measured = positives >= OUTCOME_RANK_FLOOR && negatives >= OUTCOME_RANK_FLOOR;
      rank.push({
        key,
        recorded: withScore.length,
        target,
        positives,
        negatives,
        state: withScore.length === 0 ? "not-recorded" : measured ? "measured" : "thin",
        auc: measured ? rankAuc(pairs) : null,
        floor: OUTCOME_RANK_FLOOR,
      });
    }
  }

  // Band audit: an advance sealed with a confidence, then did a PERSON later undo it?
  const liveIds = new Set(live.map(({ entry }) => entry.entryId));
  const eventsByEntry = new Map<string, OutcomeEvent[]>();
  for (const e of events) {
    if (!liveIds.has(e.entryId)) continue;
    const list = eventsByEntry.get(e.entryId) ?? [];
    list.push(e);
    eventsByEntry.set(e.entryId, list);
  }
  const stageIdx = (s: string | null) => (s == null ? -1 : axis.stages.indexOf(s));
  const overturnedAfter = (entryId: string, at: string): boolean =>
    (eventsByEntry.get(entryId) ?? []).some((e) => {
      if (ms(e.at) <= ms(at) || decisionAuthor(e) !== "human") return false;
      if (HUMAN_REJECT.has(e.kind)) return true;
      const from = stageIdx(e.fromStage);
      const to = stageIdx(e.toStage);
      return HUMAN_FORWARD.has(e.kind) && from >= 0 && to >= 0 && to < from;
    });
  let automatedAdvances = 0;
  for (const [, list] of eventsByEntry) {
    for (const e of list) {
      if ((AUTO_FORWARD.has(e.kind) || HUMAN_FORWARD.has(e.kind)) && decisionAuthor(e) === "automation") automatedAdvances += 1;
    }
  }
  let withConfidence = 0;
  const above = { n: 0, k: 0 };
  const below = { n: 0, k: 0 };
  for (const c of confidences) {
    if (!liveIds.has(c.entryId) || !Number.isFinite(c.confidence)) continue;
    const auto = AUTO_FORWARD.has(c.kind);
    if (auto) withConfidence += 1;
    const lower = AUTO_ADVANCE_CONFIDENCE - AUTO_ADVANCE_BELOW_WIDTH;
    const cell = auto && c.confidence >= AUTO_ADVANCE_CONFIDENCE ? above : !auto && c.confidence >= lower && c.confidence < AUTO_ADVANCE_CONFIDENCE ? below : null;
    if (!cell) continue;
    cell.n += 1;
    if (overturnedAfter(c.entryId, c.at)) cell.k += 1;
  }
  const aboveCell = rateCell(above.k, above.n);
  const belowCell = rateCell(below.k, below.n);
  const support =
    aboveCell.state === "measured" && belowCell.state === "measured" && (aboveCell.lo as number) > (belowCell.hi as number)
      ? "raise-bar"
      : null;

  const advanceStage = axis.stages[axis.advanceIndex] ?? null;
  const terminalStage = axis.stages[axis.terminalIndex] ?? null;
  return {
    stages: targets.map((s) => axis.stages[s]),
    advanceStage,
    terminalStage,
    population,
    ladder: summary,
    bands,
    rank,
    audit: {
      bar: AUTO_ADVANCE_CONFIDENCE,
      automatedAdvances,
      withConfidence,
      notRecorded: Math.max(0, automatedAdvances - withConfidence),
      above: aboveCell,
      below: belowCell,
      support,
    },
    floors: { rate: OUTCOME_RATE_FLOOR, rank: OUTCOME_RANK_FLOOR },
  };
}
