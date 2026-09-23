// The interview simulator's VERDICT RUN (spark interview-uat-tranche, WP-2): read one or
// more simulator output directories (runner.ts), judge each conversation (optional, cached),
// apply the rule-checked invariants, and write what the run proves.
//
//   <outDir>/verdicts.json   per conversation: every InvariantVerdict, the quality metrics,
//                            the cross-block records, the judge id + rubric version, the
//                            dump's sha256
//   <outDir>/heatmap.md      MARGINS FIRST: the gate axes grouped by behaviour, then by
//                            fixture and by language, worst reliability first; then the
//                            behaviour × fixture cross with n per cell (thin under 3); then
//                            the registry's fixed reading order
//   <outDir>/findings.json   /uat findings (cert_level "LC"), one per failing invariant, plus
//                            strength rows; verdict always "uncertain" — the /uat adversarial
//                            pass (a person reading the transcript) is what confirms
//   <outDir>/report.md       instrument identity, the reliability gate in plain words, the
//                            margins, findings by impact, quality rates, the cross-block
//                            measurement, what passed
//   <outDir>/voices/<character>.md   with --characters (voices.ts)
//   <outDir>/diff.json, diff.md   with --baseline only (baseline-diff.ts): every situation ×
//                            invariant cell classified against an earlier verdict run —
//                            non-local regression first, then intended, noise, not comparable
//   <runDir>/verdicts/<situationId>.json   the per-conversation verdict file, which is also
//                            the judge CACHE, keyed by (dump sha256, judge id, rubric version)
//
// SEVERAL DIRECTORIES = repeated samples of the same bank: a situation's cell becomes a
// RATE (k fail / n evaluable) — "a cell red once in three runs is a rate, not a fact"
// (registry: persona-by-behaviour-heatmap). Dumps of the same situation made by different
// instruments (briefSha / directorVersion) are refused, naming them: a rate over two
// instruments is a rate over nothing. The same holds for the CAST: dumps of one situation
// with different situationSha (an edited persona) are refused too; a dump graded against a
// bank entry edited since it ran is a warning (it is re-graded against a situation it never
// ran).
//
// NEVER AVERAGED. Reliability, protocol, policy and quality are reported side by side; no
// number anywhere blends two axes. not_provoked and not_evaluable are counted separately
// and never as a pass.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { InterviewAgenda } from "../voice/director-types";
import { CROSS_BLOCK_CLASSES, countCrossBlock, measureCrossBlock, type CrossBlockRecord } from "./cross-block";
import { evaluateRules, qualityMetrics, type InvariantAxis, type InvariantVerdict, type QualityMetrics, type StimulusMap } from "./detectors";
import type { SimConversationDump } from "./engine";
import { factsOf, judgeConversation, judgeIndependenceProblem, judgeIndependenceWarning, JUDGE_RUBRIC_VERSION, roleFactsOf, stimulusFromFacts, type JudgeResult } from "./judge";
import { diffVerdicts, loadBaseline, renderDiff, type DiffReport } from "./baseline-diff";
import { conversationRef, excerpt, transcriptRef } from "./record";
import { loadSituations, situationSha, SIM_INVARIANTS, type SimInvariantId } from "./situations";
import type { SimFixture, SimLlm, SimSituation } from "./types";
import { characterClaims, characterVoice, parseCharacter, renderVoiceMarkdown, type CharacterFile, type VoiceResult } from "./voices";

// ---- the /uat finding --------------------------------------------------------------------------

export const IMPACT_LEVELS = ["low", "med", "high"] as const;
export type ImpactLevel = (typeof IMPACT_LEVELS)[number];
export type Impact = { frequency: ImpactLevel; reachability: ImpactLevel; trust_erosion: ImpactLevel };
export const SEVERITIES = ["blocker", "major", "minor", "polish"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const FINDING_TYPES = ["missing-feature", "quality-gap", "broken-flow", "confusion", "trust", "strength"] as const;
export const DIMENSIONS = ["completion", "effort", "clarity", "trust", "missing", "time-saved", "senior-quality"] as const;

export type UatFinding = {
  id: string;
  journey: "interview-conduct";
  character: string;
  cert_level: "LC";
  type: (typeof FINDING_TYPES)[number];
  severity: Severity;
  impact: Impact;
  dimension: (typeof DIMENSIONS)[number];
  title: string;
  expected: string;
  got: string;
  evidence: string[];
  code_check: "n-a";
  verdict: "uncertain";
  resolution: "open";
  recurrence: 1;
  suggested_acceptance: string;
};

/** The fixtures a real candidate meets; `rehearsal` is recruiter-only. */
export const CANDIDATE_FACING_FIXTURES: readonly SimFixture[] = ["kit", "prep", "debrief", "student"];

const POINTS: Record<ImpactLevel, number> = { low: 1, med: 2, high: 3 };

/** frequency × reachability × trust erosion, 1..27 — what the backlog ranks by. */
export function impactRank(impact: Impact): number {
  return POINTS[impact.frequency] * POINTS[impact.reachability] * POINTS[impact.trust_erosion];
}

/** Severity DERIVED from impact (never picked free-hand): rank ≥ 18 blocker, ≥ 8 major,
 *  ≥ 3 minor, else polish — so a breach every candidate meets outranks a severe-sounding
 *  one nobody reaches. The quality axis is never above minor: it is a matter of degree. */
export function deriveSeverity(impact: Impact, axis: InvariantAxis): Severity {
  const rank = impactRank(impact);
  const sev: Severity = rank >= 18 ? "blocker" : rank >= 8 ? "major" : rank >= 3 ? "minor" : "polish";
  if (axis === "quality" && (sev === "blocker" || sev === "major")) return "minor";
  return sev;
}

/** Frequency from the fail rate over EVALUABLE conversations: ≥ 1/2 high, ≥ 1/5 med, else low. */
export function frequencyOf(fails: number, evaluable: number): ImpactLevel {
  const rate = evaluable > 0 ? fails / evaluable : 0;
  return rate >= 0.5 ? "high" : rate >= 0.2 ? "med" : "low";
}

export function reachabilityOf(fixtures: readonly SimFixture[]): ImpactLevel {
  return fixtures.some((f) => CANDIDATE_FACING_FIXTURES.includes(f)) ? "high" : "low";
}

export function trustErosionOf(axis: InvariantAxis): ImpactLevel {
  return axis === "reliability" || axis === "policy" ? "high" : axis === "protocol" ? "med" : "low";
}

const TYPE_FOR_AXIS: Record<InvariantAxis, UatFinding["type"]> = { reliability: "trust", policy: "trust", protocol: "broken-flow", quality: "quality-gap" };
const DIMENSION_FOR_AXIS: Record<InvariantAxis, UatFinding["dimension"]> = { reliability: "trust", policy: "trust", protocol: "completion", quality: "senior-quality" };
const DIMENSION_OVERRIDE: Partial<Record<SimInvariantId, UatFinding["dimension"]>> = { completed: "completion", not_stuck: "completion", language_follow: "clarity" };

// ---- what one conversation's verdict is ----------------------------------------------------

export type ConversationVerdicts = {
  dir: string;
  runId: string;
  situationId: string;
  behaviour: string;
  fixture: SimFixture;
  language: string;
  character: string | null;
  dumpSha: string;
  /** The cast the dump ran (null on dumps written before it was recorded). */
  situationSha: string | null;
  endedBy: string;
  instrument: { briefSha: string; directorVersion: string };
  providers: { interviewer: string; candidate: string };
  judge: { id: string; rubricVersion: string; status: JudgeResult["status"]; problems: string[] } | null;
  verdicts: InvariantVerdict[];
  quality: QualityMetrics;
  crossBlock: CrossBlockRecord[];
};

const GATE_AXES = ["reliability", "protocol", "policy"] as const;
type GateAxis = (typeof GATE_AXES)[number];

/** A conversation on one axis: fail if any invariant failed, pass if any passed and none
 *  failed, none when nothing on that axis was evaluable. */
export function axisState(verdicts: readonly InvariantVerdict[], axis: InvariantAxis): "fail" | "pass" | "none" {
  const on = verdicts.filter((v) => v.axis === axis);
  if (on.some((v) => v.state === "fail")) return "fail";
  return on.some((v) => v.state === "pass") ? "pass" : "none";
}

export type GroupRow = {
  key: string;
  /** Conversations in the group. */
  n: number;
  axes: Record<GateAxis, { fail: number; evaluable: number }>;
  /** Invariant verdicts (gate axes) in these states — counted, never as a pass. */
  notProvoked: number;
  notEvaluable: number;
  failing: string[];
};

export function groupRows(convs: readonly ConversationVerdicts[], keyOf: (c: ConversationVerdicts) => string): GroupRow[] {
  const rows = new Map<string, GroupRow>();
  for (const c of convs) {
    const key = keyOf(c);
    const row = rows.get(key) ?? { key, n: 0, axes: { reliability: { fail: 0, evaluable: 0 }, protocol: { fail: 0, evaluable: 0 }, policy: { fail: 0, evaluable: 0 } }, notProvoked: 0, notEvaluable: 0, failing: [] };
    row.n += 1;
    for (const axis of GATE_AXES) {
      const s = axisState(c.verdicts, axis);
      if (s !== "none") row.axes[axis].evaluable += 1;
      if (s === "fail") row.axes[axis].fail += 1;
    }
    for (const v of c.verdicts) {
      if (v.axis === "quality") continue;
      if (v.state === "not_provoked") row.notProvoked += 1;
      if (v.state === "not_evaluable") row.notEvaluable += 1;
      if (v.state === "fail" && !row.failing.includes(v.invariant)) row.failing.push(v.invariant);
    }
    rows.set(key, row);
  }
  return [...rows.values()];
}

const rate = (x: { fail: number; evaluable: number }) => (x.evaluable > 0 ? x.fail / x.evaluable : 0);

/** Worst reliability first, ties toward the LARGER group, then protocol, policy, name. */
export function sortGroups(rows: readonly GroupRow[]): GroupRow[] {
  return [...rows].sort(
    (a, b) =>
      rate(b.axes.reliability) - rate(a.axes.reliability) ||
      b.n - a.n ||
      rate(b.axes.policy) - rate(a.axes.policy) ||
      rate(b.axes.protocol) - rate(a.axes.protocol) ||
      a.key.localeCompare(b.key),
  );
}

// ---- findings ------------------------------------------------------------------------------

type InvariantTally = { inv: SimInvariantId; axis: InvariantAxis; pass: ConversationVerdicts[]; fail: ConversationVerdicts[]; notProvoked: number; notEvaluable: number };

export function tallyInvariants(convs: readonly ConversationVerdicts[]): InvariantTally[] {
  return (Object.keys(SIM_INVARIANTS) as SimInvariantId[]).map((inv) => {
    const t: InvariantTally = { inv, axis: SIM_INVARIANTS[inv].axis, pass: [], fail: [], notProvoked: 0, notEvaluable: 0 };
    for (const c of convs) {
      const v = c.verdicts.find((x) => x.invariant === inv);
      if (!v) continue;
      if (v.state === "pass") t.pass.push(c);
      else if (v.state === "fail") t.fail.push(c);
      else if (v.state === "not_provoked") t.notProvoked += 1;
      else t.notEvaluable += 1;
    }
    return t;
  });
}

const refsOf = (c: ConversationVerdicts, inv: SimInvariantId): string[] => {
  const v = c.verdicts.find((x) => x.invariant === inv);
  const seqs = [...new Set((v?.evidence ?? []).map((e) => e.seq))];
  return seqs.length ? seqs.map((s) => transcriptRef(c.runId, c.situationId, s)) : [conversationRef(c.runId, c.situationId)];
};

const characterOf = (c: ConversationVerdicts) => c.character ?? `sim:${c.behaviour}`;

/** One finding per failing invariant, strength rows for invariants that held in 3 or more
 *  evaluable conversations, ranked by impact. */
export function buildFindings(convs: readonly ConversationVerdicts[]): UatFinding[] {
  const gaps: { f: UatFinding; rank: number; failRate: number }[] = [];
  const strengths: UatFinding[] = [];
  for (const t of tallyInvariants(convs)) {
    const evaluable = t.pass.length + t.fail.length;
    const what = SIM_INVARIANTS[t.inv].what;
    const slug = t.inv.toUpperCase().replace(/_/g, "-");
    const dimension = DIMENSION_OVERRIDE[t.inv] ?? DIMENSION_FOR_AXIS[t.axis];
    if (t.fail.length > 0) {
      const impact: Impact = { frequency: frequencyOf(t.fail.length, evaluable), reachability: reachabilityOf(t.fail.map((c) => c.fixture)), trust_erosion: trustErosionOf(t.axis) };
      const notes = t.fail.map((c) => `${c.situationId}: ${c.verdicts.find((v) => v.invariant === t.inv)?.note ?? ""}`);
      const f: UatFinding = {
        id: `LC-${slug}`,
        journey: "interview-conduct",
        character: [...new Set(t.fail.map(characterOf))].join(", "),
        cert_level: "LC",
        type: TYPE_FOR_AXIS[t.axis],
        severity: deriveSeverity(impact, t.axis),
        impact,
        dimension,
        title: `${t.inv} broken in ${t.fail.length} of ${evaluable} evaluable conversation(s) (${t.axis})`,
        expected: what,
        got: `${notes.slice(0, 3).join(" · ")}${notes.length > 3 ? ` · (+${notes.length - 3} more)` : ""}`,
        evidence: t.fail.flatMap((c) => refsOf(c, t.inv)),
        code_check: "n-a",
        verdict: "uncertain",
        resolution: "open",
        recurrence: 1,
        suggested_acceptance:
          t.axis === "quality"
            ? `On a re-run of the same situations the per-conversation rate of ${t.inv} misses falls (a quality trend, never a gate).`
            : `Every evaluable conversation passes ${t.inv} on a re-run of the same situations — full pass, with no more not_evaluable than this run.`,
      };
      gaps.push({ f, rank: impactRank(impact), failRate: t.fail.length / Math.max(1, evaluable) });
    } else if (evaluable >= 3) {
      strengths.push({
        id: `LC-${slug}-S`,
        journey: "interview-conduct",
        character: [...new Set(t.pass.map(characterOf))].join(", "),
        cert_level: "LC",
        type: "strength",
        severity: "polish",
        impact: { frequency: "high", reachability: reachabilityOf(t.pass.map((c) => c.fixture)), trust_erosion: "low" },
        dimension,
        title: `${t.inv} held in all ${evaluable} evaluable conversations (${t.axis})`,
        expected: what,
        got: `pass in ${evaluable} of ${evaluable}; not provoked ${t.notProvoked}, not evaluable ${t.notEvaluable} (neither counted as a pass)`,
        evidence: t.pass.slice(0, 3).flatMap((c) => refsOf(c, t.inv)),
        code_check: "n-a",
        verdict: "uncertain",
        resolution: "open",
        recurrence: 1,
        suggested_acceptance: `Protect it: ${t.inv} keeps passing in every evaluable conversation on the next re-run.`,
      });
    }
  }
  gaps.sort((a, b) => b.rank - a.rank || b.failRate - a.failRate || a.f.id.localeCompare(b.f.id));
  return [...gaps.map((g) => g.f), ...strengths];
}

// ---- loading ---------------------------------------------------------------------------------

type InstrumentFile = {
  key?: string;
  fixture?: string;
  locale?: string | null;
  agenda?: InterviewAgenda;
  privateBrief?: string;
  candidateBrief?: string | null;
  record?: { briefSha?: string; directorVersion?: string };
};
type IndexFile = { runs?: Record<string, unknown>[]; conversations?: { situationId: string; file: string }[] };
type LoadedDump = { file: string; raw: string; dump: SimConversationDump };
type LoadedRun = { dir: string; index: IndexFile | null; instruments: Map<string, InstrumentFile>; dumps: LoadedDump[]; missing: string[] };

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null; // missing or unreadable: the caller counts it as a coverage gap
  }
}

function loadRun(dir: string): LoadedRun {
  const index = readJson<IndexFile>(path.join(dir, "index.json"));
  const instruments = new Map<string, InstrumentFile>();
  const instDir = path.join(dir, "instruments");
  if (existsSync(instDir)) {
    for (const f of readdirSync(instDir).filter((x) => x.endsWith(".json"))) {
      const inst = readJson<InstrumentFile>(path.join(instDir, f));
      if (inst?.record?.briefSha) instruments.set(inst.record.briefSha, inst);
    }
  }
  const dumps: LoadedDump[] = [];
  for (const file of readdirSync(dir).filter((x) => x.endsWith(".json") && x !== "index.json").sort()) {
    let raw: string;
    try {
      raw = readFileSync(path.join(dir, file), "utf8");
    } catch {
      continue; // unreadable: it will show as a coverage gap if the index names it
    }
    let dump: SimConversationDump;
    try {
      dump = JSON.parse(raw) as SimConversationDump;
    } catch {
      continue; // a half-written dump is no result; the index names it as missing below
    }
    if (typeof dump?.situationId === "string" && Array.isArray(dump.turns)) dumps.push({ file, raw, dump });
  }
  const have = new Set(dumps.map((d) => d.dump.situationId));
  const missing = (index?.conversations ?? []).map((c) => c.situationId).filter((id) => !have.has(id));
  return { dir, index, instruments, dumps, missing };
}

export class InstrumentIdentityError extends Error {}
export class JudgeIndependenceError extends Error {}

/** Refuse to merge dumps of one situation made by different instruments. */
export function instrumentConflicts(runs: readonly { dir: string; dumps: readonly { dump: SimConversationDump }[] }[]): string[] {
  const seen = new Map<string, { dir: string; briefSha: string; directorVersion: string; situationSha: string | null }>();
  const problems: string[] = [];
  for (const run of runs) {
    for (const { dump } of run.dumps) {
      const id = dump.situationId;
      const cur = { dir: run.dir, briefSha: dump.instrument?.briefSha ?? "?", directorVersion: dump.instrument?.directorVersion ?? "?", situationSha: dump.situationSha ?? null };
      const prev = seen.get(id);
      if (!prev) seen.set(id, cur);
      else if (prev.briefSha !== cur.briefSha || prev.directorVersion !== cur.directorVersion) {
        problems.push(`${id}: ${prev.dir} ran briefSha ${prev.briefSha} / directorVersion ${prev.directorVersion}, ${cur.dir} ran ${cur.briefSha} / ${cur.directorVersion}`);
      } else if (prev.situationSha && cur.situationSha && prev.situationSha !== cur.situationSha) {
        // A dump without the digest predates it: unknown, not a conflict.
        problems.push(`${id}: ${prev.dir} ran situationSha ${prev.situationSha}, ${cur.dir} ran ${cur.situationSha} (the situation was edited between the runs)`);
      }
    }
  }
  return problems;
}

// ---- the run ---------------------------------------------------------------------------------

export type VerdictRunOptions = {
  dirs: string[];
  /** Default: <first dir>/verdict/. */
  outDir?: string;
  /** The judge (null/absent = rules only: every judge-method invariant not_evaluable). */
  judge?: SimLlm | null;
  /** The model the judge runs on, for the independence check (null = the CLI default). */
  judgeModel?: string | null;
  /** /uat Character markdown files, for the findings' `character` and the voices. */
  characters?: string[];
  /** The voice model (the judge's). Voices are skipped without one. */
  voiceLlm?: SimLlm | null;
  concurrency?: number;
  /** Compare against an earlier verdict run (its output directory, or the run directory
   *  holding verdict/): writes diff.json + diff.md (baseline-diff.ts). `targets` are the
   *  invariant ids or situation ids the change aimed at. Absent = nothing new is written. */
  baseline?: { dir: string; targets?: string[] } | null;
  log?: (line: string) => void;
};

export type VerdictRunResult = {
  outDir: string;
  conversations: ConversationVerdicts[];
  findings: UatFinding[];
  voices: VoiceResult[];
  coverage: { selected: number; produced: number; missing: string[]; unknownSituations: string[] };
  reliabilityFails: number;
  warnings: string[];
  files: string[];
  /** Only with `baseline`. */
  diff?: DiffReport;
};

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

function writeAtomic(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, file);
}

type VerdictFile = {
  version: 1;
  situationId: string;
  runId: string;
  dumpSha: string;
  judge: { id: string; rubricVersion: string; result: JudgeResult } | null;
  rubricVersion: string | null;
  verdicts: InvariantVerdict[];
  quality: QualityMetrics;
  crossBlock: CrossBlockRecord[];
  writtenAt: string;
};

async function pool<T>(items: readonly T[], workers: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(workers, queue.length || 1)) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
    }),
  );
}

/** Read, judge, evaluate and write (see the header). Throws InstrumentIdentityError on
 *  mixed instruments and JudgeIndependenceError when the judge is the interviewer's model. */
export async function verdictRuns(opts: VerdictRunOptions): Promise<VerdictRunResult> {
  const log = opts.log ?? (() => undefined);
  if (opts.dirs.length === 0) throw new Error("verdictRuns: no run directory given");
  const outDir = path.resolve(opts.outDir ?? path.join(opts.dirs[0], "verdict"));
  const runs = opts.dirs.map((d) => loadRun(path.resolve(d)));

  // Read the baseline BEFORE anything is written: --out may be the baseline's own directory.
  const baseline = opts.baseline ? loadBaseline(path.resolve(opts.baseline.dir)) : null;

  const conflicts = instrumentConflicts(runs);
  if (conflicts.length) throw new InstrumentIdentityError(`refusing to merge dumps of different instruments (instrument identity):\n  ${conflicts.join("\n  ")}`);

  const warnings: string[] = [];
  const interviewerIds = [...new Set(runs.flatMap((r) => r.dumps.map((d) => d.dump.trace?.providers?.interviewer ?? "unknown")))];
  if (opts.judge) {
    const problem = judgeIndependenceProblem(interviewerIds, opts.judge.id);
    if (problem) throw new JudgeIndependenceError(problem);
    const warning = judgeIndependenceWarning(interviewerIds, opts.judge.id);
    if (warning) warnings.push(warning);
  }
  if (opts.voiceLlm && judgeIndependenceProblem(interviewerIds, opts.voiceLlm.id)) {
    throw new JudgeIndependenceError(`the Character voice: ${judgeIndependenceProblem(interviewerIds, opts.voiceLlm.id)}`);
  }

  const bank = new Map(loadSituations().map((s) => [s.id, s]));
  const characters: CharacterFile[] = (opts.characters ?? []).map((p) => parseCharacter(p, readFileSync(p, "utf8")));
  const characterFor = (s: SimSituation) => characters.find((c) => characterClaims(c, s))?.name ?? null;

  const unknownSituations: string[] = [];
  const editedSince: string[] = [];
  const items: { run: LoadedRun; loaded: LoadedDump; situation: SimSituation }[] = [];
  for (const run of runs) {
    for (const loaded of run.dumps) {
      const s = bank.get(loaded.dump.situationId);
      if (s) {
        items.push({ run, loaded, situation: s });
        if (loaded.dump.situationSha && loaded.dump.situationSha !== situationSha(s)) editedSince.push(`${run.dir}/${loaded.file}`);
      } else unknownSituations.push(`${run.dir}/${loaded.file} (situation ${loaded.dump.situationId} is not in the bank)`);
    }
  }
  if (editedSince.length) warnings.push(`${editedSince.length} dump(s) ran a situation edited since in situations.json, and are graded against the CURRENT entry: ${editedSince.join(", ")}`);
  const missing = runs.flatMap((r) => r.missing.map((id) => `${r.dir}/${id}`));
  const selected = items.length + missing.length + unknownSituations.length;

  const conversations: ConversationVerdicts[] = [];
  const conversationsByItem = new Map<object, ConversationVerdicts>();
  await pool(items, opts.concurrency ?? 3, async ({ run, loaded, situation }) => {
    const { dump, raw } = loaded;
    const dumpSha = `sha256:${sha256(raw)}`;
    const inst = run.instruments.get(dump.instrument?.briefSha ?? "") ?? null;
    const agenda = inst?.agenda ?? null;
    const cacheFile = path.join(run.dir, "verdicts", `${dump.situationId}.json`);
    const cached = readJson<VerdictFile>(cacheFile);
    let judged: JudgeResult | null = null;
    if (opts.judge) {
      const reusable = cached?.judge && cached.dumpSha === dumpSha && cached.judge.id === opts.judge.id && cached.judge.rubricVersion === JUDGE_RUBRIC_VERSION && cached.judge.result.status === "ok";
      if (reusable && cached?.judge) {
        judged = cached.judge.result;
        log(`judge: ${dump.situationId} — cached (${opts.judge.id}, ${JUDGE_RUBRIC_VERSION})`);
      } else {
        const titles = (agenda?.blocks ?? []).map((b) => ({ id: b.id, title: b.title }));
        judged = await judgeConversation(dump, situation, titles, opts.judge, { roleFacts: roleFactsOf(inst?.candidateBrief ?? inst?.privateBrief ?? null) });
        log(`judge: ${dump.situationId} — ${judged.status}${judged.problems.length ? ` (${judged.problems.length} fact(s) unverified or unanswered)` : ""}`);
      }
    }
    const facts = factsOf(judged);
    const stimulus = stimulusFromFacts(facts) as StimulusMap;
    const verdicts = evaluateRules(dump, situation, stimulus, { agenda, facts });
    const crossBlock = measureCrossBlock(dump, facts);
    const quality = qualityMetrics(dump);
    const file: VerdictFile = {
      version: 1,
      situationId: dump.situationId,
      runId: dump.runId,
      dumpSha,
      judge: judged && opts.judge ? { id: opts.judge.id, rubricVersion: JUDGE_RUBRIC_VERSION, result: judged } : null,
      rubricVersion: judged ? JUDGE_RUBRIC_VERSION : null,
      verdicts,
      quality,
      crossBlock,
      writtenAt: new Date().toISOString(),
    };
    // A rules-only run never overwrites a judged verdict file (the judge result is paid for).
    if (judged || !cached?.judge) writeAtomic(cacheFile, `${JSON.stringify(file, null, 2)}\n`);
    const conv: ConversationVerdicts = {
      dir: run.dir,
      runId: dump.runId,
      situationId: dump.situationId,
      behaviour: situation.behaviour,
      fixture: situation.fixture,
      language: situation.language,
      character: characterFor(situation),
      dumpSha,
      situationSha: dump.situationSha ?? null,
      endedBy: dump.endedBy,
      instrument: { briefSha: dump.instrument?.briefSha ?? "?", directorVersion: dump.instrument?.directorVersion ?? "?" },
      providers: { interviewer: dump.trace?.providers?.interviewer ?? "?", candidate: dump.trace?.providers?.candidate ?? "?" },
      judge: judged ? { id: judged.judgeId, rubricVersion: judged.rubricVersion, status: judged.status, problems: judged.problems } : null,
      verdicts,
      quality,
      crossBlock,
    };
    conversationsByItem.set(loaded, conv);
  });
  for (const it of items) {
    const c = conversationsByItem.get(it.loaded);
    if (c) conversations.push(c);
  }

  // Voices.
  const voices: VoiceResult[] = [];
  for (const c of characters) {
    const convs = items.filter((it) => characterClaims(c, it.situation)).map((it) => ({ dump: it.loaded.dump, situation: it.situation }));
    if (!opts.voiceLlm) {
      voices.push({ character: c.name, displayName: c.displayName, path: c.path, status: "skipped", reason: "no voice model (the voice runs on the judge's model; rules-only runs have none)", refs: [], criteria: [] });
      continue;
    }
    const v = await characterVoice(c, convs, opts.voiceLlm);
    log(`voice: ${c.name} — ${v.status}${v.reason ? ` (${v.reason})` : ""}`);
    voices.push(v);
  }

  const findings = buildFindings(conversations);
  const reliabilityFails = conversations.reduce((n, c) => n + c.verdicts.filter((v) => v.axis === "reliability" && v.state === "fail").length, 0);
  const coverage = { selected, produced: conversations.length, missing, unknownSituations };
  const meta = {
    dirs: runs.map((r) => r.dir),
    runIds: [...new Set(conversations.map((c) => c.runId))],
    judge: opts.judge ? { id: opts.judge.id, model: opts.judgeModel ?? null, rubricVersion: JUDGE_RUBRIC_VERSION } : null,
    warnings,
  };

  const files: string[] = [];
  const write = (name: string, text: string) => {
    const f = path.join(outDir, name);
    writeAtomic(f, text);
    files.push(f);
  };
  write("verdicts.json", `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), ...meta, coverage, conversations }, null, 2)}\n`);
  write("findings.json", `${JSON.stringify(findings, null, 2)}\n`);
  write("heatmap.md", renderHeatmap(conversations, runs.length));
  write("report.md", renderReport({ conversations, findings, coverage, runs: runs.map((r) => ({ dir: r.dir, instruments: [...r.instruments.values()] })), judge: meta.judge, warnings, voices, samples: runs.length }));
  for (const v of voices) write(path.join("voices", `${v.character}.md`), renderVoiceMarkdown(v));
  let diff: DiffReport | undefined;
  if (baseline && opts.baseline) {
    diff = diffVerdicts({ conversations: baseline.conversations, dirs: baseline.dirs?.length ? baseline.dirs : [path.dirname(baseline.file)] }, { conversations, dirs: meta.dirs }, { targets: opts.baseline.targets ?? [] });
    write("diff.json", `${JSON.stringify({ ...diff, baselineFile: baseline.file, generatedAt: new Date().toISOString() }, null, 2)}\n`);
    write("diff.md", renderDiff(diff));
  }
  return { outDir, conversations, findings, voices, coverage, reliabilityFails, warnings, files, ...(diff ? { diff } : {}) };
}

// ---- rendering ---------------------------------------------------------------------------------

const cell = (x: { fail: number; evaluable: number }) => (x.evaluable === 0 ? "–" : x.fail > 0 ? `**✗ ${x.fail}/${x.evaluable}**` : `✓ 0/${x.evaluable}`);
const esc = (s: string) => s.replace(/\|/g, "\\|");

function marginTable(title: string, rows: readonly GroupRow[]): string[] {
  const lines = [`### ${title}`, "", "| Group | n | Reliability | Protocol | Policy | Not provoked | Not evaluable | Failing invariants |", "| --- | --- | --- | --- | --- | --- | --- | --- |"];
  for (const r of sortGroups(rows)) {
    lines.push(`| ${esc(r.key)} | ${r.n} | ${cell(r.axes.reliability)} | ${cell(r.axes.protocol)} | ${cell(r.axes.policy)} | ${r.notProvoked} | ${r.notEvaluable} | ${r.failing.join(", ") || "—"} |`);
  }
  lines.push("");
  return lines;
}

/** The worst gate axis of a set of conversations, for one cross cell. */
function crossCell(convs: readonly ConversationVerdicts[]): string {
  if (convs.length === 0) return " ";
  const n = convs.length;
  const thin = n < 3 ? ", thin" : "";
  for (const [axis, label] of [["reliability", "R"], ["policy", "Po"], ["protocol", "Pr"]] as const) {
    const states = convs.map((c) => axisState(c.verdicts, axis));
    const fails = states.filter((s) => s === "fail").length;
    const evaluable = states.filter((s) => s !== "none").length;
    if (fails > 0) return `${label} ✗ ${fails}/${evaluable} (n=${n}${thin})`;
  }
  const any = convs.some((c) => GATE_AXES.some((a) => axisState(c.verdicts, a) !== "none"));
  return any ? `✓ (n=${n}${thin})` : `– (n=${n}${thin})`;
}

export function renderHeatmap(convs: readonly ConversationVerdicts[], samples: number): string {
  const lines: string[] = ["# Interview simulator — heatmap (LC)", ""];
  lines.push(
    `${convs.length} conversation(s)${samples > 1 ? ` from ${samples} runs merged as repeated samples: every cell is a RATE over samples (a cell red once in three runs is a rate, not a fact)` : ""}. ` +
      "Each axis cell is `fail/evaluable` in CONVERSATIONS (a conversation fails an axis when any of its invariants on that axis failed); " +
      "`not provoked` and `not evaluable` count invariant verdicts on the three gate axes, and neither is ever a pass. Quality is not here: see report.md.",
    "",
  );
  lines.push("## Margins", "");
  lines.push(...marginTable("By behaviour", groupRows(convs, (c) => c.behaviour)));
  lines.push(...marginTable("By fixture", groupRows(convs, (c) => c.fixture)));
  lines.push(...marginTable("By language", groupRows(convs, (c) => c.language)));

  const behaviours = sortGroups(groupRows(convs, (c) => c.behaviour)).map((r) => r.key);
  const fixtures = [...new Set(convs.map((c) => c.fixture))].sort();
  lines.push("## Behaviour × fixture", "", "The worst gate axis per cell (R reliability › Po policy › Pr protocol), with n; a cell under 3 conversations is thin — not a finding on its own.", "");
  lines.push(`| Behaviour | ${fixtures.join(" | ")} |`, `| --- | ${fixtures.map(() => "---").join(" | ")} |`);
  for (const b of behaviours) lines.push(`| ${b} | ${fixtures.map((f) => crossCell(convs.filter((c) => c.behaviour === b && c.fixture === f))).join(" | ")} |`);
  lines.push("");

  lines.push("## Per situation", "", "| Situation | Samples | Reliability | Protocol | Policy | Failing invariants (k fail / n evaluable) |", "| --- | --- | --- | --- | --- | --- |");
  const bySituation = new Map<string, ConversationVerdicts[]>();
  for (const c of convs) bySituation.set(c.situationId, [...(bySituation.get(c.situationId) ?? []), c]);
  for (const [id, cs] of [...bySituation.entries()].sort()) {
    const row = groupRows(cs, () => id)[0];
    const failing = tallyInvariants(cs)
      .filter((t) => t.fail.length > 0)
      .map((t) => `${t.inv} ${t.fail.length}/${t.fail.length + t.pass.length}`);
    lines.push(`| ${id} | ${cs.length} | ${cell(row.axes.reliability)} | ${cell(row.axes.protocol)} | ${cell(row.axes.policy)} | ${failing.join(", ") || "—"} |`);
  }
  lines.push("");

  lines.push("## Reading order", "", ...readingOrder(convs), "");
  lines.push("Simulated candidates establish that the policy holds against behaviours someone imagined, not against a real population. A colour here is a diagnostic, never a claim about real candidates.", "");
  return lines.join("\n");
}

/** The registry's fixed reading order, applied: any reliability red → stop; a full column
 *  (behaviour) red → policy hole; a full row (fixture or language) red → population
 *  failure; scattered → weak; isolated → read the transcripts. */
export function readingOrder(convs: readonly ConversationVerdicts[]): string[] {
  const out: string[] = [];
  const relFails = convs.flatMap((c) => c.verdicts.filter((v) => v.axis === "reliability" && v.state === "fail").map((v) => ({ c, v })));
  out.push(
    relFails.length
      ? `1. **Reliability red — stop.** ${relFails.length} reliability fail(s) across ${convs.length} conversation(s): ${relFails
          .slice(0, 6)
          .map(({ c, v }) => `${v.invariant} in ${c.situationId}`)
          .join("; ")}${relFails.length > 6 ? "; …" : ""}. The release is closed until each is read and fixed.`
      : `1. No reliability red across ${convs.length} conversation(s).`,
  );
  const failsGate = (c: ConversationVerdicts) => GATE_AXES.some((a) => axisState(c.verdicts, a) === "fail");
  const evaluableGate = (c: ConversationVerdicts) => GATE_AXES.some((a) => axisState(c.verdicts, a) !== "none");
  const fullRed = (keyOf: (c: ConversationVerdicts) => string) => {
    const groups = new Map<string, ConversationVerdicts[]>();
    for (const c of convs) if (evaluableGate(c)) groups.set(keyOf(c), [...(groups.get(keyOf(c)) ?? []), c]);
    return [...groups.entries()].filter(([, cs]) => cs.length > 0 && cs.every(failsGate)).map(([k, cs]) => ({ k, n: cs.length }));
  };
  // A "full" column or row needs at least two conversations: one red conversation is an
  // isolated cell (step 5), however it is grouped.
  const cols = fullRed((c) => c.behaviour).filter((x) => x.n >= 2);
  out.push(
    cols.length
      ? `2. **Full column red (policy hole):** ${cols.map((x) => `${x.k} (${x.n} conversations${x.n < 3 ? ", thin" : ""})`).join(", ")} — fix the instrument, not the case.`
      : "2. No behaviour column of two or more conversations is red in every one.",
  );
  const rows = [...fullRed((c) => `fixture ${c.fixture}`), ...fullRed((c) => `language ${c.language}`)].filter((x) => x.n >= 2);
  out.push(rows.length ? `3. **Full row red (population failure):** ${rows.map((x) => `${x.k} (${x.n})`).join(", ")} — ask who this resembles in the real applicant pool.` : "3. No fixture or language row of two or more conversations is red in every one.");
  const redBehaviours = new Set(convs.filter(failsGate).map((c) => c.behaviour));
  const scattered = redBehaviours.size >= 3 && cols.length === 0 && rows.length === 0;
  out.push(scattered ? `4. **Scattered red** across ${redBehaviours.size} behaviours with no full column or row: the instrument is generally weak; a targeted fix will not help.` : "4. Not a scattered pattern.");
  const isolated = convs.filter(failsGate).map((c) => conversationRef(c.runId, c.situationId));
  out.push(isolated.length ? `5. **Read the transcripts** of every red conversation (half of isolated cells are case artifacts): ${isolated.join(", ")}.` : "5. Nothing isolated to read.");
  return out;
}

type ReportInput = {
  conversations: readonly ConversationVerdicts[];
  findings: readonly UatFinding[];
  coverage: VerdictRunResult["coverage"];
  runs: readonly { dir: string; instruments: readonly InstrumentFile[] }[];
  judge: { id: string; model: string | null; rubricVersion: string } | null;
  warnings: readonly string[];
  voices: readonly VoiceResult[];
  samples: number;
};

export function renderReport(input: ReportInput): string {
  const { conversations: convs, findings, coverage } = input;
  const lines: string[] = ["# Interview simulator — verdict report (LC)", ""];

  // Instrument identity.
  lines.push("## What was tested", "");
  const shaByKey = new Map<string, string>();
  for (const r of input.runs) for (const i of r.instruments) if (i.key && i.record?.briefSha) shaByKey.set(i.key, i.record.briefSha);
  lines.push(`- Runs: ${input.runs.map((r) => `\`${r.dir}\``).join(", ")} (${[...new Set(convs.map((c) => c.runId))].join(", ") || "no conversation"})`);
  lines.push(`- Conversations: ${convs.length}${input.samples > 1 ? ` from ${input.samples} runs (repeated samples — per-situation cells are rates)` : ""}`);
  lines.push(`- Instrument (briefSha per fixture.locale): ${[...shaByKey.entries()].sort().map(([k, v]) => `${k} ${v}`).join(" · ") || "(no instruments/ directory)"}`);
  lines.push(`- directorVersion: ${[...new Set(convs.map((c) => c.instrument.directorVersion))].join(", ") || "?"}`);
  lines.push(`- Providers: interviewer ${[...new Set(convs.map((c) => c.providers.interviewer))].join(", ") || "?"}; candidate ${[...new Set(convs.map((c) => c.providers.candidate))].join(", ") || "?"}`);
  lines.push(input.judge ? `- Judge: ${input.judge.id}${input.judge.model ? ` (model ${input.judge.model})` : ""}, rubric ${input.judge.rubricVersion}` : "- Judge: none (rules only — every judge-method invariant is not_evaluable)");
  for (const w of input.warnings) lines.push(`- WARNING: ${w}`);
  const produced = coverage.produced;
  lines.push(`- Coverage: ${produced} of ${coverage.selected} selected conversation(s) produced a verdict${coverage.missing.length ? `; MISSING: ${coverage.missing.join(", ")}` : ""}${coverage.unknownSituations.length ? `; NOT IN THE BANK: ${coverage.unknownSituations.join(", ")}` : ""}`);
  lines.push("");

  // The reliability gate.
  const rel = convs.flatMap((c) => c.verdicts.filter((v) => v.axis === "reliability").map((v) => ({ c, v })));
  const relFails = rel.filter((x) => x.v.state === "fail");
  const relNe = rel.filter((x) => x.v.state === "not_evaluable");
  const gap = coverage.produced < coverage.selected;
  const gate = relFails.length > 0 ? "FAIL" : gap || relNe.length > 0 ? "INCONCLUSIVE" : convs.length === 0 ? "NOT EVALUABLE" : "PASS";
  lines.push("## Reliability gate (full pass)", "");
  lines.push(`**${gate}** — ${relFails.length} reliability fail(s) across ${convs.length} conversation(s)${relNe.length ? `; ${relNe.length} reliability verdict(s) not evaluable` : ""}${gap ? `; coverage ${coverage.produced}/${coverage.selected}` : ""}.`, "");
  for (const { c, v } of relFails) {
    const e = v.evidence[0];
    lines.push(`- ${v.invariant} — \`${e ? transcriptRef(c.runId, c.situationId, e.seq) : conversationRef(c.runId, c.situationId)}\`: ${esc(v.note)}${e ? `\n  > ${excerpt(e.quote, 300)}` : ""}`);
  }
  if (relFails.length) lines.push("");
  lines.push("A breach is read, not aggregated: every line above names its turn. Verdicts stay `uncertain` until a person reads the transcript (/uat adversarial pass).", "");

  // Margins.
  lines.push("## Margins (see heatmap.md)", "");
  for (const [title, keyOf] of [
    ["behaviour", (c: ConversationVerdicts) => c.behaviour],
    ["fixture", (c: ConversationVerdicts) => c.fixture],
    ["language", (c: ConversationVerdicts) => c.language],
  ] as const) {
    const rows = sortGroups(groupRows(convs, keyOf));
    lines.push(`- By ${title}: ${rows.map((r) => `${r.key} R ${r.axes.reliability.fail}/${r.axes.reliability.evaluable} · Pr ${r.axes.protocol.fail}/${r.axes.protocol.evaluable} · Po ${r.axes.policy.fail}/${r.axes.policy.evaluable} (n=${r.n})`).join("; ") || "—"}`);
  }
  lines.push("");

  // Findings.
  const gaps = findings.filter((f) => f.type !== "strength");
  lines.push("## Findings, ranked by impact (frequency × reachability × trust erosion)", "");
  if (gaps.length === 0) lines.push("None: no invariant failed in an evaluable conversation.", "");
  else {
    lines.push("| Id | Severity | Impact (f/r/t) | Title | Evidence |", "| --- | --- | --- | --- | --- |");
    for (const f of gaps) lines.push(`| ${f.id} | ${f.severity} | ${f.impact.frequency}/${f.impact.reachability}/${f.impact.trust_erosion} (${impactRank(f.impact)}) | ${esc(f.title)} | ${f.evidence.slice(0, 3).map((e) => `\`${e}\``).join(", ")}${f.evidence.length > 3 ? " …" : ""} |`);
    lines.push("");
  }

  // Quality — per-conversation rates, never blended.
  lines.push("## Quality (a matter of degree — never a gate, never averaged with the axes above)", "");
  const tallies = tallyInvariants(convs);
  for (const t of tallies.filter((x) => x.axis === "quality")) {
    const ev = t.pass.length + t.fail.length;
    const lb = t.inv === "closes_properly" ? " — three conditions at once, a lower bound" : t.inv === "one_question" ? " — two or more '?' in one turn, a lower bound" : "";
    lines.push(`- ${t.inv}: ${t.pass.length} of ${ev} evaluable conversation(s) held${lb} (not provoked ${t.notProvoked}, not evaluable ${t.notEvaluable})`);
  }
  const n = convs.length;
  const withPraise = convs.filter((c) => c.quality.praiseTurns > 0).length;
  const praiseTurns = convs.reduce((s, c) => s + c.quality.praiseTurns, 0);
  const itvTurns = convs.reduce((s, c) => s + c.quality.interviewerTurns, 0);
  const stacked = convs.filter((c) => c.quality.doubleBarrelledTurns > 0).length;
  const closings = convs.filter((c) => c.quality.closingRule !== null);
  lines.push(`- Broad praise TREND counter: ${withPraise} of ${n} conversation(s) had at least one match (${praiseTurns} of ${itvTurns} interviewer turns) — deliberately broad, it over-matches; watch it fall`);
  lines.push(`- Stacked questions (rule, lower bound): ${stacked} of ${n} conversation(s) had a turn with two or more '?'`);
  lines.push(`- Closing by rule (last turn thanks AND hands off to a person): ${closings.filter((c) => c.quality.closingRule).length} of ${closings.length} conversation(s)`);
  lines.push("");

  // Cross-block.
  const records = convs.flatMap((c) => c.crossBlock.map((r) => ({ c, r })));
  const counts = countCrossBlock(records.map((x) => x.r));
  lines.push("## Cross-block cover measurement (not an invariant — never fails a conversation)", "");
  lines.push(`Accepted covers: ${records.length} — ${CROSS_BLOCK_CLASSES.map((k) => `${k} ${counts[k]}`).join(", ")}.`, "");
  lines.push("`late_begin`: the quoted answer was recorded under another block, but the question that prompted it was about the covered block (its question asked before begin_topic — sound evidence, a begins_blocks lapse). `cross_topic`: evidence taken from an answer to a different topic — what a stricter rule would target. `unclassified`: cross-block, unjudged.", "");
  const cross = records.filter((x) => x.r.class !== "same_block");
  if (cross.length) {
    lines.push("| Class | Block | Cover | Answer | Recorded under | Prompting question |", "| --- | --- | --- | --- | --- | --- |");
    for (const { c, r } of cross) {
      const ref = (seq: number | null) => (seq === null ? "—" : `\`${transcriptRef(c.runId, c.situationId, seq)}\``);
      lines.push(`| ${r.class} | ${r.blockId} | ${ref(r.coverSeq)} | ${ref(r.candidateSeq)} | ${r.recordedUnder ?? "(no block)"} | ${ref(r.promptSeq)} |`);
    }
    lines.push("");
  }

  // Voices.
  if (input.voices.length) {
    lines.push("## Character voices", "");
    for (const v of input.voices) lines.push(`- ${v.displayName} (\`${v.path}\`): ${v.status}${v.reason ? ` — ${v.reason}` : ""}${v.status === "ok" ? ` → voices/${v.character}.md` : ""}`);
    lines.push("");
  }

  // What passed.
  lines.push("## What passed", "");
  const held = tallies.filter((t) => t.fail.length === 0 && t.pass.length > 0);
  if (held.length === 0) lines.push("Nothing was evaluable and held.");
  for (const t of held) lines.push(`- ${t.inv} (${t.axis}): pass in ${t.pass.length} of ${t.pass.length} evaluable conversation(s); not provoked ${t.notProvoked}, not evaluable ${t.notEvaluable}`);
  lines.push("");
  lines.push("## Limits", "");
  lines.push("- A text stand-in plays the interviewer: recognition, turn-taking, latency and barge-in are the voice smoke's, not this run's.");
  lines.push("- The candidates are simulated: this shows the policy holds against behaviours someone imagined, not against a real population.");
  lines.push("- `not_provoked` (the behaviour never happened) and `not_evaluable` (the record could not support a verdict) are never counted as a pass, anywhere.");
  lines.push("- The tool never claims `confirmed`: every finding is `uncertain` until the /uat adversarial pass reads its transcript.");
  lines.push("");
  return lines.join("\n");
}
