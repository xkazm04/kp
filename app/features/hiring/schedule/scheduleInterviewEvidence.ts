// Pure derivations for the transcript modal's EVIDENCE half (spark
// ai-interview-parity, WP4) — split from the .tsx so `node --test` can load them, the
// same split `scheduleInterviewTranscriptHelpers.ts` already makes next door.
//
// Everything here is descriptive. Not one function ranks, scores or thresholds an
// observation: they group turns under the agenda block that was live when each was
// spoken, and they count what the record holds. A signal the record does not hold
// comes back `null` — never `0`, which a recruiter would read as a measurement
// (registry: observed-process-is-supporting-not-load-bearing).

import type { EvidenceBlock, EvidenceEvent, InterviewEvidence } from "@/app/_lib/interview-evidence";
import type { VoiceTurn } from "@/app/_lib/voice/types";

export type { EvidenceBlock, EvidenceEvent, InterviewEvidence };

/** Where a rendered transcript turn sits in the director's record. */
export type TurnAnchor = { blockId: string | null; offsetMs: number | null };

const norm = (s: string | undefined | null): string => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** How far ahead of the last matched record turn a transcript turn may be matched.
 *  Bounded on purpose: the two lists are the same conversation in the same order, so a
 *  match is always nearby — and an unbounded scan would let a repeated one-word turn
 *  ("Yes.") anchor itself to an unrelated moment minutes later. */
const ALIGN_LOOKAHEAD = 8;

/**
 * Anchor each turn of the STORED transcript to the agenda block that was live when the
 * director recorded it.
 *
 * The stored transcript stays the rendered list — it is the complete one (the hang-up
 * POST carries turns the live director loop may never have seen, and a resumed call's
 * earlier attempts are seeded into it), and the scorecard's quote→turn jump indexes
 * into it. So the record is aligned ONTO it rather than replacing it: a forward
 * two-pointer walk on (role, normalized text), bounded lookahead, and a transcript turn
 * with no counterpart simply stays unanchored. Nothing is ever dropped or reordered.
 */
export function alignTurnsToBlocks(transcript: readonly VoiceTurn[], record: readonly EvidenceEvent[]): TurnAnchor[] {
  const turns = record.filter((e) => e.kind === "turn");
  const anchors: TurnAnchor[] = transcript.map(() => ({ blockId: null, offsetMs: null }));
  let j = 0;
  for (let i = 0; i < transcript.length; i += 1) {
    const want = norm(transcript[i]?.text);
    if (!want) continue;
    const role = transcript[i]?.role;
    const stop = Math.min(turns.length, j + ALIGN_LOOKAHEAD);
    for (let k = j; k < stop; k += 1) {
      const e = turns[k];
      if (e.role !== role || norm(e.text) !== want) continue;
      anchors[i] = { blockId: e.blockId, offsetMs: e.offsetMs };
      j = k + 1;
      break;
    }
  }
  return anchors;
}

/** One rendered stretch of transcript: an agenda block (possibly with no turns of its
 *  own — an untouched block is a fact worth showing) or a run of turns that belong to
 *  no block, which is the ordinary shape of the greeting and of the gaps between
 *  topics. */
export type TranscriptSection =
  | { kind: "block"; block: EvidenceBlock; turns: number[] }
  | { kind: "off"; turns: number[] };

/**
 * The transcript as sections. Blocks come in AGENDA order; each run of unanchored turns
 * is placed where it actually happened, before the first block section whose turns
 * start later, so the greeting reads first and a mid-call gap reads mid-call.
 *
 * Total turn count is conserved: every index of `anchors` lands in exactly one section.
 */
export function groupTranscriptByBlock(anchors: readonly TurnAnchor[], blocks: readonly EvidenceBlock[]): TranscriptSection[] {
  const known = new Map(blocks.map((b) => [b.id, b]));
  const byBlock = new Map<string, number[]>();
  const runs: number[][] = [];
  let run: number[] | null = null;
  for (let i = 0; i < anchors.length; i += 1) {
    const id = anchors[i]?.blockId;
    if (id && known.has(id)) {
      const list = byBlock.get(id);
      if (list) list.push(i);
      else byBlock.set(id, [i]);
      run = null;
      continue;
    }
    if (run) run.push(i);
    else {
      run = [i];
      runs.push(run);
    }
  }

  // Each block section's position in the conversation: its own first turn, or — for a
  // block nothing was recorded under — the one before it, so an untouched block stays
  // between its agenda neighbours instead of being flushed to the end.
  let carry = -1;
  const sections = blocks.map((b) => {
    const turns = byBlock.get(b.id) ?? [];
    if (turns.length > 0) carry = turns[0];
    return { section: { kind: "block" as const, block: b, turns }, at: carry };
  });

  const out: TranscriptSection[] = [];
  let bi = 0;
  for (const r of runs) {
    while (bi < sections.length && sections[bi].at <= r[0]) out.push(sections[bi++].section);
    out.push({ kind: "off", turns: r });
  }
  while (bi < sections.length) out.push(sections[bi++].section);
  return out;
}

// ---- observations ------------------------------------------------------------------

/** One departure from the interview tab. `awayMs` is null when the return carried no
 *  measurable span (the browser records `0` for "the departure was not recorded", and
 *  a call that ended while the tab was away never records a return at all) — null, not
 *  zero, because "away for no time" is a claim nobody made. */
export type FocusDeparture = { blockId: string | null; offsetMs: number | null; during: string | null; awayMs: number | null };

export type FocusSummary = {
  departures: FocusDeparture[];
  /** Summed over the departures whose span was measurable. Null when none was. */
  totalAwayMs: number | null;
  /** How many departures have no measurable span — printed rather than hidden. */
  unmeasured: number;
};

/** Pair each `focus_lost` with the `focus_returned` that follows it. */
export function summarizeFocus(events: readonly EvidenceEvent[]): FocusSummary {
  const departures: FocusDeparture[] = [];
  let pending: FocusDeparture | null = null;
  for (const e of events) {
    if (e.kind === "focus_lost") {
      pending = { blockId: e.blockId, offsetMs: e.offsetMs, during: e.during ?? null, awayMs: null };
      departures.push(pending);
      continue;
    }
    if (e.kind !== "focus_returned") continue;
    const away = typeof e.awayMs === "number" && e.awayMs > 0 ? e.awayMs : null;
    if (pending) {
      pending.awayMs = away;
      pending = null;
    } else {
      // A return with no departure on the record: the browser collapsed a blur and a
      // visibilitychange, or the departure row was lost. It still happened.
      departures.push({ blockId: e.blockId, offsetMs: e.offsetMs, during: null, awayMs: away });
    }
  }
  const measured = departures.filter((d) => d.awayMs !== null);
  return {
    departures,
    totalAwayMs: measured.length > 0 ? measured.reduce((sum, d) => sum + (d.awayMs ?? 0), 0) : null,
    unmeasured: departures.length - measured.length,
  };
}

/** Answer timing for one agenda block. Both medians are null when the provider exposed
 *  no boundary to measure from — the whole reason `preSilenceMs`/`durationMs` are
 *  nullable all the way from the browser. */
export type TimingRow = {
  blockId: string | null;
  /** Candidate turns this block timed at all. */
  answers: number;
  preSilenceMs: number | null;
  preSilenceSamples: number;
  durationMs: number | null;
  durationSamples: number;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Answer timing grouped by the block that was live, in first-seen order. MEDIAN, not
 *  mean: one 90-second story should not redraw a block's typical answer. */
export function summarizeAnswerTiming(events: readonly EvidenceEvent[]): TimingRow[] {
  const order: (string | null)[] = [];
  const pre = new Map<string | null, number[]>();
  const dur = new Map<string | null, number[]>();
  const counts = new Map<string | null, number>();
  for (const e of events) {
    if (e.kind !== "answer_timing") continue;
    const key = e.blockId;
    if (!counts.has(key)) {
      order.push(key);
      counts.set(key, 0);
      pre.set(key, []);
      dur.set(key, []);
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (typeof e.preSilenceMs === "number" && e.preSilenceMs >= 0) pre.get(key)!.push(e.preSilenceMs);
    if (typeof e.durationMs === "number" && e.durationMs >= 0) dur.get(key)!.push(e.durationMs);
  }
  return order.map((key) => {
    const p = pre.get(key) ?? [];
    const d = dur.get(key) ?? [];
    return {
      blockId: key,
      answers: counts.get(key) ?? 0,
      preSilenceMs: median(p),
      preSilenceSamples: p.length,
      durationMs: median(d),
      durationSamples: d.length,
    };
  });
}

/** A whole-call clock code, `m:ss` (or `h:mm:ss` past an hour). Digits only, so it
 *  carries no words to translate — the label around it does. */
export function clockLabel(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null;
  const total = Math.floor(ms / 1000);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
