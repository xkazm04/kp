"use client";

// /one round 4 — the tools' READS (hooks over EXISTING routes + the one new door). Pure
// parsers live in tools/parse.ts (unit-tested); every hook goes through the panels' read
// primitive (panels/read.ts): loading / ready / error, a body it does not recognise is an
// error, two views on the same URL share ONE request, `epoch` re-reads after a data act.
//
// Nothing here writes. The acts these tools offer (approve, send, book, send a link) arm a
// consent card; only its press reaches a write door (consent/doors.ts).
import { useMemo, useState } from "react";
import { parsePipeline, type OneEntry } from "../panels/pipelineRead";
import { useRead, type Read } from "../panels/read";
import {
  calendarWeeks,
  groupByRole,
  parseInvites,
  parseLetter,
  parseLettersList,
  parseProfile,
  parseSlots,
  parseThread,
  parseTimelineAnalysis,
  profileSlug,
  suggestBooking,
  waitingForInterview,
  weekDays,
  type CalendarDay,
  type Invite,
  type LetterRead,
  type LettersRead,
  type ProfileSummary,
  type Slot,
  type SlotsRead,
  type ThreadMessage,
} from "./parse";

export * from "./parse";

export const PIPELINE_URL = "/api/pipeline";
export const SCHEDULE_URL = "/api/schedule?limit=200";
export const SLOTS_URL = "/api/schedule?slots=1";
export const LETTERS_URL = "/api/outreach-letters?state=drafted&limit=200";

type Retry = { retry: () => void };

/** The shared pipeline read (the same request every pipeline view makes). */
export function usePipeline(epoch: number): Read<{ entries: OneEntry[] }> & Retry {
  return useRead(PIPELINE_URL, parsePipeline, epoch);
}

/* ── profile ─────────────────────────────────────────────────────────────── */

export type ProfileState =
  | { state: "loading" }
  | { state: "error"; read: Read<unknown> & Retry }
  /** No analysis on record for this candidate. */
  | { state: "none" }
  | ({ state: "ready"; labelOnly: boolean; source: "timeline" | "seed" } & ProfileSummary);

/** The candidate's profile: the analysis the timeline links to the entry (else the seeded one
 *  keyed by their own id), read through GET /api/analyses/[slug]. The CV preview is the
 *  analysis TEXT (`candidate.rawText`) — there is no CV file store. */
export function useProfile(entryId: string | null, candidateId: string | null, epoch: number): ProfileState {
  const timeline = useRead(entryId ? `/api/pipeline/${encodeURIComponent(entryId)}/timeline` : null, parseTimelineAnalysis, epoch);
  const pick = timeline.state === "ready" ? profileSlug(timeline.data, candidateId) : null;
  const analysis = useRead(pick ? `/api/analyses/${encodeURIComponent(pick.slug)}` : null, parseProfile, epoch);
  if (!entryId) return { state: "none" };
  if (timeline.state === "loading") return { state: "loading" };
  if (timeline.state === "error") return { state: "error", read: timeline };
  if (!pick) return { state: "none" };
  if (analysis.state === "loading") return { state: "loading" };
  if (analysis.state === "error") {
    // A seeded slug that is not there is "no analysis", not a failure.
    return analysis.payload?.code === "ANALYSIS_NOT_FOUND" ? { state: "none" } : { state: "error", read: analysis };
  }
  return { state: "ready", labelOnly: pick.labelOnly, source: pick.source, ...analysis.data };
}

/* ── letters ─────────────────────────────────────────────────────────────── */

/** The outreach letters waiting for approval (GET /api/outreach-letters?state=drafted). */
export function useLettersWaiting(epoch: number): Read<LettersRead> & Retry {
  return useRead(LETTERS_URL, parseLettersList, epoch);
}

export type LetterToolRead = {
  /** The held outreach letter (`letter: null` = none is held for this candidate). */
  letter: Read<LetterRead> & Retry;
  /** What the candidate was already sent, with the one delivery verdict per message. */
  thread: Read<{ messages: ThreadMessage[]; relayConfigured: boolean | null }> & Retry;
};

/** One candidate's held outreach letter (the same URL the letter tool and a letter's consent
 *  card read, so they share one request). */
export function useHeldLetter(entryId: string | null, epoch: number): Read<LetterRead> & Retry {
  return useRead(entryId ? `/api/outreach-letters/by-entry/${encodeURIComponent(entryId)}` : null, parseLetter, epoch);
}

/** One candidate's held outreach letter + their message thread. Only the outreach letter is
 *  held today; rejection and interview letters are not drafts a person approves. */
export function useLetter(entryId: string | null, epoch: number): LetterToolRead {
  const letter = useHeldLetter(entryId, epoch);
  const thread = useRead(entryId ? `/api/comms?entry=${encodeURIComponent(entryId)}&limit=20` : null, parseThread, epoch);
  return { letter, thread };
}

/* ── calendar ────────────────────────────────────────────────────────────── */

export type CalendarState =
  | { state: "loading" }
  | { state: "error"; read: Read<unknown> & Retry }
  | {
      state: "ready";
      zone: string;
      /** The schedule read hit its page cap: there may be interviews it did not return. */
      truncated: boolean;
      /** The weeks the pager walks (this week → the offer horizon) and the one in view. */
      weekCount: number;
      week: number;
      days: CalendarDay[];
      invites: Invite[];
      /** The free pool (null when that read failed — the grid then shows interviews only). */
      slots: Slot[] | null;
      calendarStatus: SlotsRead["calendarStatus"];
      /** Active entries on the `calendar` gate, longest waiting first, and grouped by role. */
      waiting: OneEntry[];
      waitingByRole: { role: string | null; rows: OneEntry[] }[];
      suggestion: ReturnType<typeof suggestBooking>;
    };

/** The interview calendar: confirmed + pending invites by day for one week (client-side over
 *  the ONE schedule read), the free slots of the pool, and who is waiting for a slot. The
 *  interview zone is the server's (`interviewTz`), never the browser's. */
export function useCalendar(epoch: number, week: number): CalendarState & { setWeek: (w: number) => void } {
  const schedule = useRead(SCHEDULE_URL, parseInvites, epoch);
  const slots = useRead(SLOTS_URL, parseSlots, epoch);
  const pipeline = usePipeline(epoch);
  const [now] = useState(() => Date.now());
  // null = not paged yet: open on the first week with a day still ahead (on a weekend the
  // grid's first week is all past).
  const [wk, setWk] = useState<number | null>(week > 0 ? week : null);
  const zone = schedule.state === "ready" ? (schedule.data.zone ?? "Europe/Prague") : null;
  const weeks = useMemo(() => (zone ? calendarWeeks(now, zone) : []), [now, zone]);
  const firstAhead = Math.max(0, weeks.findIndex((w) => w.some((d) => !d.past)));
  const out = ((): CalendarState => {
    if (schedule.state === "loading" || pipeline.state === "loading" || slots.state === "loading") return { state: "loading" };
    if (schedule.state === "error") return { state: "error", read: schedule };
    if (pipeline.state === "error") return { state: "error", read: pipeline };
    const z = zone ?? "Europe/Prague";
    const at = Math.min(Math.max(0, wk ?? firstAhead), Math.max(0, weeks.length - 1));
    const pool = slots.state === "ready" ? slots.data.slots : null;
    const waiting = waitingForInterview(pipeline.data.entries);
    return {
      state: "ready",
      zone: z,
      truncated: schedule.data.truncated,
      weekCount: weeks.length,
      week: at,
      days: weeks[at] ? weekDays(weeks[at], schedule.data.invites, pool ?? [], z) : [],
      invites: schedule.data.invites,
      slots: pool,
      calendarStatus: slots.state === "ready" ? slots.data.calendarStatus : null,
      waiting,
      waitingByRole: groupByRole(waiting, (e) => e.jobTitle),
      suggestion: pool ? suggestBooking(waiting, pool, z) : null,
    };
  })();
  return { ...out, setWeek: setWk };
}

/** The interview tool's read for one candidate: their invites, the free pool, and whether
 *  they stand on the calendar gate. */
export function useInterview(entryId: string | null, epoch: number) {
  const schedule = useRead(SCHEDULE_URL, parseInvites, epoch);
  const slots = useRead(SLOTS_URL, parseSlots, epoch);
  const pipeline = usePipeline(epoch);
  if (!entryId) return { state: "none" as const };
  if (schedule.state === "loading" || pipeline.state === "loading" || slots.state === "loading") return { state: "loading" as const };
  if (schedule.state === "error") return { state: "error" as const, read: schedule };
  if (pipeline.state === "error") return { state: "error" as const, read: pipeline };
  const entry = pipeline.data.entries.find((e) => e.id === entryId) ?? null;
  return {
    state: "ready" as const,
    zone: schedule.data.zone ?? "Europe/Prague",
    entry,
    invites: schedule.data.invites.filter((i) => i.entryId === entryId),
    slots: slots.state === "ready" ? slots.data.slots : null,
    slotsRead: slots,
    calendarStatus: slots.state === "ready" ? slots.data.calendarStatus : null,
  };
}

