// The interview simulator's BRIEF-CHANGE DIFF (challenge-r03 interview-simulator/B):
// compare a new verdict run against an earlier one, cell by cell, and say what the change
// did. A cell is one situation × one invariant; each side of it is a rate (k fail / n
// evaluable) over that side's samples of the situation.
//
// The question a validation run answers after a brief or director edit is not "did the new
// version pass" but "did anything that used to pass now fail" (registry:
// conversational-assessment-validation → prompt-change-regression-baseline). Every cell
// lands in exactly one class:
//
//   nonlocal_regression   worse, in a cell the change did not target — what this exists
//                         for; BLOCKING on the reliability axis
//   targeted_regression   worse, in a cell the change DID target (the fix made its own
//                         target worse) — also blocking on reliability
//   intended_improvement  better, in a targeted cell
//   nonlocal_improvement  better, untargeted — reported with suspicion: it is often the
//                         instrument turning more conservative, which fails elsewhere
//   noise                 a flip consistent with the run-to-run spread: the baseline cell
//                         itself flipped across its own samples and the candidate's result
//                         is not improbable at that rate (one-sided binomial tail ≥
//                         NOISE_ALPHA), or both sides ran the SAME instrument (then every
//                         flip is spread by definition — "a spread measurement")
//   unchanged             the same rate on both sides
//   not_comparable        the cell cannot be compared, and says why: the cast changed or is
//                         unknown (situationSha), one side never evaluated it
//                         (not_provoked / not_evaluable), the judge rubric changed, or the
//                         situation ran on one side only. Counted in neither the
//                         regression nor the improvement totals.
//
// KEYLESS. The diff reads two verdicts.json files and nothing else: no model, no judge, no
// database. A regression is a RESULT (the CLI still exits 0); `blocking` is the verdict a
// release reads.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { InvariantAxis, InvariantVerdict } from "./detectors";
import { conversationRef, transcriptRef } from "./record";
import { SIM_INVARIANTS, type SimInvariantId } from "./situations";

export const DIFF_CLASSES = ["nonlocal_regression", "targeted_regression", "intended_improvement", "nonlocal_improvement", "noise", "unchanged", "not_comparable"] as const;
export type DiffClass = (typeof DIFF_CLASSES)[number];

/** A flip whose one-sided binomial probability at the baseline's own fail rate is at least
 *  this is noise. Only a baseline cell that flipped across its own samples has a spread; a
 *  baseline that never flipped (or ran once) makes every flip real. */
export const NOISE_ALPHA = 0.05;

/** What the diff reads of one conversation — a subset of verdict-run's ConversationVerdicts,
 *  so a verdicts.json from any run is its input. */
export type DiffConversation = {
  runId: string;
  situationId: string;
  /** Absent/null on verdicts written before dumps recorded their cast: "cast unknown". */
  situationSha?: string | null;
  instrument: { briefSha: string; directorVersion: string };
  judge?: { rubricVersion: string } | null;
  verdicts: readonly InvariantVerdict[];
};

export type DiffRun = { conversations: readonly DiffConversation[]; dirs?: readonly string[] };

export type DiffSide = {
  /** Conversations of the situation on this side. */
  samples: number;
  pass: number;
  fail: number;
  notProvoked: number;
  notEvaluable: number;
  evaluable: number;
  /** transcript:<runId>/<situationId>[#seq] — the evidence turns where there are any. */
  refs: string[];
};

export type DiffCell = {
  situationId: string;
  invariant: SimInvariantId;
  axis: InvariantAxis;
  targeted: boolean;
  class: DiffClass;
  reason: string;
  baseline: DiffSide | null;
  candidate: DiffSide | null;
};

export type DiffReport = {
  version: 1;
  targets: string[];
  baselineDirs: string[];
  candidateDirs: string[];
  /** false = both sides ran the same instrument set: a spread measurement. */
  instrumentChanged: boolean;
  instruments: { baseline: string[]; candidate: string[] };
  castChanged: string[];
  castUnknown: string[];
  /** Any reliability regression (non-local or targeted) outside the baseline's spread. */
  blocking: boolean;
  headline: string[];
  totals: Record<DiffClass, number>;
  cells: DiffCell[];
};

export class BaselineError extends Error {}

// ---- the arithmetic ------------------------------------------------------------------------

function choose(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** P(X ≥ k) for X ~ Binomial(n, p). */
export function binomialUpperTail(n: number, k: number, p: number): number {
  let sum = 0;
  for (let i = k; i <= n; i++) sum += choose(n, i) * p ** i * (1 - p) ** (n - i);
  return Math.min(1, sum);
}

/** Is the candidate's result consistent with the baseline's own observed fail rate? */
export function withinSpread(baseline: Pick<DiffSide, "fail" | "evaluable">, candidate: Pick<DiffSide, "fail" | "evaluable">): { noise: boolean; p: number | null } {
  if (baseline.evaluable < 2 || baseline.fail === 0 || baseline.fail === baseline.evaluable) return { noise: false, p: null };
  const p = baseline.fail / baseline.evaluable;
  const worse = candidate.fail / candidate.evaluable > p;
  // Worse: P(at least this many fails). Better: P(at most this many) = P(at least this many passes).
  const tail = worse ? binomialUpperTail(candidate.evaluable, candidate.fail, p) : binomialUpperTail(candidate.evaluable, candidate.evaluable - candidate.fail, 1 - p);
  return { noise: tail >= NOISE_ALPHA, p: tail };
}

// ---- the diff ---------------------------------------------------------------------------------

const instrumentKey = (c: DiffConversation) => `${c.instrument.briefSha} / ${c.instrument.directorVersion}`;
const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((x) => b.has(x));

function bySituation(convs: readonly DiffConversation[]): Map<string, DiffConversation[]> {
  const m = new Map<string, DiffConversation[]>();
  for (const c of convs) m.set(c.situationId, [...(m.get(c.situationId) ?? []), c]);
  return m;
}

function sideOf(convs: readonly DiffConversation[], inv: SimInvariantId): DiffSide {
  const side: DiffSide = { samples: convs.length, pass: 0, fail: 0, notProvoked: 0, notEvaluable: 0, evaluable: 0, refs: [] };
  for (const c of convs) {
    const v = c.verdicts.find((x) => x.invariant === inv);
    if (!v) continue;
    if (v.state === "pass") side.pass += 1;
    else if (v.state === "fail") side.fail += 1;
    else if (v.state === "not_provoked") side.notProvoked += 1;
    else side.notEvaluable += 1;
    const seqs = [...new Set(v.evidence.map((e) => e.seq))];
    side.refs.push(...(seqs.length ? seqs.map((s) => transcriptRef(c.runId, c.situationId, s)) : [conversationRef(c.runId, c.situationId)]));
  }
  side.evaluable = side.pass + side.fail;
  side.refs = [...new Set(side.refs)];
  return side;
}

const statesOf = (s: DiffSide) =>
  [s.pass ? `pass ${s.pass}` : "", s.fail ? `fail ${s.fail}` : "", s.notProvoked ? `not_provoked ${s.notProvoked}` : "", s.notEvaluable ? `not_evaluable ${s.notEvaluable}` : ""].filter(Boolean).join(", ") || "no verdict";

const INVARIANT_ORDER = Object.keys(SIM_INVARIANTS) as SimInvariantId[];

/** Classify every situation × invariant cell of `candidate` against `baseline` (see the header). */
export function diffVerdicts(baseline: DiffRun, candidate: DiffRun, opts: { targets?: readonly string[] } = {}): DiffReport {
  const targets = [...new Set((opts.targets ?? []).map((t) => t.trim()).filter(Boolean))];
  const isTarget = (situationId: string, inv: string) => targets.includes(inv) || targets.includes(situationId);
  const b = bySituation(baseline.conversations);
  const c = bySituation(candidate.conversations);
  const bInstruments = new Set(baseline.conversations.map(instrumentKey));
  const cInstruments = new Set(candidate.conversations.map(instrumentKey));
  const instrumentChanged = !sameSet(bInstruments, cInstruments);

  const cells: DiffCell[] = [];
  const castChanged: string[] = [];
  const castUnknown: string[] = [];
  for (const situationId of [...new Set([...b.keys(), ...c.keys()])].sort()) {
    const bs = b.get(situationId) ?? [];
    const cs = c.get(situationId) ?? [];
    const present = new Set([...bs, ...cs].flatMap((x) => x.verdicts.map((v) => v.invariant)));
    const invariants = INVARIANT_ORDER.filter((i) => present.has(i));

    let whole: string | null = null;
    if (bs.length === 0) whole = "only in the candidate run";
    else if (cs.length === 0) whole = "only in the baseline run";
    else {
      const shas = [...bs, ...cs].map((x) => x.situationSha ?? null);
      if (shas.some((s) => s === null)) {
        whole = "cast unknown";
        castUnknown.push(situationId);
      } else if (!sameSet(new Set(bs.map((x) => x.situationSha as string)), new Set(cs.map((x) => x.situationSha as string))) || new Set(shas).size > 1) {
        whole = "cast changed";
        castChanged.push(situationId);
      }
    }
    const sameInstrument = sameSet(new Set(bs.map(instrumentKey)), new Set(cs.map(instrumentKey)));
    const rubricsB = new Set(bs.filter((x) => x.judge).map((x) => x.judge?.rubricVersion ?? ""));
    const rubricsC = new Set(cs.filter((x) => x.judge).map((x) => x.judge?.rubricVersion ?? ""));
    const rubricChanged = rubricsB.size > 0 && rubricsC.size > 0 && !sameSet(rubricsB, rubricsC);

    for (const inv of invariants) {
      const axis = SIM_INVARIANTS[inv].axis;
      const targeted = isTarget(situationId, inv);
      const bSide = bs.length ? sideOf(bs, inv) : null;
      const cSide = cs.length ? sideOf(cs, inv) : null;
      const cell = (cls: DiffClass, reason: string): DiffCell => ({ situationId, invariant: inv, axis, targeted, class: cls, reason, baseline: bSide, candidate: cSide });
      if (whole || !bSide || !cSide) {
        cells.push(cell("not_comparable", whole ?? "only on one side"));
        continue;
      }
      const judged = [...bs, ...cs].some((x) => x.verdicts.some((v) => v.invariant === inv && v.method === "judge"));
      if (judged && rubricChanged) {
        cells.push(cell("not_comparable", `judge rubric changed (${[...rubricsB].join(", ")} → ${[...rubricsC].join(", ")})`));
        continue;
      }
      if (bSide.evaluable === 0 || cSide.evaluable === 0) {
        const which = bSide.evaluable === 0 && cSide.evaluable === 0 ? "neither side" : bSide.evaluable === 0 ? "the baseline" : "the candidate";
        cells.push(cell("not_comparable", `${which} could not evaluate it — baseline ${statesOf(bSide)}; candidate ${statesOf(cSide)}`));
        continue;
      }
      const pb = bSide.fail / bSide.evaluable;
      const pc = cSide.fail / cSide.evaluable;
      if (pb === pc) {
        cells.push(cell("unchanged", `${bSide.fail}/${bSide.evaluable} → ${cSide.fail}/${cSide.evaluable}`));
        continue;
      }
      const worse = pc > pb;
      const moved = `${bSide.fail}/${bSide.evaluable} → ${cSide.fail}/${cSide.evaluable} fail`;
      if (sameInstrument) {
        cells.push(cell("noise", `${moved}; same instrument on both sides, so the flip is run-to-run spread`));
        continue;
      }
      const spread = withinSpread(bSide, cSide);
      if (spread.noise) {
        cells.push(cell("noise", `${moved}; inside the baseline's own spread (it flipped ${bSide.fail} of ${bSide.evaluable}; p = ${spread.p?.toFixed(2)})`));
        continue;
      }
      if (worse) cells.push(cell(targeted ? "targeted_regression" : "nonlocal_regression", moved));
      else cells.push(cell(targeted ? "intended_improvement" : "nonlocal_improvement", moved));
    }
  }

  const totals = Object.fromEntries(DIFF_CLASSES.map((k) => [k, cells.filter((x) => x.class === k).length])) as Record<DiffClass, number>;
  const relRegressions = cells.filter((x) => x.axis === "reliability" && (x.class === "nonlocal_regression" || x.class === "targeted_regression"));
  const blocking = relRegressions.length > 0;

  const headline: string[] = [];
  if (!instrumentChanged) headline.push("no instrument change: this is a spread measurement — both sides ran the same brief and director, so every flip is run-to-run spread and no cell can be an intended improvement or a regression.");
  else headline.push(`instrument changed: ${[...bInstruments].sort().join(", ")} → ${[...cInstruments].sort().join(", ")} (briefSha / directorVersion).`);
  headline.push(
    blocking
      ? `BLOCKING — ${relRegressions.length} reliability regression(s) outside the baseline's spread: ${relRegressions
          .slice(0, 6)
          .map((x) => `${x.invariant} in ${x.situationId}`)
          .join("; ")}${relRegressions.length > 6 ? "; …" : ""}.`
      : "Not blocking — no reliability cell got worse outside the baseline's spread.",
  );
  if (castChanged.length) headline.push(`cast changed in ${castChanged.length} situation(s): ${castChanged.join(", ")} — their cells are not comparable; re-baseline them deliberately.`);
  if (castUnknown.length) headline.push(`cast unknown in ${castUnknown.length} situation(s): ${castUnknown.join(", ")} — a side was verdicted from dumps that predate situationSha; re-run it to compare these.`);
  if (instrumentChanged && targets.length === 0) headline.push("no --targets: nothing was declared as the change's aim, so every improvement is classed non-local.");
  const compared = [...b.keys()].filter((id) => c.has(id));
  if (instrumentChanged && compared.length > 0 && compared.every((id) => (b.get(id)?.length ?? 0) < 2)) {
    headline.push("the baseline has one sample per situation: its run-to-run spread is unknown, so noise cannot be told from a regression — repeat the unchanged run before trusting a single flip.");
  }
  headline.push(DIFF_CLASSES.map((k) => `${k} ${totals[k]}`).join(" · "));

  return {
    version: 1,
    targets,
    baselineDirs: [...(baseline.dirs ?? [])],
    candidateDirs: [...(candidate.dirs ?? [])],
    instrumentChanged,
    instruments: { baseline: [...bInstruments].sort(), candidate: [...cInstruments].sort() },
    castChanged,
    castUnknown,
    blocking,
    headline,
    totals,
    cells,
  };
}

// ---- reading a baseline -------------------------------------------------------------------------

/** Read a baseline verdict run: `<dir>/verdicts.json`, or `<dir>/verdict/verdicts.json` when
 *  handed the simulator run directory, or the verdicts.json file itself. */
export function loadBaseline(dirOrFile: string): DiffRun & { file: string } {
  const candidates = dirOrFile.endsWith(".json") ? [dirOrFile] : [path.join(dirOrFile, "verdicts.json"), path.join(dirOrFile, "verdict", "verdicts.json")];
  const file = candidates.find((f) => existsSync(f));
  if (!file) throw new BaselineError(`--baseline ${dirOrFile}: no verdicts.json there (looked at ${candidates.join(", ")}) — point it at an earlier verdict run's output directory`);
  let parsed: { conversations?: unknown; dirs?: unknown };
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as typeof parsed;
  } catch (err) {
    throw new BaselineError(`--baseline ${file}: not readable JSON (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!Array.isArray(parsed.conversations)) throw new BaselineError(`--baseline ${file}: no conversations array — not a verdict run's verdicts.json`);
  return { file, conversations: parsed.conversations as DiffConversation[], dirs: Array.isArray(parsed.dirs) ? (parsed.dirs as string[]) : [] };
}

// ---- rendering -----------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/\|/g, "\\|");
const rateOf = (s: DiffSide | null) => (s === null ? "—" : s.evaluable === 0 ? `– (n=${s.samples})` : `${s.fail}/${s.evaluable} fail (n=${s.samples})`);

function section(title: string, note: string, cells: readonly DiffCell[]): string[] {
  const lines = [`## ${title}`, "", note, ""];
  if (cells.length === 0) return [...lines, "None.", ""];
  lines.push("| Situation | Invariant | Axis | Baseline | Candidate | Why | Baseline refs | Candidate refs |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
  const refs = (s: DiffSide | null) => (s?.refs ?? []).slice(0, 3).map((r) => `\`${r}\``).join(", ") + ((s?.refs.length ?? 0) > 3 ? " …" : "");
  for (const x of cells) lines.push(`| ${x.situationId} | ${x.invariant}${x.targeted ? " (target)" : ""} | ${x.axis} | ${rateOf(x.baseline)} | ${rateOf(x.candidate)} | ${esc(x.reason)} | ${refs(x.baseline)} | ${refs(x.candidate)} |`);
  lines.push("");
  return lines;
}

/** diff.md: the headline, then non-local regressions first (worst axis first), then the
 *  rest in the order a reader acts on them. */
export function renderDiff(report: DiffReport): string {
  const axisRank: Record<InvariantAxis, number> = { reliability: 0, policy: 1, protocol: 2, quality: 3 };
  const of = (k: DiffClass) => report.cells.filter((x) => x.class === k).sort((a, b) => axisRank[a.axis] - axisRank[b.axis] || a.situationId.localeCompare(b.situationId));
  const lines: string[] = ["# Interview simulator — brief-change diff (LC)", ""];
  lines.push(`- Baseline: ${report.baselineDirs.map((d) => `\`${d}\``).join(", ") || "(unnamed)"}`);
  lines.push(`- Candidate: ${report.candidateDirs.map((d) => `\`${d}\``).join(", ") || "(unnamed)"}`);
  lines.push(`- Targets: ${report.targets.join(", ") || "none declared"}`);
  for (const h of report.headline) lines.push(`- ${h}`);
  lines.push("");
  lines.push(...section("Non-local regressions", "Worse in a cell the change did not target. On the reliability axis these BLOCK; on the others, release only with the regression named and owned.", of("nonlocal_regression")));
  lines.push(...section("Targeted regressions", "Worse in a cell the change aimed at. Blocking on the reliability axis too.", of("targeted_regression")));
  lines.push(...section("Intended improvements", "Better in a targeted cell — necessary, and the least interesting line in a diff.", of("intended_improvement")));
  lines.push(...section("Non-local improvements", "Better where nothing was aimed. Treat with suspicion: an instrument turning more conservative overall shows up here first, and as a benign-question refusal elsewhere.", of("nonlocal_improvement")));
  lines.push(...section("Noise", `A flip consistent with run-to-run spread (the baseline cell flipped across its own samples and the candidate is not improbable at that rate, one-sided p ≥ ${NOISE_ALPHA}), or the same instrument on both sides.`, of("noise")));
  lines.push(...section("Not comparable", "Neither a regression nor an improvement: the cast changed or is unknown, a side could not evaluate the cell, the rubric changed, or the situation ran on one side only.", of("not_comparable")));
  lines.push(`Unchanged: ${report.totals.unchanged} cell(s).`, "");
  lines.push("A diff preserves whatever state the baseline was frozen in, including a bad one: it says what the change did, never whether the interviewer is good.", "");
  return lines.join("\n");
}
