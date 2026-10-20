// What a staged Regenerate would change, computed BEFORE the swap (r09
// schedule-interview-prep/B). The registry technique regenerate-without-destroying-
// human-notes, step 6: "Report what changed. A merge that reports nothing is
// functionally indistinguishable from one that destroyed everything."
//
// Every consequence here is computed with the rules the post-swap render uses, so the
// preview and what the interviewer then sees cannot disagree:
//  - woven questions: splitImported (scheduleInterviewPrepProgress.ts) against the
//    candidate's block topics — a question whose topic vanished falls back to unassigned;
//  - ticks: the `c-<i>` / `k-<i>` / `w-<i>` index keys prepProgress and the run-of-show
//    render with. A tick keyed by index either has no item left (detached) or silently
//    lands on a DIFFERENT item at that index (moved). Only ticks on items the current
//    plan renders count, exactly as the meter's numerator does.
// Pure, no React, so the modal and its tests share one copy.

import type { ImportedEntry, Prep } from "./scheduleInterviewPrepTypes";
import { splitImported } from "./scheduleInterviewPrepProgress";

/** The generator-owned half of a pack the diff reads. */
export type PlanShape = Pick<Prep, "chronology" | "signals" | "durationMin" | "scenario" | "source">;

export type MinuteRange = { fromMin: number; toMin: number };

export type PlanDiff = {
  /** Block topics the candidate has and the current plan does not. */
  added: string[];
  /** Block topics the current plan has and the candidate drops. */
  removed: string[];
  /** Topics in both whose minute range moved. */
  retimed: { topic: string; from: MinuteRange; to: MinuteRange }[];
  /** Topics in both, same range, whose goal, questions or follow-up were rewritten. */
  reworded: string[];
  signalsAdded: string[];
  signalsRemoved: string[];
  scenarioChanged: boolean;
  /** Woven imported questions that would return to unassigned after the swap. */
  wovenOrphaned: string[];
  /** Ticked items that would have nothing left to tick. */
  checkedDetached: number;
  /** Ticked items whose index would now hold a different item. */
  checkedMoved: number;
  durationFrom: number;
  durationTo: number;
  sourceFrom: string | null;
  sourceTo: string | null;
  /** Nothing above differs: the regeneration produced the same plan. */
  isNoop: boolean;
};

type Block = PlanShape["chronology"][number];

function firstByTopic(blocks: readonly Block[]): Map<string, Block> {
  const m = new Map<string, Block>();
  for (const b of blocks) if (!m.has(b.topic)) m.set(b.topic, b);
  return m;
}

function sameWording(a: Block, b: Block): boolean {
  return a.goal === b.goal && (a.followUp ?? "") === (b.followUp ?? "") && JSON.stringify(a.questions ?? []) === JSON.stringify(b.questions ?? []);
}

/** Diff the committed plan against a staged candidate. `checked` is the interviewer's
 *  tick map; `imported` the normalized imported questions (woven ones carry blockRef). */
export function computePlanDiff(
  current: PlanShape,
  candidate: PlanShape,
  checked: Readonly<Record<string, boolean>>,
  imported: readonly ImportedEntry[]
): PlanDiff {
  const curBlocks = current.chronology ?? [];
  const candBlocks = candidate.chronology ?? [];
  const curByTopic = firstByTopic(curBlocks);
  const candByTopic = firstByTopic(candBlocks);

  const added = [...candByTopic.keys()].filter((t) => !curByTopic.has(t));
  const removed = [...curByTopic.keys()].filter((t) => !candByTopic.has(t));
  const retimed: PlanDiff["retimed"] = [];
  const reworded: string[] = [];
  for (const [topic, a] of curByTopic) {
    const b = candByTopic.get(topic);
    if (!b) continue;
    if (a.fromMin !== b.fromMin || a.toMin !== b.toMin) {
      retimed.push({ topic, from: { fromMin: a.fromMin, toMin: a.toMin }, to: { fromMin: b.fromMin, toMin: b.toMin } });
    } else if (!sameWording(a, b)) {
      reworded.push(topic);
    }
  }

  const curSignals = current.signals ?? [];
  const candSignals = candidate.signals ?? [];
  const signalsAdded = candSignals.filter((s) => !curSignals.includes(s));
  const signalsRemoved = curSignals.filter((s) => !candSignals.includes(s));

  const curWoven = splitImported([...imported], new Set(curBlocks.map((b) => b.topic))).woven;
  const candWoven = splitImported([...imported], new Set(candBlocks.map((b) => b.topic))).woven;
  const candWovenSet = new Set(candWoven.map((e) => e.question));
  const wovenOrphaned = curWoven.filter((e) => !candWovenSet.has(e.question)).map((e) => e.question);

  // Ticks on items the CURRENT plan renders, walked the way prepProgress walks them.
  let checkedDetached = 0;
  let checkedMoved = 0;
  const tally = (key: string, i: number, candLen: number, same: () => boolean) => {
    if (!checked[key]) return;
    if (i >= candLen) checkedDetached += 1;
    else if (!same()) checkedMoved += 1;
  };
  curBlocks.forEach((b, i) => tally(`c-${i}`, i, candBlocks.length, () => candBlocks[i].topic === b.topic));
  curSignals.forEach((s, i) => tally(`k-${i}`, i, candSignals.length, () => candSignals[i] === s));
  curWoven.forEach((w, i) => tally(`w-${i}`, i, candWoven.length, () => candWoven[i].question === w.question));

  const scenarioChanged = (current.scenario ?? "") !== (candidate.scenario ?? "");
  const sourceFrom = current.source ?? null;
  const sourceTo = candidate.source ?? null;
  const durationFrom = current.durationMin;
  const durationTo = candidate.durationMin;
  const isNoop =
    added.length === 0 &&
    removed.length === 0 &&
    retimed.length === 0 &&
    reworded.length === 0 &&
    signalsAdded.length === 0 &&
    signalsRemoved.length === 0 &&
    wovenOrphaned.length === 0 &&
    checkedDetached === 0 &&
    checkedMoved === 0 &&
    !scenarioChanged &&
    sourceFrom === sourceTo &&
    durationFrom === durationTo &&
    // Order matters to the interviewer: the same blocks reshuffled is a real change.
    JSON.stringify(curBlocks.map((b) => b.topic)) === JSON.stringify(candBlocks.map((b) => b.topic));

  return {
    added,
    removed,
    retimed,
    reworded,
    signalsAdded,
    signalsRemoved,
    scenarioChanged,
    wovenOrphaned,
    checkedDetached,
    checkedMoved,
    durationFrom,
    durationTo,
    sourceFrom,
    sourceTo,
    isNoop,
  };
}
