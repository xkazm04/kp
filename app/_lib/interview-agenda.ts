// ONE agenda for both providers (spark ai-interview-parity, WP1a).
//
// Before the director, the two providers ran two different kits: OpenAI used the
// brief frozen on the session at invite time, ElevenLabs got a candidate-safe brief
// rebuilt at connect from the CURRENT prep. They could disagree about the very
// topics the candidate was asked. The agenda built here, at connect, is the single
// source both briefs are composed from (interview-run.ts) and that the director
// validates tool calls against (interview_sessions.agenda_json).
//
// Shape (registry: interview-run-of-show — fixed-opening-and-closing-blocks,
// slack-absorbing-open-block): a leading unassessed WARM-UP, the kit's topic blocks
// (plus the kit's OPEN block when it has one), then the protected closing reserve —
// ROLE QUESTIONS and CLOSE. The booked duration is an INPUT — the session's
// `duration_min` when it has one (what the candidate was promised and what billing
// clamps against), else the kit's own length: the fixed blocks are deducted first and
// the kit's blocks are fitted into what remains. Slack goes to the
// open block when there is one, otherwise to the candidate's questions; an overrun is
// taken from the open block first (the designated casualty), then the warm-up, then
// spread across the topic blocks — never from the closing reserve.
//
// READ-ONLY on purpose: this runs on the PUBLIC /api/interview/connect door, so it
// never generates a missing prep (a paid, slow LLM call a token holder could trigger
// at will). Nothing grounded → null, and the caller keeps its stored snapshot.
//
// Candidate-safety: every `title` is a catalog string or a scrubbed kit label
// (candidateSafeTopic), every `questions` entry passed an allow-list sanitizer from
// voice/candidate-brief.ts. `competency` is the RAW kit competency and is server-side
// only — toCandidateAgendaView drops it, and the candidate brief never reads it.

import { getDevCase } from "./db/devcase";
import { getEntryWorkspace, getPipelineEntry } from "./db/pipeline";
import type { PipelineEntry } from "./db/core";
import { getInterviewPrep } from "./interview-prep";
import { interviewBriefStrings, rosStrings, type InterviewBriefStrings } from "./interview-prep-strings";
import { debriefDurationMin, submissionFollowups, type SubmissionFollowup } from "./interview-planned-minutes";
import type { ChronologyBlock } from "./run-of-show";
import { isEarlyCareer } from "./archetypes";
import { devCaseIdForEntry } from "./devcase-identity";
import { GROUNDED_DEFAULT_MIN } from "./interview-duration.mjs";
import {
  phaseMinutes,
  STUDENT_SCRIPT,
  STUDENT_SCRIPT_MIN,
  type CaseInterviewScenario,
  type StudentScriptPhase,
} from "./student-interview";
import {
  candidateSafeTopic,
  chronologyAloudQuestions,
  scenarioPhaseAloudQuestions,
  sanitizeFollowupQuestion,
} from "./voice/candidate-brief";
import type {
  AgendaBlock,
  AgendaBlockKind,
  CandidateAgendaView,
  InterviewAgenda,
} from "./voice/director-types";

// ---- the prep payload + imported questions (moved from interview-run.ts) ----------

/** The stored interview-prep payload as the briefs and the agenda read it. */
export type PrepPayload = {
  scenario?: string;
  durationMin?: number;
  focusAreas?: string[];
  chronology?: ChronologyBlock[];
  // Interview-kit questions imported into the pack (written by /api/interview-prep
  // POST, rendered in the prep modal). Aloud-material the recruiter wants asked —
  // now carried into the voice brief alongside the generated chronology.
  importedQuestions?: string[];
  /** The language the pack was generated in (interview-prep-run stamps it). */
  lang?: string;
};

/** Cap on imported interview-kit questions carried into a grounded brief, so a
 *  40-question import (the /api/interview-prep import cap) can't overwhelm the
 *  brief's length discipline. What is dropped is stated in the brief prose. */
export const MAX_BRIEF_IMPORTED_QUESTIONS = 8;

/** The imported interview-kit questions (prep payload `importedQuestions`) that
 *  should ride a grounded brief: trimmed, de-duplicated, and — the coordination
 *  guard with the sibling "weave into chronology" work — dropped when their exact
 *  text is already asked in a chronology block, so a woven question never
 *  double-renders. Pure/exported for the brief-construction unit tests. */
export function importedQuestionsForBrief(importedQuestions: unknown, alreadyAsked: Iterable<string>): string[] {
  const seen = new Set<string>();
  for (const q of alreadyAsked) if (typeof q === "string") seen.add(q.trim());
  const out: string[] = [];
  if (Array.isArray(importedQuestions)) {
    for (const raw of importedQuestions) {
      // Entries are legacy plain strings OR { question, blockRef? } objects (the
      // round-8 weave shape). Both must reach the brief — a woven question keeps
      // its single home in importedQuestions, so skipping objects would silently
      // drop exactly the questions the recruiter planned most deliberately.
      const text =
        typeof raw === "string"
          ? raw
          : raw && typeof raw === "object" && typeof (raw as { question?: unknown }).question === "string"
            ? (raw as { question: string }).question
            : null;
      if (text === null) continue;
      const q = text.trim();
      if (!q || seen.has(q)) continue;
      seen.add(q);
      out.push(q);
    }
  }
  return out;
}

/** The dev case's generated interview scenario behind an early-career entry, or null
 *  when the role has no designed case (the generic student script then applies). */
export function caseScenarioForEntry(entry: PipelineEntry): CaseInterviewScenario | null {
  const caseId = devCaseIdForEntry(entry);
  const scenario = caseId ? ((getDevCase(caseId)?.scenario as CaseInterviewScenario | null) ?? null) : null;
  return scenario && Array.isArray(scenario.phases) && scenario.phases.length > 0 ? scenario : null;
}

// ---- the kit ---------------------------------------------------------------------------

/** Which grounding the agenda came from — the same branch order as
 *  buildGroundedInterview: submission debrief > case-grounded student > generic
 *  student > prep chronology. */
export type InterviewKitBranch = "debrief" | "case" | "student" | "prep";

/** The agenda plus what only the SERVER-MINTED brief may carry. */
export type InterviewKit = {
  branch: InterviewKitBranch;
  agenda: InterviewAgenda;
  /** Interviewer-internal material per block id — goals, listen-fors, scripted hints,
   *  red flags, the raw questions with their optional follow-up. The private brief's
   *  listing reads it (voice/director-brief.ts::privateAgendaListing); nothing that
   *  reaches the browser does. */
  privateNotes: Record<string, string>;
};

/** Minimum minutes of the protected closing reserve. */
export const ROLE_QA_MIN = 2;
export const CLOSE_MIN = 2;
/** Warm-up length when the kit has no opening block of its own to map onto. */
export const DEFAULT_WARMUP_MIN = 1;
/** Minutes per decision block in the submission debrief (debriefDurationMin's 3/question). */
const DEBRIEF_MIN_PER_QUESTION = 3;
/** The debrief's open walkthrough of their approach. */
const DEBRIEF_APPROACH_MIN = 3;
/** Coverage-first may overrun into slack up to this multiple of the booking. */
export const HARD_CAP_FACTOR = 1.2;

type Draft = {
  kind: AgendaBlockKind;
  title: string;
  budgetMin: number;
  competency: string | null;
  questions: string[];
  note: string | null;
};

const cleanText = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

const positiveMinutes = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;

function warmupDraft(s: InterviewBriefStrings["agenda"], budgetMin: number): Draft {
  return { kind: "warmup", title: s.warmup, budgetMin, competency: null, questions: [s.warmupQuestion], note: null };
}

function closingDrafts(s: InterviewBriefStrings["agenda"], roleQaMin: number, closeMin: number): Draft[] {
  return [
    { kind: "role_qa", title: s.roleQuestions, budgetMin: roleQaMin, competency: null, questions: [], note: null },
    { kind: "close", title: s.close, budgetMin: closeMin, competency: null, questions: [], note: null },
  ];
}

const sum = (blocks: { budgetMin: number }[]) => blocks.reduce((n, b) => n + b.budgetMin, 0);

/** Apportion `target` whole minutes across `blocks` in proportion to their current
 *  budgets (largest remainder), never below 1 minute each. Mutates. */
function apportion<T extends { budgetMin: number }>(blocks: T[], target: number): void {
  if (blocks.length === 0) return;
  const weights = blocks.map((b) => Math.max(1, b.budgetMin));
  const total = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (w * target) / total);
  const floors = raw.map((r) => Math.max(1, Math.floor(r)));
  let diff = target - floors.reduce((a, b) => a + b, 0);
  const byRemainder = raw.map((r, i) => ({ i, rem: r - Math.floor(r) })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; diff > 0 && byRemainder.length > 0; k = (k + 1) % byRemainder.length) {
    floors[byRemainder[k].i] += 1;
    diff -= 1;
  }
  while (diff < 0) {
    // The 1-minute floor pushed the sum over: take back from the largest block that can give.
    let largest = -1;
    for (let i = 0; i < floors.length; i++) if (floors[i] > 1 && (largest < 0 || floors[i] > floors[largest])) largest = i;
    if (largest < 0) break;
    floors[largest] -= 1;
    diff += 1;
  }
  blocks.forEach((b, i) => {
    b.budgetMin = floors[i];
  });
}

/** Fit the drafted blocks to the booked duration (see the header for the order of
 *  sacrifice). Returns the fitted blocks and the duration they sum to — equal to the
 *  booking except in the degenerate case where even the floors (1 min per topic, the
 *  2+2 closing reserve) exceed it, when the agenda states the honest longer total. */
export function fitAgendaDrafts<T extends { kind: AgendaBlockKind; budgetMin: number }>(
  input: T[],
  durationMin: number
): { blocks: T[]; durationMin: number } {
  const booked = Math.max(1, Math.round(durationMin));
  const blocks = input.map((b) => ({ ...b, budgetMin: Math.max(0, Math.round(b.budgetMin)) }));
  for (const b of blocks) {
    if (b.kind === "role_qa") b.budgetMin = Math.max(ROLE_QA_MIN, b.budgetMin);
    else if (b.kind === "close") b.budgetMin = Math.max(CLOSE_MIN, b.budgetMin);
    else if (b.kind === "warmup" || b.kind === "topic") b.budgetMin = Math.max(1, b.budgetMin);
  }
  const open = blocks.find((b) => b.kind === "open");
  let total = sum(blocks);
  if (total < booked) {
    // Slack is absorbed by ONE named block, never spread thin across the topics.
    const sink = open ?? blocks.find((b) => b.kind === "role_qa");
    if (sink) sink.budgetMin += booked - total;
  } else if (total > booked) {
    let excess = total - booked;
    if (open) {
      const cut = Math.min(excess, open.budgetMin);
      open.budgetMin -= cut;
      excess -= cut;
    }
    const warmup = blocks.find((b) => b.kind === "warmup");
    if (warmup && excess > 0) {
      const cut = Math.min(excess, warmup.budgetMin - 1);
      warmup.budgetMin -= cut;
      excess -= cut;
    }
    if (excess > 0) {
      const topics = blocks.filter((b) => b.kind === "topic");
      const current = sum(topics);
      apportion(topics, Math.max(topics.length, current - excess));
    }
  }
  const kept = blocks.filter((b) => !(b.kind === "open" && b.budgetMin <= 0));
  total = sum(kept);
  return { blocks: kept as T[], durationMin: total };
}

function finalizeKit(branch: InterviewKitBranch, drafts: Draft[], durationMin: number): InterviewKit | null {
  // Nothing scored = nothing to direct: a warm-up and a goodbye are not an interview.
  if (!drafts.some((d) => d.kind === "topic" || d.kind === "open")) return null;
  const fitted = fitAgendaDrafts(drafts, durationMin);
  const privateNotes: Record<string, string> = {};
  const blocks: AgendaBlock[] = fitted.blocks.map((d, i) => {
    const id = `b${i}`;
    if (d.note) privateNotes[id] = d.note;
    return {
      id,
      kind: d.kind,
      title: d.title,
      budgetMin: d.budgetMin,
      competency: d.competency,
      scored: d.kind === "topic" || d.kind === "open",
      questions: d.questions,
    };
  });
  const closeReserveMin = blocks
    .filter((b) => b.kind === "role_qa" || b.kind === "close")
    .reduce((n, b) => n + b.budgetMin, 0);
  return {
    branch,
    agenda: {
      version: 1,
      durationMin: fitted.durationMin,
      hardCapMin: Math.round(fitted.durationMin * HARD_CAP_FACTOR),
      closeReserveMin,
      blocks,
    },
    privateNotes,
  };
}

// ---- per-branch drafting ------------------------------------------------------------

const quoteAll = (qs: string[]) => qs.map((q) => `“${q}”`).join(" ");

function debriefDrafts(followups: SubmissionFollowup[], s: InterviewBriefStrings): Draft[] {
  const decisions: Draft[] = followups.map((f, i) => {
    const question = sanitizeFollowupQuestion(f);
    const listen = cleanText(f.listenFor) ? ` Listen for: ${cleanText(f.listenFor)}` : "";
    const flag = cleanText(f.redFlag) ? ` Internal red flag — never say this aloud: ${cleanText(f.redFlag)}` : "";
    return {
      kind: "topic",
      title: s.agenda.decision(i + 1),
      budgetMin: DEBRIEF_MIN_PER_QUESTION,
      competency: cleanText(f.decision) ?? question,
      questions: question ? [question] : [],
      note: question ? `Ask: “${cleanText(f.question)}”${listen}${flag}` : null,
    };
  });
  return [
    warmupDraft(s.agenda, DEFAULT_WARMUP_MIN),
    {
      kind: "topic",
      title: s.debriefRunOfShow[0],
      budgetMin: DEBRIEF_APPROACH_MIN,
      competency: "Ownership of the submitted approach",
      questions: [],
      note: "Let them walk you through their approach in their own words.",
    },
    ...decisions,
    ...closingDrafts(s.agenda, ROLE_QA_MIN, CLOSE_MIN),
  ];
}

function phaseDrafts(phases: StudentScriptPhase[], s: InterviewBriefStrings): Draft[] {
  const topics: Draft[] = phases.map((p, i) => {
    const feeds = Array.isArray(p.feeds) ? p.feeds.filter((f): f is string => typeof f === "string" && f.trim() !== "") : [];
    const goal = cleanText(p.goal);
    const probe = cleanText(p.probe);
    const listen = cleanText(p.listenFor);
    return {
      kind: "topic",
      title: candidateSafeTopic(p.phase) ?? s.agenda.topicFallback(i + 1),
      budgetMin: phaseMinutes({ minutes: typeof p.minutes === "string" ? p.minutes : "" }),
      competency: feeds.length ? feeds.join(", ") : cleanText(p.phase),
      questions: scenarioPhaseAloudQuestions(p),
      // The same private line the legacy phase run-of-show gave the interviewer —
      // including the coachability stage direction the candidate brief never sees.
      note: [goal, probe ? `Ask: ${probe}` : null, listen ? `Listen for: ${listen}` : null].filter(Boolean).join(" ") || null,
    };
  });
  return [warmupDraft(s.agenda, DEFAULT_WARMUP_MIN), ...topics, ...closingDrafts(s.agenda, ROLE_QA_MIN, CLOSE_MIN)];
}

const minutesOf = (b: ChronologyBlock) =>
  positiveMinutes(typeof b?.toMin === "number" && typeof b?.fromMin === "number" ? b.toMin - b.fromMin : NaN, 3);

/** Map a prep chronology onto the agenda. The plan already has a fixed opening
 *  ("Intro & rapport") and a fixed closing ("Candidate questions & wrap-up") — both
 *  recognisable structurally as a first/last block with nothing to ask aloud — so
 *  they become the warm-up and the role-questions + close pair instead of being
 *  duplicated. A middle block with nothing to ask whose topic is the pack-language
 *  catalog's open-discussion topic is the plan's slack block and stays `open`. */
function prepDrafts(prep: PrepPayload, s: InterviewBriefStrings, openTopic: string | null): Draft[] {
  const chron = (prep.chronology ?? []).filter((b) => b && typeof b === "object");
  const aloudOf = (b: ChronologyBlock) => chronologyAloudQuestions(b);
  const first = chron[0];
  const last = chron.length > 1 ? chron[chron.length - 1] : undefined;
  const hasOpening = !!first && aloudOf(first).length === 0;
  const hasClosing = !!last && aloudOf(last).length === 0;
  const middle = chron.slice(hasOpening ? 1 : 0, hasClosing ? chron.length - 1 : chron.length);

  const topics: Draft[] = [];
  let open: Draft | null = null;
  let ordinal = 0;
  for (const b of middle) {
    const aloud = aloudOf(b);
    const rawTopic = cleanText(b.topic);
    const goal = cleanText(b.goal);
    if (aloud.length === 0 && openTopic && rawTopic === openTopic && !open) {
      open = { kind: "open", title: s.agenda.open, budgetMin: minutesOf(b), competency: rawTopic, questions: [], note: goal };
      continue;
    }
    ordinal += 1;
    const rawQs = (Array.isArray(b.questions) ? b.questions : []).filter((q): q is string => typeof q === "string" && q.trim() !== "");
    const followUp = cleanText(b.followUp);
    // The legacy private run-of-show line, verbatim in content: goal, the RAW
    // questions, and the optional follow-up kept distinct from them.
    const note =
      [goal ?? "", rawQs.length ? `Ask: ${quoteAll(rawQs)}.` : "", followUp ? `Optional follow-up: “${followUp}”.` : ""]
        .filter(Boolean)
        .join(" ") || null;
    topics.push({
      kind: "topic",
      title: candidateSafeTopic(b.topic) ?? s.agenda.topicFallback(ordinal),
      budgetMin: minutesOf(b),
      competency: rawTopic,
      questions: aloud,
      note,
    });
  }

  // Imported interview-kit questions: one block of their own (they used to be a
  // "weave in wherever they fit" line with no minutes, which is how they went unasked).
  const askedInPlan = chron.flatMap((b) => aloudOf(b));
  const imported = importedQuestionsForBrief(prep.importedQuestions, askedInPlan).slice(0, MAX_BRIEF_IMPORTED_QUESTIONS);
  const importedAloud = chronologyAloudQuestions({ questions: imported });
  if (importedAloud.length > 0) {
    topics.push({
      kind: "topic",
      title: s.recruiterAddedQuestions,
      budgetMin: Math.min(4, Math.max(2, importedAloud.length)),
      competency: "Recruiter-added questions",
      questions: importedAloud,
      note: null,
    });
  }

  const warmupMin = hasOpening ? minutesOf(first) : DEFAULT_WARMUP_MIN;
  const wrapMin = hasClosing && last ? minutesOf(last) : ROLE_QA_MIN + CLOSE_MIN;
  return [
    warmupDraft(s.agenda, warmupMin),
    ...topics,
    ...(open ? [open] : []),
    ...closingDrafts(s.agenda, Math.max(ROLE_QA_MIN, wrapMin - CLOSE_MIN), CLOSE_MIN),
  ];
}

// ---- entry points -----------------------------------------------------------------------

/** Options for a connect-time build. */
export type InterviewKitOptions = {
  /** The session's BOOKED length (`interview_sessions.duration_min`): what the portal
   *  promised the candidate and what the minutes debit clamps against. When present
   *  the agenda is fitted to it; the kit's own duration (the prep's, the script's,
   *  the debrief's) is only the fallback for a session that has none. The booking is
   *  an input, not an output (registry: interview-run-of-show). */
  bookedMin?: number | null;
};

/** The agenda and the private notes for an entry, READ-ONLY (never generates a
 *  missing prep). Same branch order as buildGroundedInterview. Tenant: the caller's
 *  when given, else the ENTRY's own (the public connect door has no session). */
export async function buildInterviewKit(
  entryId: string,
  workspaceId?: string,
  opts?: InterviewKitOptions
): Promise<InterviewKit | null> {
  const ws = workspaceId ?? getEntryWorkspace(entryId);
  const entry = getPipelineEntry(entryId, ws);
  if (!entry) return null;
  // Titles and the warm-up question are written FOR the applicant: the entry's language.
  const strings = await interviewBriefStrings(entry.locale);
  // The booked length wins over whatever the kit would plan on its own.
  const booked = positiveMinutes(opts?.bookedMin, NaN);
  const lengthOr = (kitMin: number) => (Number.isFinite(booked) ? booked : kitMin);

  const followups = submissionFollowups(entry);
  if (followups.length > 0) {
    return finalizeKit("debrief", debriefDrafts(followups, strings), lengthOr(debriefDurationMin(followups.length)));
  }

  if (isEarlyCareer(entry.archetype)) {
    const scenario = caseScenarioForEntry(entry);
    if (scenario) {
      return finalizeKit("case", phaseDrafts(scenario.phases, strings), lengthOr(scenario.durationMin || STUDENT_SCRIPT_MIN));
    }
    return finalizeKit("student", phaseDrafts(STUDENT_SCRIPT, strings), lengthOr(STUDENT_SCRIPT_MIN));
  }

  const prep = (getInterviewPrep(entryId, ws)?.payload as PrepPayload | undefined) ?? undefined;
  if (!prep?.chronology?.length) return null;
  // The open-discussion topic in the PACK's language (the recruiter's, stamped at
  // generation) — that is the language the chronology's scaffolding was written in.
  const openTopic = (await rosStrings(prep.lang ?? entry.locale)).openTopic;
  const durationMin = lengthOr(positiveMinutes(prep.durationMin, GROUNDED_DEFAULT_MIN));
  return finalizeKit("prep", prepDrafts(prep, strings, openTopic), durationMin);
}

/** The director's agenda for an entry, built at connect — READ-ONLY (it must never
 *  generate a missing prep: it runs on a public route). Null when there is nothing
 *  grounded to direct, so the caller falls back to its stored brief. */
export async function buildInterviewAgenda(
  entryId: string,
  workspaceId?: string,
  opts?: InterviewKitOptions
): Promise<InterviewAgenda | null> {
  return (await buildInterviewKit(entryId, workspaceId, opts))?.agenda ?? null;
}

/** The agenda as the candidate's browser receives it — CONSTRUCTED from the four
 *  candidate-facing fields, so `competency`, `questions`, `scored` and anything a
 *  future AgendaBlock grows cannot ride along. */
export function toCandidateAgendaView(agenda: InterviewAgenda): CandidateAgendaView {
  return {
    durationMin: agenda.durationMin,
    hardCapMin: agenda.hardCapMin,
    blocks: agenda.blocks.map((b) => ({ id: b.id, kind: b.kind, title: b.title, budgetMin: b.budgetMin })),
  };
}

/** Same block ids, kinds and titles in the same order — the test for "a freshly
 *  built agenda still describes the blocks an earlier attempt's events refer to". */
export function sameAgendaShape(a: InterviewAgenda, b: InterviewAgenda): boolean {
  return (
    a.blocks.length === b.blocks.length &&
    a.blocks.every((x, i) => x.id === b.blocks[i].id && x.kind === b.blocks[i].kind && x.title === b.blocks[i].title)
  );
}

/** On a RESUMED attempt the stored agenda wins: the resume context's active and
 *  covered block ids were recorded against it, and a prep regenerated mid-session
 *  would otherwise re-number the blocks under them. The fresh kit's private notes
 *  ride along only when the two agendas still have the same shape. A first attempt
 *  (or no stored agenda) always takes the fresh build. */
export function reconcileKitWithStoredAgenda(
  fresh: InterviewKit | null,
  stored: InterviewAgenda | null,
  resuming: boolean
): InterviewKit | null {
  if (!resuming || !stored || !Array.isArray(stored.blocks) || stored.blocks.length === 0) return fresh;
  if (fresh && sameAgendaShape(fresh.agenda, stored)) return { ...fresh, agenda: stored };
  // The kit moved under a live session: keep the agenda the director and the resume
  // state already speak, and drop the notes, which describe different blocks now.
  return { branch: fresh?.branch ?? "prep", agenda: stored, privateNotes: {} };
}
