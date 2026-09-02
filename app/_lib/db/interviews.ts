import { coerceInterviewRecommendation, type InterviewRecommendation } from "../interview-recommendation";
import type { ScorecardRating } from "../interview-scorecard";
import { coerceProviderId, type VoiceProviderId, type VoiceTurn } from "../voice/types";
import { randomId, randomToken } from "../random-id";
import { chunk, SQL_IN_CHUNK } from "../entries-param";
import { ensureDb, safeRowParse } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";

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
  /** What this interview COST, in USD, from the usage ledger (`llm_usage.request_id`
   *  IS the session id, use case `interview_realtime`) — the same correlated SUM and
   *  the same three honest states as InterviewSessionSummary.costUsd: a number, a real
   *  0 for a self-hosted call, and `null` for unknown (no ledger row, or a provider
   *  the price table does not cover). The compare grid weighs candidates side by side;
   *  what each screen cost belongs on that table, and it was the one number the cohort
   *  read could not answer. */
  costUsd: number | null;
};

export function interviewedForJob(jobId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): InterviewedCandidate[] {
  const rows = ensureDb()
    .prepare(
      // Include completed interviews even when the scorecard is missing (empty
      // transcript or a synthesis failure) — they render with blank ratings so a
      // finished interview is visible for manual review rather than silently gone.
      // The cost rides on the SAME read (a correlated SUM, no per-row round trip) and
      // is keyed by request id AND use case, exactly like the docket's ledger join —
      // one fact, one query shape, so the compare table and the docket can never
      // disagree about what a call cost.
      `SELECT s.id, s.entry_id, s.candidate_label, s.scorecard_json, s.ended_at,
              (SELECT SUM(u.cost_usd) FROM llm_usage u
                WHERE u.request_id = s.id AND u.use_case = 'interview_realtime') AS cost_usd
         FROM interview_sessions s
        WHERE s.job_id = ? AND s.status = 'completed' AND s.workspace_id = ?
        ORDER BY s.ended_at DESC`
    )
    .all(jobId, workspaceId) as {
    id: string;
    entry_id: string | null;
    candidate_label: string | null;
    scorecard_json: string | null;
    ended_at: string | null;
    cost_usd: number | null;
  }[];

  const seen = new Set<string>();
  const out: InterviewedCandidate[] = [];
  for (const r of rows) {
    // bug-ui-scan-2026-07-09 (interview-simulation-comparison #4) — dedup "latest
    // interview per candidate" on entry_id; fall back to the globally-unique
    // session id (NOT candidate_label) when there's no entry. Two entry-less
    // completed sessions sharing a label are DIFFERENT candidates whose real
    // second interview used to collapse into the first and vanish from compare.
    const key = r.entry_id ?? r.id;
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
      // Number.isFinite, not `?? null`: SQLite answers NULL both for "no ledger row"
      // and for "a row priced NULL", and both mean unknown. A real 0 survives.
      costUsd: Number.isFinite(r.cost_usd) ? (r.cost_usd as number) : null,
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
  /** The team this session belongs to. The ROW always had it; this type dropped it,
   *  so every caller holding a session had to be told the tenant separately — and
   *  the minutes debit in /api/interview/complete wasn't, re-deriving it from the
   *  entry and landing entry-less sessions (every simulation) on the DEFAULT team's
   *  meter while the gate had checked the caller's. Same defect shape, and same fix,
   *  as PipelineEntry.workspaceId. Every read here is `SELECT *`, so surfacing it
   *  costs nothing. */
  workspaceId: string;
  /** The provider this call was originally asked to serve, when /connect had to fall
   *  back to the other one. `provider` above is overwritten with whoever ACTUALLY
   *  served (the completion ledger prices from it), so without this the recruiter's
   *  own choice was lost. NULL = nothing fell back — never a copy of `provider`. */
  failoverFrom: VoiceProviderId | null;
  /** How many times this link was connected. 1 for the ordinary call AND for a link
   *  that has not been opened yet; a dropped call that is retried (which the billing
   *  path already treats as a separate attempt) makes it 2. */
  attempts: number;
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
  workspace_id: string | null;
  failover_from: string | null;
  attempts: number | null;
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
    // Pre-tenancy rows have no workspace_id; they predate multi-workspace and are
    // the default team's by definition.
    workspaceId: r.workspace_id ?? DEFAULT_WORKSPACE_ID,
    // A stored value is only ever one of the known providers, but it is still row
    // data: coerce it, and keep NULL as NULL (coerceProviderId's default would turn
    // "nothing fell back" into "fell back from openai").
    failoverFrom: r.failover_from ? coerceProviderId(r.failover_from, "openai") : null,
    // A row written before the column existed reads as the single attempt it was.
    attempts: Number.isFinite(r.attempts) ? Number(r.attempts) : 1,
  };
}

/** Workspace-wide AI-interview history for the Schedule tab's AI-round ledger:
 *  candidate-mode sessions newest-first, as SUMMARY rows (no transcript blob on
 *  the wire — the evaluation views fetch the full session by entry on click).
 *  The verdict is coerced through the canonical recommendation guard so the
 *  ledger only ever renders a legal advance|hold|reject or a clean null. */
export type InterviewSessionSummary = {
  id: string;
  entryId: string | null;
  candidateLabel: string | null;
  jobId: string | null;
  jobTitle: string | null;
  provider: VoiceProviderId;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  hasTranscript: boolean;
  recommendation: InterviewRecommendation | null;
  ratingsCount: number;
  /** What this call COST, in USD, read from the usage ledger the completion wrote
   *  (`llm_usage.request_id` IS the session id, use case `interview_realtime`).
   *
   *  `null` is UNKNOWN and never a stand-in for free: a session that has not
   *  completed has no ledger row yet, and an unpriced provider writes the row with
   *  `cost_usd` NULL by design (minute-prices.ts mirrors base.py's convention -
   *  metered by quantity, unpriced in money). `0` is a real, asserted zero: a call
   *  a SELF-HOSTED provider served costs no per-minute credits, and saying so is
   *  the whole point of running the voice service yourself.
   *
   *  Voice minutes are the one meter with real per-unit cost and the two providers
   *  differ by ~60% per minute, yet this number had ZERO readers outside the
   *  aggregate Models panel: a recruiter could not see what any single interview
   *  cost, on the surface where they decide whether to run another. */
  costUsd: number | null;
  /** The provider the recruiter ASKED for, when the call fell back to the other one.
   *  `provider` is who served; this is who was chosen and could not. NULL = no
   *  failover, which is the overwhelming majority of calls. */
  failoverFrom: VoiceProviderId | null;
  /** Connect count for this link (1 = the ordinary call). Surfaced because a call
   *  billed for the last of several attempts otherwise reads exactly like a clean
   *  first-time one. */
  attempts: number;
};

export function listRecentInterviewSessions(workspaceId: string = DEFAULT_WORKSPACE_ID, limit = 100): InterviewSessionSummary[] {
  const rows = ensureDb()
    .prepare(
      // has_transcript uses the SAME predicate as interviewStatusByEntries — NOT
      // NULL *and* not the empty array. GDPR erasure scrubs a transcript to '[]'
      // in place (scrubEntryLinkedPii) and leaves the row `completed`, so the
      // bare IS NOT NULL kept reporting a transcript for an erased candidate:
      // their card indicator read "absent" while this ledger's docket card stayed
      // clickable into an evaluation with nothing behind it. One fact, one answer.
      // The cost join, not a second round trip per row: llm_usage.request_id IS the
      // session id, so the ledger row a completion wrote hangs directly off this
      // read. SUM (not the bare column) because a reconnect that completes twice
      // would leave two rows and the honest answer is what the call cost in total;
      // SUM over an empty set is NULL, which is exactly the "unknown" this field
      // means. llm_usage carries no workspace_id - it does not need one here, since
      // the join's left side is already scoped and the request id is a session id.
      `SELECT s.id, s.entry_id, s.candidate_label, s.job_id, s.job_title, s.provider, s.status,
              s.started_at, s.ended_at, s.created_at, s.failover_from, s.attempts,
              (s.transcript_json IS NOT NULL AND s.transcript_json != '[]') AS has_transcript, s.scorecard_json,
              (SELECT SUM(u.cost_usd) FROM llm_usage u
                WHERE u.request_id = s.id AND u.use_case = 'interview_realtime') AS cost_usd
         FROM interview_sessions s
        WHERE s.mode = 'candidate' AND s.workspace_id = ?
        ORDER BY s.created_at DESC
        LIMIT ?`
    )
    .all(workspaceId, Math.min(Math.max(limit, 1), 500)) as {
    id: string;
    entry_id: string | null;
    candidate_label: string | null;
    job_id: string | null;
    job_title: string | null;
    provider: string;
    status: string;
    started_at: string | null;
    ended_at: string | null;
    created_at: string;
    has_transcript: number;
    scorecard_json: string | null;
    cost_usd: number | null;
    failover_from: string | null;
    attempts: number | null;
  }[];
  return rows.map((r) => {
    const sc = safeRowParse<{ recommendation?: string; ratings?: unknown[] }>(r.scorecard_json, "interview.summary", r.id);
    return {
      id: r.id,
      entryId: r.entry_id,
      candidateLabel: r.candidate_label,
      jobId: r.job_id,
      jobTitle: r.job_title,
      provider: coerceProviderId(r.provider, "openai"),
      status: r.status,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      createdAt: r.created_at,
      hasTranscript: Boolean(r.has_transcript),
      recommendation: sc?.recommendation != null ? coerceInterviewRecommendation(sc.recommendation) : null,
      ratingsCount: Array.isArray(sc?.ratings) ? sc.ratings.length : 0,
      // Number.isFinite, not `?? null`: SQLite hands back NULL for "no ledger row"
      // AND for "a row whose cost_usd is NULL", and both mean unknown. A real 0
      // (a self-hosted call) is finite and survives.
      costUsd: Number.isFinite(r.cost_usd) ? (r.cost_usd as number) : null,
      failoverFrom: r.failover_from ? coerceProviderId(r.failover_from, "openai") : null,
      attempts: Number.isFinite(r.attempts) ? Number(r.attempts) : 1,
    };
  });
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
  /** The CALLER's team, for a session with no pipeline entry to inherit from — a
   *  simulation or a test call. Without it those sessions were stamped with the
   *  default team while their minutes gate had been checked against the caller's,
   *  so the gate and the debit read two different tenants. An entry, when present,
   *  still wins: it is the authoritative tenant for a real candidate. */
  workspaceId?: string | null;
}): InterviewSession {
  const db = ensureDb();
  const now = new Date().toISOString();
  const id = randomId("iv");
  const token = randomToken("tk");
  // Tenant (P1): a session inherits its pipeline entry's workspace (by-id read, guarded).
  // With no entry it takes the caller's team, and only falls back to the default when
  // the caller had none either. Every other op is by the globally-unique
  // id/token/entry_id; the by-job enumeration filters this.
  let workspaceId = input.workspaceId || DEFAULT_WORKSPACE_ID;
  if (input.entryId) {
    try {
      const ws = db.prepare(`SELECT workspace_id FROM pipeline_entries WHERE id = ?`).get(input.entryId) as { workspace_id?: string } | undefined;
      workspaceId = ws?.workspace_id ?? DEFAULT_WORKSPACE_ID;
    } catch {
      /* pipeline_entries absent on this connection — keep the default workspace */
    }
  }
  db.prepare(
    `INSERT INTO interview_sessions
       (id, token, entry_id, candidate_label, job_id, job_title, provider, language, mode, status, instructions, run_of_show_json, duration_min, created_at, workspace_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?, ?, ?, ?)`
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
    now,
    workspaceId
  );
  return getInterviewSessionById(id)!;
}

// W6-4 (VOX1) — delivered-link lifecycle. Links are auto-emailed on create, so
// a live, indefinitely-valid AI-interview credential sat in candidates'
// inboxes with no expiry, no revoke and no reissue semantics.
// How long a delivered link stays a valid credential, measured from creation.
export const INTERVIEW_LINK_TTL_DAYS = 7;

/** Single expiry authority for an interview link — shared by /connect (the
 *  credential gate) and the portal page so the two can never disagree.
 *
 *  The TTL used to apply to `created` sessions ONLY ("an in_progress call is
 *  live, and failed is reconnectable on purpose"). But the status is moved by
 *  the CANDIDATE: one click on Start flips the row to `in_progress` (a dropped
 *  call leaves it `failed`), and from then on the link never expired again — an
 *  abandoned session was still minting real ElevenLabs/OpenAI Realtime minutes
 *  on the employer's meter months later, which is precisely the indefinitely-
 *  valid inbox credential this TTL exists to kill. The TTL therefore applies to
 *  every non-terminal status, with ONE exception: a call that is live RIGHT NOW
 *  (isInterviewSessionLive — the same recency window /create's reissue guard
 *  uses) outlives it, so a mid-conversation reconnect on a link that ages past
 *  the TTL during the call is never cut off.
 *
 *  `completed` and `revoked` are terminal and keep their own semantics (both
 *  call sites check them before asking about expiry). /complete deliberately
 *  never consults this: a transcript from an expired link is still persisted. */
export function isInterviewLinkExpired(session: {
  status: string;
  createdAt: string;
  updatedAt?: string | null;
}): boolean {
  if (session.status === "completed" || session.status === "revoked") return false;
  if (isInterviewSessionLive({ status: session.status, createdAt: session.createdAt, updatedAt: session.updatedAt ?? null })) {
    return false;
  }
  return Date.parse(session.createdAt) < Date.now() - INTERVIEW_LINK_TTL_DAYS * 86_400_000;
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
 *  kills prior ones) and the terminal-transition cleanup. Returns the count.
 *
 *  Tenant-scoped (direction 1). `entry_id` is globally unique, so the bare read
 *  this replaces let an operator on ANY team pull another team's live interview
 *  credential by id alone; a foreign entry now revokes nothing and the route
 *  answers the same 404 its siblings do. The tenant is a DEFAULTED parameter on
 *  purpose — that is the shape `route-tenancy-coverage.test.ts` derives, so a
 *  route that forgets to thread it is a red build rather than a silent
 *  default-team write. */
export function revokeOpenInterviewSessions(entryId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): number {
  const db = ensureDb();
  const res = db
    .prepare(
      `UPDATE interview_sessions SET status='revoked' WHERE entry_id = ? AND workspace_id = ? AND status IN ('created','in_progress','failed')`
    )
    .run(entryId, workspaceId);
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
 *  can never disagree with the card indicator it was opened from.
 *
 *  Tenant-scoped (direction 1): this returns the transcript AND the scorecard,
 *  the most sensitive pair in the product, and it was reachable by entry id
 *  alone from any team. */
export function latestInterviewByEntry(entryId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): InterviewSession | null {
  const r = ensureDb()
    .prepare(
      `SELECT * FROM interview_sessions WHERE entry_id = ? AND workspace_id = ?
       ORDER BY (transcript_json IS NOT NULL AND transcript_json != '[]') DESC, created_at DESC LIMIT 1`
    )
    .get(entryId, workspaceId) as InterviewRow | undefined;
  return r ? rowToInterview(r) : null;
}

/** The newest live-candidate (in_progress) session for an entry — /create's
 *  reissue-guard read. Deliberately NOT latestInterviewByEntry: that read
 *  prefers transcript-bearing sessions, which would hide an active call behind
 *  an older completed one.
 *
 *  Tenant-scoped (direction 1), like its two neighbours above. */
export function liveInterviewByEntry(entryId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): InterviewSession | null {
  const r = ensureDb()
    .prepare(
      `SELECT * FROM interview_sessions WHERE entry_id = ? AND workspace_id = ? AND status = 'in_progress' ORDER BY created_at DESC LIMIT 1`
    )
    .get(entryId, workspaceId) as InterviewRow | undefined;
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
          // attempts counts CONNECTS, and the first one is already the 1 the column
          // defaults to — so it increments only when started_at is already set, i.e.
          // this is a reconnect on a link that has been live before. Computed in SQL
          // off the pre-UPDATE row (same statement, so no read-then-write race) and
          // inside the same status guard, so a refused connect on a completed session
          // cannot inflate the count.
          `UPDATE interview_sessions SET status='in_progress', started_at=COALESCE(started_at, ?), consent_at=COALESCE(consent_at, ?), updated_at=?,
                  attempts = attempts + (CASE WHEN started_at IS NULL THEN 0 ELSE 1 END)
             WHERE id=? AND status != 'completed'`
        )
        .run(now, now, now, id).changes > 0
    );
  }
  return (
    db
      .prepare(
        `UPDATE interview_sessions SET status='in_progress', started_at=COALESCE(started_at, ?), updated_at=?,
                attempts = attempts + (CASE WHEN started_at IS NULL THEN 0 ELSE 1 END)
           WHERE id=? AND status != 'completed'`
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

/** Persist the provider that ACTUALLY served a session — written by /connect when
 *  it fails over to the alternate provider (the preferred one's connect threw). The
 *  ledger row (voiceUsageRow) and the completion path both read session.provider, so
 *  updating it here keeps cost attribution + telemetry pointed at what served, not at
 *  what was requested. Guarded to a live (non-completed) row so a raced /complete
 *  can't be perturbed. */
export function setInterviewSessionProvider(
  id: string,
  provider: VoiceProviderId,
  /** The provider the call was asked to serve, when THIS write is a failover. Stored
   *  with COALESCE so the FIRST fallen-from provider wins: that is the one the
   *  recruiter actually chose, and a second failover on the same link must not
   *  rewrite it into an intermediate. Omitted for a plain provider write, which then
   *  leaves the column alone rather than inventing "fell back from itself". */
  failoverFrom?: VoiceProviderId | null
): void {
  const db = ensureDb();
  db.prepare(
    `UPDATE interview_sessions SET provider=?, failover_from=COALESCE(failover_from, ?), updated_at=? WHERE id=? AND status != 'completed'`
  ).run(provider, failoverFrom ?? null, new Date().toISOString(), id);
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
