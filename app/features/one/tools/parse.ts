// /one round 4 — the PURE half of the tools' reads (tools/reads.ts holds the hooks).
//
// Every parser folds an EXISTING route's body (plus the one new door,
// GET /api/outreach-letters) into the shape a tool draws, and answers null for a body it
// does not recognise — the read primitive (panels/read.ts) turns that into an error, never
// into a calm "nothing here". Nothing is invented: a field the route did not return stays
// null and the UI draws a dash with its reason.
//
// Import-light on purpose (the score scale, the comms verdict and the date-slot helper are
// pure modules), so node:test reads it directly (tools/parse.test.ts).
import { commsVerdict, type CommsVerdict } from "@/app/_lib/comms-view";
import type { OutboxStatus } from "@/app/_lib/comms-status";
import { scoreTone, type ScoreTone } from "@/app/_lib/format";
import { isoToDateSlot, scheduleGridWeeks, type GridDate } from "@/app/_lib/schedule-slots";
import { resolveVerdict } from "@/app/_components/results/verdict";
import type { Analysis } from "@/app/_lib/schemas";
import { byKnownTimeFirst, type OneEntry } from "../panels/pipelineRead";

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);

/* ── letters ─────────────────────────────────────────────────────────────── */

export const LETTER_STATES = ["drafted", "approved", "released", "delivery_failed", "suppressed", "discarded"] as const;
export type LetterState = (typeof LETTER_STATES)[number];
const isLetterState = (v: unknown): v is LetterState => (LETTER_STATES as readonly unknown[]).includes(v);

/** One row of GET /api/outreach-letters (the queue — no body). */
export type LetterItem = {
  id: string;
  entryId: string;
  candidateLabel: string;
  jobTitle: string | null;
  subject: string | null;
  state: LetterState;
  revision: number;
  createdAt: string;
};
export type LettersRead = { letters: LetterItem[]; truncated: boolean };

export function parseLettersList(body: unknown): LettersRead | null {
  const b = obj(body);
  if (!b || !Array.isArray(b.letters)) return null;
  const letters: LetterItem[] = [];
  for (const raw of b.letters) {
    const l = obj(raw);
    if (!l) continue;
    const id = str(l.id);
    const entryId = str(l.entryId);
    const revision = num(l.revision);
    const createdAt = str(l.createdAt);
    if (!id || !entryId || revision === null || !createdAt || !isLetterState(l.state)) continue;
    letters.push({ id, entryId, candidateLabel: str(l.candidateLabel) ?? entryId, jobTitle: str(l.jobTitle), subject: str(l.subject), state: l.state, revision, createdAt });
  }
  return { letters, truncated: b.truncated === true };
}

/** Where a release would deliver the letter (letter-view.ts `forecast`). */
export const LETTER_FORECASTS = ["refused", "simulation", "suppressed", "relay", "local"] as const;
export type LetterForecast = (typeof LETTER_FORECASTS)[number];

export type HeldLetter = {
  id: string;
  entryId: string;
  state: LetterState;
  revision: number;
  subject: string | null;
  /** The stored draft (the model's or a person's text). */
  body: string | null;
  lang: string | null;
  approvedAt: string | null;
  releasedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type LetterPreview = {
  subject: string;
  /** The exact letter a release would send: the draft plus the legal footers. */
  body: string;
  recipient: string | null;
  /** The language the letter is sent in (the comms locale it resolves to). */
  locale: string | null;
  forecast: LetterForecast | null;
  forecastReason: string | null;
};
/** GET /api/outreach-letters/by-entry/[entryId]: `letter: null` = none is held for them. */
export type LetterRead = { letter: HeldLetter | null; preview: LetterPreview | null };

export function parseLetter(body: unknown): LetterRead | null {
  const b = obj(body);
  if (!b || !("letter" in b)) return null;
  if (b.letter === null) return { letter: null, preview: null };
  const l = obj(b.letter);
  if (!l) return null;
  const id = str(l.id);
  const entryId = str(l.entryId);
  const revision = num(l.revision);
  if (!id || !entryId || revision === null || !isLetterState(l.state)) return null;
  const letter: HeldLetter = {
    id,
    entryId,
    state: l.state,
    revision,
    subject: str(l.subject),
    body: str(l.body),
    lang: str(l.lang),
    approvedAt: str(l.approvedAt),
    releasedAt: str(l.releasedAt),
    createdAt: str(l.createdAt) ?? "",
    updatedAt: str(l.updatedAt) ?? "",
  };
  const p = obj(b.preview);
  const forecast = p && (LETTER_FORECASTS as readonly unknown[]).includes(p.forecast) ? (p.forecast as LetterForecast) : null;
  const preview: LetterPreview | null = p
    ? { subject: str(p.subject) ?? "", body: str(p.body) ?? "", recipient: str(p.recipient), locale: str(p.locale), forecast, forecastReason: str(p.forecastReason) }
    : null;
  return { letter, preview };
}

/** Which act a held letter offers next: approve a draft, send an approved one (or retry a
 *  release that did not land), or nothing (released / discarded / erased text). */
export function letterNextAct(l: HeldLetter | null): "approve" | "send" | null {
  if (!l || l.body === null) return null;
  if (l.state === "drafted") return "approve";
  if (l.state === "approved" || l.state === "delivery_failed" || l.state === "suppressed") return "send";
  return null;
}

/** Does the letter on screen still match the act a consent card was armed with? An approve
 *  needs the SAME letter at the SAME revision, still a draft; a send needs it approved (or a
 *  release that did not land). The card agrees to what it shows, so a mismatch disables it. */
export function letterMatches(act: { act: "letterApprove" | "letterSend"; letterId: string; revision: number | null }, l: HeldLetter | null): boolean {
  if (!l || l.id !== act.letterId || l.body === null) return false;
  if (act.revision !== null && l.revision !== act.revision) return false;
  return act.act === "letterApprove" ? l.state === "drafted" : letterNextAct(l) === "send";
}

/** One message the candidate was sent (GET /api/comms?entry=), with the ONE delivery verdict. */
export type ThreadMessage = { id: string; kind: string | null; subject: string | null; verdict: CommsVerdict; at: string };

export function parseThread(body: unknown): { messages: ThreadMessage[]; relayConfigured: boolean | null } | null {
  const b = obj(body);
  if (!b || !Array.isArray(b.messages)) return null;
  const messages: ThreadMessage[] = [];
  for (const raw of b.messages) {
    const m = obj(raw);
    if (!m) continue;
    const id = str(m.id);
    const status = str(m.status);
    const at = str(m.createdAt);
    if (!id || !status || !at) continue;
    messages.push({
      id,
      kind: str(m.kind),
      subject: str(m.subject),
      verdict: commsVerdict({ status: status as OutboxStatus, bounced: m.bounced === true, recovered: m.recovered === true, orphaned: m.orphaned === true }),
      at,
    });
  }
  return { messages, relayConfigured: typeof b.relayConfigured === "boolean" ? b.relayConfigured : null };
}

/* ── profile ─────────────────────────────────────────────────────────────── */

/** The analysis the timeline links to an entry: `slug` + whether it was matched by the
 *  candidate's NAME alone (it may belong to a same-named stranger). `none` = no link. */
export type TimelineLink = { slug: string; labelOnly: boolean } | { slug: null };

export function parseTimelineAnalysis(body: unknown): TimelineLink | null {
  const b = obj(body);
  if (!b || !Array.isArray(b.items)) return null;
  const found = (b.items as unknown[])
    .map(obj)
    .filter((i): i is Record<string, unknown> => i !== null && i.kind === "analysis" && typeof i.slug === "string")
    // The confirmed link first, then the newest.
    .sort((a, b) => Number(a.labelOnly === true) - Number(b.labelOnly === true) || String(b.at ?? "").localeCompare(String(a.at ?? "")));
  const top = found[0];
  return top ? { slug: top.slug as string, labelOnly: top.labelOnly === true } : { slug: null };
}

/** The analysis' five score parts and their maxima (pipeline/jobfit/pipeline.py
 *  `_score_from_payload` clamps — they sum to 100). */
export const SCORE_PARTS = [
  { key: "experience", max: 25 },
  { key: "skills", max: 30 },
  { key: "roleSeniority", max: 23 },
  { key: "education", max: 12 },
  { key: "traits", max: 10 },
] as const;
export type ScorePartKey = (typeof SCORE_PARTS)[number]["key"];

export type SoftSignal = { key: string; side: "strength" | "watch"; label: string; detail: string | null };

export type ProfileSummary = {
  slug: string;
  candidateLabel: string | null;
  /** The CV as the analysis read it — there is no CV file store; this IS the preview. */
  cvText: string | null;
  verdict: { overall: number | null; jobFit: number | null; tone: ScoreTone };
  total: number | null;
  parts: { key: ScorePartKey; value: number; max: number }[];
  jobFit: { score: number | null; summary: string | null; matching: string[]; missing: string[]; unproven: string[] } | null;
  strengths: string[];
  gaps: string[];
  softSignals: SoftSignal[];
  skills: string[];
  roleFamily: string | null;
  seniority: string | null;
  /** Which producer made it: "llm" | "deterministic" | null (unknown — never shown as either). */
  engine: string | null;
  createdAt: string | null;
};

export function parseProfile(body: unknown): ProfileSummary | null {
  const b = obj(body);
  const slug = b ? str(b.slug) : null;
  const a = b ? obj(b.analysis) : null;
  if (!b || !slug || !a) return null;
  const cand = obj(a.candidate);
  const score = obj(a.score);
  const jf = obj(a.jobFit);
  const parts = SCORE_PARTS.flatMap((p) => {
    const v = score ? num(score[p.key]) : null;
    return v === null ? [] : [{ key: p.key, value: v, max: p.max }];
  });
  let verdict: ProfileSummary["verdict"] = { overall: null, jobFit: null, tone: "null" };
  try {
    // The ONE verdict rule the report's banner uses (reconciled component sum, a blocked
    // score is unscored, a comparison's winner). A payload it cannot read is unscored.
    const v = resolveVerdict(a as unknown as Analysis);
    verdict = { overall: v.overall, jobFit: v.jobFit ?? null, tone: scoreTone(v.overall) };
  } catch {
    /* an unreadable payload is unscored, never a fabricated band */
  }
  const soft = obj(a.softSignals);
  const signal = (side: SoftSignal["side"]) => (raw: unknown): SoftSignal[] => {
    const s = obj(raw);
    const label = s ? str(s.label) : null;
    return s && label ? [{ key: `${side}-${str(s.key) ?? label}`, side, label, detail: str(s.detail) }] : [];
  };
  return {
    slug,
    candidateLabel: str(b.candidateLabel),
    cvText: cand ? str(cand.rawText) : null,
    verdict,
    total: verdict.overall,
    parts,
    jobFit: jf
      ? {
          score: num(jf.score),
          summary: str(jf.summary),
          matching: strings(jf.matchingSkills),
          missing: strings(jf.missingSkills),
          unproven: strings(jf.unprovenSkills),
        }
      : null,
    strengths: strings(a.strengths),
    gaps: strings(a.gaps),
    softSignals: soft
      ? [...(Array.isArray(soft.strengths) ? soft.strengths.flatMap(signal("strength")) : []), ...(Array.isArray(soft.antipatterns) ? soft.antipatterns.flatMap(signal("watch")) : [])]
      : [],
    skills: cand ? strings(cand.skills) : [],
    roleFamily: str(b.roleFamily),
    seniority: str(b.seniority),
    engine: str(b.engine),
    createdAt: str(b.createdAt),
  };
}

/** The analysis to read for an entry: the timeline's link, else the seeded analysis keyed by
 *  the candidate's own id (`seed-<candidateId>`, the demo corpus), else none. */
export function profileSlug(link: TimelineLink, candidateId: string | null): { slug: string; labelOnly: boolean; source: "timeline" | "seed" } | null {
  if (link.slug) return { slug: link.slug, labelOnly: link.labelOnly, source: "timeline" };
  return candidateId ? { slug: `seed-${candidateId}`, labelOnly: false, source: "seed" } : null;
}

/* ── calendar ────────────────────────────────────────────────────────────── */

export const INVITE_STATUSES = ["pending", "confirmed", "declined", "no_show"] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

export type Invite = {
  id: string;
  entryId: string | null;
  label: string | null;
  jobTitle: string | null;
  status: InviteStatus;
  /** Null for a pending link nobody has picked a time on yet. */
  slotAt: string | null;
  durationMin: number | null;
  meetingUrl: string | null;
};
export type ScheduleRead = { invites: Invite[]; zone: string | null; truncated: boolean };

/** GET /api/schedule?limit=200 — every invite (the calendar filters it client-side). */
export function parseInvites(body: unknown): ScheduleRead | null {
  const b = obj(body);
  if (!b || !Array.isArray(b.invites)) return null;
  const invites: Invite[] = [];
  for (const raw of b.invites) {
    const i = obj(raw);
    if (!i) continue;
    const id = str(i.id);
    if (!id || !(INVITE_STATUSES as readonly unknown[]).includes(i.status)) continue;
    const slotAt = str(i.slotAt);
    invites.push({
      id,
      entryId: str(i.entryId),
      label: str(i.candidateLabel),
      jobTitle: str(i.jobTitle),
      status: i.status as InviteStatus,
      slotAt: slotAt && Number.isFinite(Date.parse(slotAt)) ? slotAt : null,
      durationMin: num(i.durationMin),
      meetingUrl: str(i.meetingUrl),
    });
  }
  return { invites, zone: str(b.interviewTz), truncated: b.truncated === true };
}

export type Slot = { value: string; label: string };
export type SlotsRead = { slots: Slot[]; calendarStatus: "checked" | "not_connected" | "unavailable" | null };

/** GET /api/schedule?slots=1 — the global pool of offerable times (21 days, collision-aware). */
export function parseSlots(body: unknown): SlotsRead | null {
  const b = obj(body);
  if (!b || !Array.isArray(b.slots)) return null;
  const slots = (b.slots as unknown[]).flatMap((raw) => {
    const s = obj(raw);
    const value = s ? str(s.value) : null;
    const label = s ? str(s.label) : null;
    return value && label && Number.isFinite(Date.parse(value)) ? [{ value, label }] : [];
  });
  const cs = b.calendarStatus;
  return { slots, calendarStatus: cs === "checked" || cs === "not_connected" || cs === "unavailable" ? cs : null };
}

/** One thing on a calendar day: a booked (or proposed) interview, or a free offerable time. */
export type DayItem =
  | { kind: "interview"; time: string; invite: Invite }
  | { kind: "free"; time: string; slot: Slot; dateSlot: string };
export type CalendarDay = { date: GridDate; items: DayItem[] };

/** The weeks the calendar pages through: the scheduling grid's own (Mon–Fri, from this week
 *  to the end of the 21-day offer horizon, in the interview zone). */
export function calendarWeeks(nowMs: number, zone: string): GridDate[][] {
  return scheduleGridWeeks(nowMs, zone);
}

/** One week's days with their interviews (confirmed + pending with a time) and the free
 *  slots of the pool, each in time order. Declined / no-show are left off the grid. */
export function weekDays(week: readonly GridDate[], invites: readonly Invite[], slots: readonly Slot[], zone: string): CalendarDay[] {
  const byDay = new Map<string, DayItem[]>(week.map((d) => [d.iso, []]));
  for (const inv of invites) {
    if (!inv.slotAt || (inv.status !== "confirmed" && inv.status !== "pending")) continue;
    const ds = isoToDateSlot(inv.slotAt, zone);
    if (!ds) continue;
    byDay.get(ds.slice(0, 10))?.push({ kind: "interview", time: ds.slice(11), invite: inv });
  }
  for (const s of slots) {
    const ds = isoToDateSlot(s.value, zone);
    if (!ds) continue;
    byDay.get(ds.slice(0, 10))?.push({ kind: "free", time: ds.slice(11), slot: s, dateSlot: ds });
  }
  return week.map((date) => ({
    date,
    items: (byDay.get(date.iso) ?? []).sort((a, b) => a.time.localeCompare(b.time) || (a.kind === "interview" ? -1 : 1)),
  }));
}

/** Rows grouped by role, in the order a view already put them: a group sits where its
 *  FIRST row was, rows keep their order inside it. Shared by the tables' role grouping and
 *  the calendar's waiting list. */
export function groupByRole<T>(rows: readonly T[], roleOf: (row: T) => string | null): { role: string | null; rows: T[] }[] {
  const groups: { role: string | null; rows: T[] }[] = [];
  const at = new Map<string, number>();
  for (const r of rows) {
    const role = roleOf(r);
    const key = role ?? "\u0000";
    let i = at.get(key);
    if (i === undefined) {
      i = groups.length;
      at.set(key, i);
      groups.push({ role, rows: [] });
    }
    groups[i].rows.push(r);
  }
  return groups;
}

/** Waiting for an interview = an active entry on the `calendar` approval gate
 *  (useScheduleTab's own rule). Longest waiting first; its `approvalDetail` is a PLACEHOLDER
 *  and is never read as a slot. */
export function waitingForInterview(entries: readonly OneEntry[]): OneEntry[] {
  return entries
    .filter((e) => e.waitingInterview)
    .sort((a, b) => byKnownTimeFirst(a.stageChangedAt, b.stageChangedAt));
}

/** The one suggested booking: the longest waiter on the first free slot. */
export function suggestBooking(waiting: readonly OneEntry[], slots: readonly Slot[], zone: string): { entry: OneEntry; slot: Slot; dateSlot: string } | null {
  const entry = waiting[0];
  if (!entry) return null;
  for (const slot of slots) {
    const dateSlot = isoToDateSlot(slot.value, zone);
    if (dateSlot) return { entry, slot, dateSlot };
  }
  return null;
}
