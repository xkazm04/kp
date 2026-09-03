// The prep modal's HYDRATION and PROGRESS arithmetic, lifted out of
// useScheduleInterviewPrep.ts (/perfect 2026-09-03, schedule-ui-2).
//
// Three rules lived inside a "use client" hook and were therefore untestable, while
// each of them has already been wrong in a way a user saw:
//
//  1. HYDRATION — which of the fetched payload's fields seed the interviewer's editable
//     state, and what an absent/garbage field means. The same rule runs twice (once on
//     the initial GET, once when a regeneration's result lands and carries the progress
//     forward), and the two copies drifting is how a regenerate could wipe a note.
//  2. THE DENOMINATOR — chronology blocks + signals + WOVEN imported questions.
//  3. THE NUMERATOR — only keys that map to a CURRENTLY-rendered item count. Counting
//     every truthy key in the stored map let a payload whose plan shrank (but which
//     kept its older userProgress keys) render "9/6 done" and a >100% meter.
//
// Pure, so the modal, its tests and any future surface share one copy. No React here.

import type { ImportedEntry, Prep } from "./scheduleInterviewPrepTypes";

/** The interviewer's editable state on a prep pack. */
export type PrepEditableState = { checked: Record<string, boolean>; notes: string; interviewer: string };

/** The empty state — an unhydrated modal, and what a regeneration with no carried
 *  progress resets to. A fresh object each call: the caller holds it in React state. */
export function emptyPrepState(): PrepEditableState {
  return { checked: {}, notes: "", interviewer: "" };
}

/** Seed the editable state from a prep payload. Tolerant by construction — a payload
 *  is JSON from the store and may predate any of these keys, or be half-written:
 *  a missing/ill-typed `notes` is "", a missing `interviewer` is "", a missing
 *  `userProgress.checked` is {}. Never throws, so hydration cannot break the modal. */
export function hydratePrepState(payload: Prep | null | undefined): PrepEditableState {
  const up = payload?.userProgress;
  const rawChecked = up?.checked;
  const checked: Record<string, boolean> = {};
  if (rawChecked && typeof rawChecked === "object") {
    for (const [k, v] of Object.entries(rawChecked)) if (v === true) checked[k] = true;
  }
  return {
    checked,
    notes: typeof up?.notes === "string" ? up.notes : "",
    interviewer: typeof payload?.interviewer === "string" ? payload.interviewer : "",
  };
}

/** Split normalized imported questions into the ones WOVEN into a chronology block and
 *  the ones still unassigned. A blockRef that no longer matches any current block topic
 *  (a Regenerate reshaped the plan) degrades to unassigned, so the question is shown
 *  again rather than silently lost — its content always survives in importedQuestions. */
export function splitImported(
  entries: ImportedEntry[],
  blockTopics: ReadonlySet<string>
): { woven: ImportedEntry[]; unassigned: ImportedEntry[] } {
  const woven: ImportedEntry[] = [];
  const unassigned: ImportedEntry[] = [];
  for (const e of entries) {
    if (e.blockRef && blockTopics.has(e.blockRef)) woven.push(e);
    else unassigned.push(e);
  }
  return { woven, unassigned };
}

/** The checkbox key for a woven question: its index in the woven list, like the
 *  chronology's `c-<i>` and the signals' `k-<i>`. Index, not the question text — the
 *  PUT route caps a checked key at 64 chars. `-1` for a question that is not woven,
 *  which no rendered checkbox can ever carry. */
export function wovenKeyOf(woven: readonly ImportedEntry[], question: string): string {
  return `w-${woven.findIndex((e) => e.question === question)}`;
}

/** How many items the completion meter counts, and how many are done.
 *
 *  `done` walks the CURRENTLY-RENDERED item keys and asks the stored map about each,
 *  rather than counting the map's own truthy entries — the stored map legitimately
 *  outlives the plan that produced it (a progress save never regenerates, and a
 *  regeneration carries progress forward), so its keys are a superset, never the
 *  denominator. */
export function prepProgress(
  prep: Prep | null | undefined,
  wovenCount: number,
  checked: Record<string, boolean>
): { total: number; done: number } {
  if (!prep) return { total: 0, done: 0 };
  const blocks = prep.chronology?.length ?? 0;
  const signals = prep.signals?.length ?? 0;
  const woven = Math.max(0, wovenCount);
  let done = 0;
  for (let i = 0; i < blocks; i += 1) if (checked[`c-${i}`]) done += 1;
  for (let i = 0; i < signals; i += 1) if (checked[`k-${i}`]) done += 1;
  for (let i = 0; i < woven; i += 1) if (checked[`w-${i}`]) done += 1;
  return { total: blocks + signals + woven, done };
}
