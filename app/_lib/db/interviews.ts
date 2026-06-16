import { coerceInterviewRecommendation, type InterviewRecommendation } from "../interview-recommendation";
import type { ScorecardRating } from "../interview-scorecard";
import { coerceProviderId, type VoiceProviderId, type VoiceTurn } from "../voice/types";
import { randomId, randomToken } from "../random-id";
import { chunk, SQL_IN_CHUNK } from "../entries-param";
import { ensureDb, safeRowParse } from "./core";

// Interviewed candidates for a job, with their fixed-rubric scorecard — the
// input for side-by-side interview comparison. The per-competency evidence
// doubles as the transcript highlights.
export type InterviewedCandidate = {
  entryId: string | null;
  candidateLabel: string | null;
  // Canonical advance|hold|reject verdict, or null when the (completed) interview
  // has no scorecard. A present-but-malformed value is coerced to the safe `hold`
  // fallback (see app/_lib/interview-recommendation.ts), so the compare grid only
  // ever receives a legal verdict or a clean null.
  recommendation: InterviewRecommendation | null;
  summary: string | null;
  // Which rubric this candidate was scored on, so the compare view can render
  // each cohort against its own axes. Older (pre-v3) scorecards predate the
  // early-career rubric, so a missing value is correctly 'experienced'.
  scoringModel: string;
  confidence: { level: string; reason?: string } | null;
  ratings: ScorecardRating[];
  // Skills minted as observed-provenance evidence by THIS interview (the
  // case-grounded gates in live_case.observed_from_interview); empty when the
  // interview minted nothing. The compare grid stamps these — the single
  // highest-trust artifact the pipeline produces must be visible, not implicit.
  observedSkills: string[];
};

export function interviewedForJob(jobId: string): InterviewedCandidate[] {
  const rows = ensureDb()
    .prepare(
      // Include completed interviews even when the scorecard is missing (empty
      // transcript or a synthesis failure) — they render with blank ratings so a
      // finished interview is visible for manual review rather than silently gone.
      `SELECT entry_id, candidate_label, scorecard_json, ended_at FROM interview_sessions
       WHERE job_id = ? AND status = 'completed'
       ORDER BY ended_at DESC`
    )
    .all(jobId) as {
    entry_id: string | null;
    candidate_label: string | null;
    scorecard_json: string | null;
    ended_at: string | null;
  }[];

  const seen = new Set<string>();
  const out: InterviewedCandidate[] = [];
  for (const r of rows) {
    const key = r.entry_id ?? r.candidate_label ?? String(out.length);
    if (seen.has(key)) continue; // latest interview per candidate
    seen.add(key);
    const sc: {
      recommendation?: string;
      summary?: string;
      scoringModel?: string;
      confidence?: { level: string; reason?: string };
      ratings?: InterviewedCandidate["ratings"];
      observedSkills?: unknown;
    } = safeRowParse(r.scorecard_json, "interviewedCandidates.scorecard", key) ?? {};
    out.push({
      entryId: r.entry_id,
      candidateLabel: r.candidate_label,
      recommendation: sc.recommendation != null ? coerceInterviewRecommendation(sc.recommendation) : null,
      summary: sc.summary ?? null,
      scoringModel: sc.scoringModel ?? "experienced",
      confidence: sc.confidence ?? null,
      ratings: Array.isArray(sc.ratings) ? sc.ratings : [],
      observedSkills: Array.isArray(sc.observedSkills) ? sc.observedSkills.map(String) : [],
    });
  }
  return out;
}

// ---- Interview sessions (voice 1st-round MVP) -----------------------------

// The provider union and transcript-turn shape are single-sourced in the voice
// adapter layer (app/_lib/voice/types): VoiceProviderId is the same union the
// create/connect routes validate with coerceProviderId, and VoiceTurn is the
// exact shape the browser POSTs on hang-up. Re-exported here so existing
// `import { ... } from "./db"` call sites resolve, and so the row mapper below
// cannot drift from the wire/client shape — the compiler now enforces it.
export type { VoiceProviderId, VoiceTurn } from "../voice/types";

export type InterviewSession = {
  id: string;
  token: string;
  entryId: string | null;
  candidateLabel: string | null;
  jobId: string | null;
  jobTitle: string | null;
  provider: VoiceProviderId;
  language: string | null;
  mode: "test" | "candidate";
  status: string;
  instructions: string | null;
  runOfShow: string[] | null;
  durationMin: number | null;
  consentAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  transcript: VoiceTurn[] | null;
  scorecard: unknown | null;
  createdAt: string;
  updatedAt: string | null;
};

type InterviewRow = {
  id: string;
  token: string;
  entry_id: string | null;
  candidate_label: string | null;
  job_id: string | null;
  job_title: string | null;
  provider: string;
  language: string | null;
  mode: string;
  status: string;
  instructions: string | null;
  run_of_show_json: string | null;
  duration_min: number | null;
  consent_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  transcript_json: string | null;
  scorecard_json: string | null;
  created_at: string;
  updated_at: string | null;
};

function rowToInterview(r: InterviewRow): InterviewSession {
  return {
    id: r.id,
    token: r.token,
    entryId: r.entry_id,
    candidateLabel: r.candidate_label,
    jobId: r.job_id,
    jobTitle: r.job_title,
    provider: coerceProviderId(r.provider, "openai"),
    language: r.language,
    mode: r.mode === "candidate" ? "candidate" : "test",
    status: r.status,
    instructions: r.instructions,
    runOfShow: safeRowParse<string[]>(r.run_of_show_json, "interview.runofshow", r.id),
    durationMin: r.duration_min,
    consentAt: r.consent_at,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    transcript: safeRowParse<VoiceTurn[]>(r.transcript_json, "interview.transcript", r.id),
    scorecard: safeRowParse<unknown>(r.scorecard_json, "interview.scorecard", r.id),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function createInterviewSession(input: {
  provider: VoiceProviderId;
  language?: string | null;
  mode?: "test" | "candidate";
  entryId?: string | null;
  candidateLabel?: string | null;
  jobId?: string | null;
  jobTitle?: string | null;
  instructions?: string | null;
  runOfShow?: string[] | null;
  durationMin?: number | null;
}): InterviewSession {
  const db = ensureDb();
  const now = new Date().toISOString();
  const id = randomId("iv");
  const token = randomToken("tk");
  db.prepare(
    `INSERT INTO interview_sessions
       (id, token, entry_id, candidate_label, job_id, job_title, provider, language, mode, status, instructions, run_of_show_json, duration_min, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?, ?, ?)`
  ).run(
    id,
    token,
    input.entryId ?? null,
    input.candidateLabel ?? null,
    input.jobId ?? null,
    input.jobTitle ?? null,
    input.provider,
    input.language ?? null,
    input.mode ?? "test",
    input.instructions ?? null,
    input.runOfShow && input.runOfShow.length ? JSON.stringify(input.runOfShow) : null,
    input.durationMin ?? null,
    now
  );
  return getInterviewSessionById(id)!;
}

// W6-4 (VOX1) — delivered-link lifecycle. Links are auto-emailed on create, so
// a live, indefinitely-valid AI-interview credential sat in candidates'
// inboxes with no expiry, no revoke and no reissue semantics.
// How long an undelivered/untaken link stays valid. Only `created` sessions
// expire — an in_progress call is live, and completed/failed have their own
// terminal semantics (failed stays reconnectable on purpose).
export const INTERVIEW_LINK_TTL_DAYS = 7;

/** Single expiry authority for an interview link — shared by /connect (the
 *  credential gate) and the portal page so the two can never disagree. */
export function isInterviewLinkExpired(session: { status: string; createdAt: string }): boolean {
  return (
    session.status === "created" &&
    Date.parse(session.createdAt) < Date.now() - INTERVIEW_LINK_TTL_DAYS * 86_400_000
  );
}

// How long an in_progress session counts as a LIVE call. updated_at is stamped
// when /connect flips the session live (markInterviewStarted) and a voice
// screen runs minutes, not hours — anything older is an abandoned zombie (a
// connect that never reached /complete), safe to reissue over.
export const LIVE_INTERVIEW_RECENCY_MIN = 30;

/** Single live-call authority for an interview session — /create's reissue
 *  guard reads this so "don't revoke an active conversation" can never drift
 *  from the recency window above. */
export function isInterviewSessionLive(session: { status: string; createdAt: string; updatedAt: string | null }): boolean {
  if (session.status !== "in_progress") return false;
  const touched = Date.parse(session.updatedAt ?? session.createdAt);
  return Number.isFinite(touched) && touched > Date.now() - LIVE_INTERVIEW_RECENCY_MIN * 60_000;
}

/** Revoke one open interview session. Concurrency guard in the WHERE (repo
 *  convention): never touches completed (the transcript is evidence) and a
 *  re-revoke is a no-op. `failed` is revocable — reconnectable-by-design ends
 *  when the recruiter pulls the link. */
export function revokeInterviewSession(id: string): boolean {
  const db = ensureDb();
  const res = db
    .prepare(`UPDATE interview_sessions SET status='revoked' WHERE id = ? AND status IN ('created','in_progress','failed')`)
    .run(id);
  return res.changes > 0;
}

/** Revoke every open session for an entry — the reissue half (a fresh link
 *  kills prior ones) and the terminal-transition cleanup. Returns the count. */
export function revokeOpenInterviewSessions(entryId: string): number {
  const db = ensureDb();
  const res = db
    .prepare(`UPDATE interview_sessions SET status='revoked' WHERE entry_id = ? AND status IN ('created','in_progress','failed')`)
    .run(entryId);
  return res.changes;
}

/** Latest interview session per entry (for the Schedule tab indicator). A
 *  session WITH a transcript outranks a newer empty one: a reissued link minted
 *  while (or after) a call completed used to become the surfaced row, so
 *  hasTranscript read false and a finished, scored interview turned invisible
 *  on every recruiter surface (voice-interview-runtime #2). */
export function interviewStatusByEntries(
  entryIds: string[]
): Record<string, { sessionId: string; status: string; hasTranscript: boolean; endedAt: string | null }> {
  if (entryIds.length === 0) return {};
  const out: Record<string, { sessionId: string; status: string; hasTranscript: boolean; endedAt: string | null }> = {};
  // Chunk the IN query under the SQLite variable limit so a wide board never trips
  // SQLITE_MAX_VARIABLE_NUMBER (idea-191ccc0c). Chunks partition the ids, so the
  // "first row per entry = best (transcript first, then latest)" dedup below
  // holds across chunk boundaries.
  for (const ids of chunk(entryIds, SQL_IN_CHUNK)) {
    const placeholders = ids.map(() => "?").join(",");
    const rows = ensureDb()
      .prepare(
        `SELECT s.id, s.entry_id, s.status, s.ended_at,
                (s.transcript_json IS NOT NULL AND s.transcript_json != '[]') AS has_tr
         FROM interview_sessions s
         WHERE s.entry_id IN (${placeholders})
         ORDER BY has_tr DESC, s.created_at DESC`
      )
      .all(...ids) as { id: string; entry_id: string; status: string; ended_at: string | null; has_tr: number }[];
    for (const r of rows) {
      if (out[r.entry_id]) continue; // first = transcript-bearing if any, else latest
      out[r.entry_id] = { sessionId: r.id, status: r.status, hasTranscript: !!r.has_tr, endedAt: r.ended_at };
    }
  }
  return out;
}

/** Most-recent interview session for one entry (for the transcript modal) —
 *  same transcript-first preference as interviewStatusByEntries, so the modal
 *  can never disagree with the card indicator it was opened from. */
export function latestInterviewByEntry(entryId: string): InterviewSession | null {
  const r = ensureDb()
    .prepare(
      `SELECT * FROM interview_sessions WHERE entry_id = ?
       ORDER BY (transcript_json IS NOT NULL AND transcript_json != '[]') DESC, created_at DESC LIMIT 1`
    )
    .get(entryId) as InterviewRow | undefined;
  return r ? rowToInterview(r) : null;
}

/** The newest live-candidate (in_progress) session for an entry — /create's
 *  reissue-guard read. Deliberately NOT latestInterviewByEntry: that read
 *  prefers transcript-bearing sessions, which would hide an active call behind
 *  an older completed one. */
export function liveInterviewByEntry(entryId: string): InterviewSession | null {
  const r = ensureDb()
    .prepare(`SELECT * FROM interview_sessions WHERE entry_id = ? AND status = 'in_progress' ORDER BY created_at DESC LIMIT 1`)
    .get(entryId) as InterviewRow | undefined;
  return r ? rowToInterview(r) : null;
}

export function getInterviewSessionById(id: string): InterviewSession | null {
  const r = ensureDb().prepare(`SELECT * FROM interview_sessions WHERE id = ?`).get(id) as InterviewRow | undefined;
  return r ? rowToInterview(r) : null;
}

export function getInterviewSessionByToken(token: string): InterviewSession | null {
  const r = ensureDb().prepare(`SELECT * FROM interview_sessions WHERE token = ?`).get(token) as InterviewRow | undefined;
  return r ? rowToInterview(r) : null;
}

/** Mark a session live (first connect); records consent_at the first time it is
 *  given. /connect enforces consent for candidate-mode sessions before calling
 *  this (see interview-consent.ts), so the consent=false branch below now only
 *  applies to ungated test/lab runs.
 *
 *  The UPDATE never reopens a completed session (idea-836e08d8): it used to
 *  force status='in_progress' unconditionally, so a direct POST to /connect
 *  with a finished session's token reset it and minted fresh provider
 *  credentials — the portal page only blocked the RENDER. The guard lives in
 *  the WHERE clause so a /complete racing this call can't lose; returns whether
 *  the session actually went live so the route can refuse to mint credentials. */
export function markInterviewStarted(id: string, consent: boolean): boolean {
  const db = ensureDb();
  const now = new Date().toISOString();
  if (consent) {
    return (
      db
        .prepare(
          `UPDATE interview_sessions SET status='in_progress', started_at=COALESCE(started_at, ?), consent_at=COALESCE(consent_at, ?), updated_at=? WHERE id=? AND status != 'completed'`
        )
        .run(now, now, now, id).changes > 0
    );
  }
  return (
    db
      .prepare(
        `UPDATE interview_sessions SET status='in_progress', started_at=COALESCE(started_at, ?), updated_at=? WHERE id=? AND status != 'completed'`
      )
      .run(now, now, id).changes > 0
  );
}

/** Persist the end of a call. The UPDATE is guarded at the row level so a
 *  session that already reached 'completed' is never overwritten (idea-beb71894):
 *  a duplicate POST — a network retry, a second tab, or the ElevenLabs
 *  onDisconnect firing alongside a manual End across a reload — must not wipe
 *  the persisted transcript, the only durable artifact of the interview. The
 *  guard lives in the WHERE clause (not a read-then-write in the route) so two
 *  concurrent completions can't both pass a status check; `applied` tells the
 *  caller whether THIS call performed the write. A 'failed' session stays
 *  writable: a successful retry after a dropped call may upgrade it. */
export function completeInterviewSession(
  id: string,
  input: { transcript: VoiceTurn[]; scorecard?: unknown; status?: string }
): { session: InterviewSession | null; applied: boolean } {
  const db = ensureDb();
  const now = new Date().toISOString();
  const res = db
    .prepare(
      `UPDATE interview_sessions SET status=?, ended_at=?, transcript_json=?, scorecard_json=COALESCE(?, scorecard_json), updated_at=? WHERE id=? AND status != 'completed'`
    )
    .run(
      input.status ?? "completed",
      now,
      JSON.stringify(input.transcript ?? []),
      input.scorecard !== undefined ? JSON.stringify(input.scorecard) : null,
      now,
      id
    );
  return { session: getInterviewSessionById(id), applied: res.changes > 0 };
}

/** Attach the synthesized scorecard to an already-persisted session. Separate
 *  from completeInterviewSession so the transcript write can happen FIRST and
 *  scoring strictly after it (idea-55fd89f9) — a scoring step that sets the
 *  Interview→Offer approval must never run ahead of the durable transcript it
 *  scores. */
export function attachInterviewScorecard(id: string, scorecard: unknown): InterviewSession | null {
  const db = ensureDb();
  const now = new Date().toISOString();
  db.prepare(`UPDATE interview_sessions SET scorecard_json=?, updated_at=? WHERE id=?`).run(
    JSON.stringify(scorecard),
    now,
    id
  );
  return getInterviewSessionById(id);
}
