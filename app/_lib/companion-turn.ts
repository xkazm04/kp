// Pure helpers for one operator-companion turn (docs/features/companion/README.md).
//
// Deliberately dependency-free: no db slice, no node:fs, no next/server. The
// route and companion-run.ts do the I/O and call these, so the clamp, the
// transcript window, the derived title and the grounding SUMMARY can be unit
// tested without opening a database or resolving next/server — which is the
// difference between a test that runs and one that is written and never runs.

/** The route's request clamp. Matches MAX_MESSAGE_CHARS in companion_cli.py, so
 *  a message that survives the route is never silently re-truncated by Python. */
export const MAX_COMPANION_MESSAGE_CHARS = 4_000;

/** The transcript window handed to the model. Matches MAX_TRANSCRIPT_TURNS in
 *  companion_cli.py — sending more would be paid for and then dropped. */
export const COMPANION_TRANSCRIPT_TURNS = 12;

/** How many turns of ONE conversation the dock renders — the bound every reader
 *  of a thread states rather than inherits.
 *
 *  It is a bound on the NEWEST turns, and that direction is the whole point: the
 *  store used to page from the oldest end, so a conversation past this length
 *  silently froze on screen while its writes kept landing. */
export const COMPANION_THREAD_TURNS = 200;

/** How far back the route reads when it is building the model's window.
 *
 *  Larger than COMPANION_TRANSCRIPT_TURNS because the window is a tail that can
 *  SHRINK — `transcriptWindow` may drop turns from the page it is given — so
 *  reading exactly twelve rows could hand the model a window of one. Small
 *  enough that the prompt read stays a cheap indexed page, never the thread. */
export const COMPANION_PROMPT_SCAN_TURNS = 40;

/** Bound + trim an untrusted message body. Empty (or non-string) → "" so the
 *  caller answers 400 rather than spawning Python for nothing. */
export function clampCompanionMessage(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().slice(0, MAX_COMPANION_MESSAGE_CHARS) : "";
}

/** Thread titles are DERIVED, never typed (the store's contract). The operator's
 *  first message is the honest name for the conversation; cut on a word boundary
 *  so a title never ends mid-word, and never past the store's 200-char column. */
export function deriveThreadTitle(message: string): string {
  const flat = message.replace(/\s+/g, " ").trim();
  if (flat.length <= 60) return flat;
  const cut = flat.slice(0, 60);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 24 ? cut.slice(0, lastSpace) : cut).trim();
}

// ---- the spoken channel (V1) ----------------------------------------------

/** Where a spoken reply came from. Two values because one question is asked of
 *  it: did she compose this for the ear (`model`), or did the pipeline cut it
 *  out of prose written for the eye (`derived`)? A surface that wants to say
 *  "spoken form" versus "read from the answer" branches here; nothing else does. */
export type CompanionVoiceSource = "model" | "derived";

/** The SPOKEN half of one reply. Not a summary and not a shorter report: the
 *  one-sentence answer plus at most one supporting fact, with no enumeration and
 *  no reference to anything on screen (the voice contract in companion_cli.py).
 *  Bounded to one synthesis chunk, so speaking it is a single request. */
export type CompanionVoiceReply = { text: string; source: CompanionVoiceSource };

/** Matches MAX_VOICE_CHARS in companion_blocks.py, which is itself the TTS
 *  chunker's default clip size (packages/voice-tts/src/text/segment.ts). Three
 *  places, one number: a voice reply that outgrew it would silently become two
 *  synthesis requests and lose the time-to-first-audio the bound exists to buy. */
export const MAX_COMPANION_VOICE_CHARS = 280;

/** Shape an untrusted `voiceReply` at the boundary, or null.
 *
 *  Null is a legitimate answer, not a failure: a turn stored before V1 carries
 *  no spoken form at all, and a dock that asserted one would hand the engine
 *  `undefined`. The caller falls back to the turn's own prose, which the
 *  package's `speechReady` will clean before any engine sees it. */
export function coerceVoiceReply(raw: unknown): CompanionVoiceReply | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entry = raw as Record<string, unknown>;
  const text = typeof entry.text === "string" ? entry.text.trim().slice(0, MAX_COMPANION_VOICE_CHARS) : "";
  if (!text) return null;
  return { text, source: entry.source === "model" ? "model" : "derived" };
}

export type CompanionWireTurn = { role: string; content: string };

/** The last N turns, oldest-first, in the shape companion_cli.py reads. */
export function transcriptWindow(
  turns: readonly CompanionWireTurn[],
  limit = COMPANION_TRANSCRIPT_TURNS
): CompanionWireTurn[] {
  return turns.slice(-limit).map((turn) => ({ role: turn.role, content: turn.content }));
}

// ---- grounding ------------------------------------------------------------

/** The slice of a pipeline entry the summary reads. Structural on purpose: the
 *  caller passes real PipelineEntry rows and this module never imports the store. */
export type CompanionPipelineRow = {
  stage: string;
  status: string;
  jobTitle: string | null;
  matchScore: number | null;
  /** Candidate display label. Optional so leaner projections still summarize. */
  candidateLabel?: string | null;
};

export type CompanionPipelineSummary = {
  activeEntries: number;
  byStage: Record<string, number>;
  /** The busiest roles by active-entry count — what the operator is actually hiring for.
   *  Each carries its top candidates (label, score, stage) so comparison questions can
   *  be answered as a table instead of a shrug. */
  topRoles: { role: string; entries: number; candidates: { label: string; matchScore: number | null; stage: string }[] }[];
  /** Mean match score across active entries that have one, rounded. Null when none do. */
  meanMatchScore: number | null;
};

const TOP_ROLES = 5;

const TOP_CANDIDATES_PER_ROLE = 5;

/** A compact, factual picture of the board — small enough to sit in every prompt,
 *  specific enough that the companion can answer "what needs me" without guessing.
 *  Candidate labels are deliberately PRESENT (decision 2026-08-24, prototype round
 *  2 triage): this is an operator-only surface behind the same auth as the board
 *  itself, and without labels the flagship question — "compare my top candidates"
 *  — is unanswerable. Capped at the busiest roles × top candidates by score. */
export function pipelineSummary(rows: readonly CompanionPipelineRow[]): CompanionPipelineSummary {
  const active = rows.filter((r) => r.status === "active");
  const byStage: Record<string, number> = {};
  const byRole = new Map<string, CompanionPipelineRow[]>();
  let scoreSum = 0;
  let scored = 0;
  for (const row of active) {
    byStage[row.stage] = (byStage[row.stage] ?? 0) + 1;
    const role = (row.jobTitle ?? "").trim();
    if (role) byRole.set(role, [...(byRole.get(role) ?? []), row]);
    if (typeof row.matchScore === "number" && Number.isFinite(row.matchScore)) {
      scoreSum += row.matchScore;
      scored += 1;
    }
  }
  const topRoles = [...byRole.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, TOP_ROLES)
    .map(([role, entries]) => ({
      role,
      entries: entries.length,
      candidates: entries
        .slice()
        .sort((a, b) => (b.matchScore ?? -1) - (a.matchScore ?? -1))
        .slice(0, TOP_CANDIDATES_PER_ROLE)
        .map((r) => ({ label: (r.candidateLabel ?? "").trim() || "(unlabeled)", matchScore: r.matchScore, stage: r.stage })),
    }));
  return {
    activeEntries: active.length,
    byStage,
    topRoles,
    meanMatchScore: scored > 0 ? Math.round(scoreSum / scored) : null,
  };
}

// ---- what the dock is allowed to SAY about a turn --------------------------
//
// The engine already reports why a reply degraded and whether it was written to
// the brain; until the dock could name those, both facts were stored and never
// shown. These live here, with the rest of the pure half, for the reason the
// header states: a classification with a `next-intl` import in it is a decision
// nobody can unit-test.

/** Why an answer came from the deterministic path.
 *
 *  Two classes, because the operator's next move differs. `noProvider` is a
 *  CONFIGURATION fact — keyless, or the configured provider reported itself
 *  unavailable — and it is fixed in settings. `providerFailed` is an INCIDENT: a
 *  provider was configured, was called, and raised; the same question usually
 *  works on the next try. Saying only "no model reached" made the first look like
 *  the second and left an operator retrying a keyless install forever. */
export type CompanionFallbackClass = "noProvider" | "providerFailed";

/** The two shapes `companion_cli.py::_complete` can report, and nothing else:
 *  the literal `"no provider available"` when `resolve_provider` returned nothing
 *  or reported itself unavailable, and `"<ExceptionType>: <message>"` (clipped to
 *  200 chars) when the call raised.
 *
 *  An unrecognised reason returns null ON PURPOSE — the caller keeps the generic
 *  chip. A CLI older or newer than this dock is a thing that happens, and a
 *  confident mis-classification of a reason we do not know is worse than the
 *  unspecific truth we already had. */
export function companionFallbackClass(reason: string | null | undefined): CompanionFallbackClass | null {
  const text = (reason ?? "").trim();
  if (!text) return null;
  if (/^no provider available$/i.test(text)) return "noProvider";
  // `TypeError: …`, `TimeoutError: …`, `httpx.ReadTimeout: …` — a Python
  // exception name (dotted paths allowed) followed by its message.
  if (/^[A-Za-z_][\w.]*: \S/.test(text)) return "providerFailed";
  return null;
}

/** Should the dock re-read its conversation because the studio's companion count
 *  moved?
 *
 *  The dock does not poll: `useAttention` already polls `/api/attention` every
 *  60s for the sidebar badges, and `attention.companion` is the count of open
 *  proposals — which is exactly what a landed digest, or a proposal a sibling tab
 *  answered, changes. Reading that existing signal is a refetch that costs no new
 *  timer.
 *
 *  Rules, all three load-bearing: only while the dock is OPEN (a closed dock has
 *  nothing to repaint and the rest pill's dot is already the honest signal for
 *  it); only on a CHANGE (equal counts mean nothing moved); and never on the
 *  FIRST observation (`prev === null`), because the boot fetch just read the same
 *  thread and re-reading it is a wasted round trip. */
export function shouldRefetchCompanionThread(
  prev: number | null,
  next: number | null,
  open: boolean
): boolean {
  if (!open) return false;
  if (prev === null || next === null) return false;
  return prev !== next;
}
