import { coerceInterviewRecommendation, type InterviewRecommendation } from "../interview-recommendation";
import type { ScorecardRating } from "../interview-scorecard";
import { coerceProviderId, type VoiceProviderId, type VoiceTurn } from "../voice/types";
import type { InterviewAgenda, RecordingDeleteReason, RecordingMeta } from "../voice/director-types";
import { randomId, randomToken } from "../random-id";
import { chunk, SQL_IN_CHUNK } from "../entries-param";
import {
  finalizeFromGuard,
  isInterviewSessionStatus,
  LIVE_INTERVIEW_STATUS,
  statusFromGuard,
  type InterviewSessionStatus,
} from "../interview-session-status";
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
  /** The session this row is (challenge-r07 voice-interview-api/B) and the director's
   *  agenda stored on it (null for an undirected call) — the compare route's inputs for
   *  per-axis coverage. OPERATOR-side only: the compare route consumes both and strips
   *  them from its payload (the agenda carries question text and block titles). */
  sessionId: string;
  agenda: InterviewAgenda | null;
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
      // disagree about what a call cost. `outcome = 'ok'` for the same reason it is
      // named in every other money read (tiger X2): a failed attempt is a row here
      // now, and it must not be able to reach a cost the UI presents as spent.
      //
      // CANDIDATES only (`s.mode = 'candidate'`, the rule listRecentInterviewSessions
      // already follows): a recruiter's kit rehearsal is minted as mode 'test' WITH the
      // job id (jobs/[id]/interview-kit/rehearse), and it used to enter this cohort as
      // a null-labelled "candidate" with blank ratings and its own voice cost.
      `SELECT s.id, s.entry_id, s.candidate_label, s.scorecard_json, s.ended_at, s.agenda_json,
              (SELECT SUM(u.cost_usd) FROM llm_usage u
                WHERE u.request_id = s.id AND u.use_case = 'interview_realtime'
                  AND u.outcome = 'ok') AS cost_usd
         FROM interview_sessions s
        WHERE s.job_id = ? AND s.status = 'completed' AND s.mode = 'candidate' AND s.workspace_id = ?
        ORDER BY s.ended_at DESC`
    )
    .all(jobId, workspaceId) as {
    id: string;
    entry_id: string | null;
    candidate_label: string | null;
    scorecard_json: string | null;
    ended_at: string | null;
    agenda_json: string | null;
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
      sessionId: r.id,
      agenda: safeRowParse<InterviewAgenda>(r.agenda_json ?? null, "interviewedCandidates.agenda", r.id),
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
  /** The director's agenda (block ids, budgets, competencies), built at connect for
   *  both providers. NULL until the first connect, and on every pre-director row. */
  agenda: InterviewAgenda | null;
  /** When the candidate agreed to an AUDIO recording — separate from `consentAt`,
   *  which covers the transcribed conversation. NULL = not recorded. */
  recordingConsentAt: string | null;
  /** One entry per recorded attempt, including deleted ones (the deletion is the record). */
  recordings: RecordingMeta[];
  /** The last director exchange of a live call (touchInterviewActivity). NULL before
   *  the first one and on every undirected call. Liveness only — never a clock. */
  lastActivityAt: string | null;
  /** The job kit version this link was minted from (interview_kits.id), pinned at mint
   *  so an edit cannot change what a candidate already holding a link is asked. NULL
   *  when the job has no kit. */
  kitId: string | null;
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
  agenda_json: string | null;
  recording_consent_at: string | null;
  recordings_json: string | null;
  last_activity_at: string | null;
  kit_id: string | null;
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
    agenda: safeRowParse<InterviewAgenda>(r.agenda_json ?? null, "interview.agenda", r.id),
    recordingConsentAt: r.recording_consent_at ?? null,
    recordings: safeRowParse<RecordingMeta[]>(r.recordings_json ?? null, "interview.recordings", r.id) ?? [],
    lastActivityAt: r.last_activity_at ?? null,
    kitId: r.kit_id ?? null,
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
      // `outcome = 'ok'` excludes a failed attempt (tiger X2) — it carries no cost to
      // sum, and naming it keeps this read honest if one ever does.
      `SELECT s.id, s.entry_id, s.candidate_label, s.job_id, s.job_title, s.provider, s.status,
              s.started_at, s.ended_at, s.created_at, s.failover_from, s.attempts,
              (s.transcript_json IS NOT NULL AND s.transcript_json != '[]') AS has_transcript, s.scorecard_json,
              (SELECT SUM(u.cost_usd) FROM llm_usage u
                WHERE u.request_id = s.id AND u.use_case = 'interview_realtime'
                  AND u.outcome = 'ok') AS cost_usd
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
  /** The job kit VERSION this link is pinned to (interview_kits.id), resolved by the
   *  mint (interview-invite.ts) from the job's latest PUBLISHED kit. Written once, at
   *  create, and never moved: a kit edit publishes a new version, and a candidate
   *  already holding a link must keep facing the questions their round opened with.
   *  NULL when the job has no kit — every pre-kit path passes nothing and behaves
   *  exactly as it did. */
  kitId?: string | null;
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
       (id, token, entry_id, candidate_label, job_id, job_title, provider, language, mode, status, instructions, run_of_show_json, duration_min, created_at, workspace_id, kit_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?, ?, ?, ?, ?)`
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
    workspaceId,
    input.kitId ?? null
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
 *  from the recency window above.
 *
 *  The window runs from the LATER of the connect (updated_at) and the last director
 *  exchange (last_activity_at). A directed call can outlast the window measured from
 *  its connect alone — it may run to the agenda's hard cap + 2 min — and while its
 *  browser keeps talking to the director it is live, however long ago it connected. */
export function isInterviewSessionLive(session: {
  status: string;
  createdAt: string;
  updatedAt: string | null;
  lastActivityAt?: string | null;
}): boolean {
  if (session.status !== "in_progress") return false;
  const connected = Date.parse(session.updatedAt ?? session.createdAt);
  const active = session.lastActivityAt ? Date.parse(session.lastActivityAt) : Number.NaN;
  const touched = Math.max(Number.isFinite(connected) ? connected : -Infinity, Number.isFinite(active) ? active : -Infinity);
  return Number.isFinite(touched) && touched > Date.now() - LIVE_INTERVIEW_RECENCY_MIN * 60_000;
}

/** Stamp a live call's last director exchange (liveness only). Never touches
 *  updated_at, which is the current attempt's start for billing and the director's
 *  clock. Guarded to in_progress rows: a completed or revoked call stays as it ended. */
export function touchInterviewActivity(id: string, atIso: string): boolean {
  const res = ensureDb()
    .prepare(`UPDATE interview_sessions SET last_activity_at=? WHERE id=? AND status='in_progress'`)
    .run(atIso, id);
  return res.changes > 0;
}

/** Revoke one open interview session. Concurrency guard in the WHERE (repo
 *  convention): never touches completed (the transcript is evidence) and a
 *  re-revoke is a no-op. `failed` is revocable — reconnectable-by-design ends
 *  when the recruiter pulls the link. */
export function revokeInterviewSession(id: string): boolean {
  const db = ensureDb();
  const res = db
    .prepare(`UPDATE interview_sessions SET status='revoked' WHERE id = ? AND ${statusFromGuard("revoked")}`)
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
      `UPDATE interview_sessions SET status='revoked' WHERE entry_id = ? AND workspace_id = ? AND ${statusFromGuard("revoked")}`
    )
    .run(entryId, workspaceId);
  return res.changes;
}

/** Latest interview session per entry (for the Schedule tab indicator). A
 *  session WITH a transcript outranks a newer empty one: a reissued link minted
 *  while (or after) a call completed used to become the surfaced row, so
 *  hasTranscript read false and a finished, scored interview turned invisible
 *  on every recruiter surface (voice-interview-runtime #2).
 *
 *  Tenant-scoped (wave 18b), like `latestInterviewByEntry` / `liveInterviewByEntry`
 *  beside it. It was the LAST entry_id read here that took no workspace, and the
 *  tenancy test carried a blanket entry_id exemption to cover it — so "did this
 *  candidate sit an interview" (and, through /api/data, what a GDPR self-service
 *  answer claims we hold about them) was answerable across tenants by entry id
 *  alone. The exemption is now narrowed to id/token point reads, which are the
 *  genuinely global capabilities (the candidate token IS the credential). */
export function interviewStatusByEntries(
  entryIds: string[],
  workspaceId: string = DEFAULT_WORKSPACE_ID
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
         WHERE s.entry_id IN (${placeholders}) AND s.workspace_id = ?
         ORDER BY has_tr DESC, s.created_at DESC`
      )
      .all(...ids, workspaceId) as { id: string; entry_id: string; status: string; ended_at: string | null; has_tr: number }[];
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

/** Point read for a GATED recruiter surface: the session only if it belongs to the
 *  caller's team. Insights → Activity resolves a ledger row's session id through
 *  this, so a foreign id answers null exactly like an unknown one. */
export function getInterviewSessionInWorkspace(id: string, workspaceId: string = DEFAULT_WORKSPACE_ID): InterviewSession | null {
  const r = ensureDb().prepare(`SELECT * FROM interview_sessions WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as InterviewRow | undefined;
  return r ? rowToInterview(r) : null;
}

export function getInterviewSessionById(id: string): InterviewSession | null {
  const r = ensureDb().prepare(`SELECT * FROM interview_sessions WHERE id = ?`).get(id) as InterviewRow | undefined;
  return r ? rowToInterview(r) : null;
}

/** Point read by the candidate's capability token.
 *
 *  `workspaceId` is OPTIONAL and defaults to no tenant filter — deliberately, and
 *  unlike the entry-keyed reads above. The public surfaces (`/interview/[token]`,
 *  /api/interview/connect, /api/interview/complete) have no session and no tenant:
 *  the token IS the credential, and scoping them to a workspace would break every
 *  candidate on a non-default team. A GATED recruiter action, on the other hand,
 *  has a caller whose tenant is the authority and must pass it — see
 *  /api/interview/simulate/attach, which was reading practice runs across tenants. */
export function getInterviewSessionByToken(token: string, workspaceId?: string): InterviewSession | null {
  const r = (
    workspaceId
      ? ensureDb().prepare(`SELECT * FROM interview_sessions WHERE token = ? AND workspace_id = ?`).get(token, workspaceId)
      : ensureDb().prepare(`SELECT * FROM interview_sessions WHERE token = ?`).get(token)
  ) as InterviewRow | undefined;
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
 *  the session actually went live so the route can refuse to mint credentials.
 *
 *  The guard is the transition table's from-set for `in_progress`
 *  (interview-session-status.ts), so a REVOKED link cannot be reopened either: it
 *  used to exclude `completed` alone, and a connect on a revoked row flipped it
 *  back to live, undoing the recruiter's one control over the credential. */
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
             WHERE id=? AND ${statusFromGuard("in_progress")}`
        )
        .run(now, now, now, id).changes > 0
    );
  }
  return (
    db
      .prepare(
        `UPDATE interview_sessions SET status='in_progress', started_at=COALESCE(started_at, ?), updated_at=?,
                attempts = attempts + (CASE WHEN started_at IS NULL THEN 0 ELSE 1 END)
           WHERE id=? AND ${statusFromGuard("in_progress")}`
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
 *  writable: a successful retry after a dropped call may upgrade it.
 *
 *  A REVOKED row takes the transcript (what was said is evidence) but KEEPS its
 *  status, decided by the SQL off the row as it is at the write — not by the
 *  caller's pre-read, which a revoke landing in between made stale. `status` is
 *  what the row holds after this call (from RETURNING, so it is the write's own
 *  answer, not a second read), and the route bills and scores from it. */
export function completeInterviewSession(
  id: string,
  input: { transcript: VoiceTurn[]; scorecard?: unknown; status?: InterviewSessionStatus }
): { session: InterviewSession | null; applied: boolean; status: string | null } {
  const target = input.status ?? "completed";
  if (!isInterviewSessionStatus(target)) throw new Error(`unknown interview session status '${String(target)}'`);
  const db = ensureDb();
  const now = new Date().toISOString();
  const written = db
    .prepare(
      `UPDATE interview_sessions SET status = CASE WHEN status = 'revoked' THEN 'revoked' ELSE ? END,
              ended_at=?, transcript_json=?, scorecard_json=COALESCE(?, scorecard_json), updated_at=?
        WHERE id=? AND ${finalizeFromGuard(target)}
        RETURNING status`
    )
    .get(
      target,
      now,
      JSON.stringify(input.transcript ?? []),
      input.scorecard !== undefined ? JSON.stringify(input.scorecard) : null,
      now,
      id
    ) as { status: string } | undefined;
  const session = getInterviewSessionById(id);
  return { session, applied: written !== undefined, status: written?.status ?? session?.status ?? null };
}

/** Persist the provider that ACTUALLY served a session — written by /connect when
 *  it fails over to the alternate provider (the preferred one's connect threw). The
 *  ledger row (voiceUsageRow) and the completion path both read session.provider, so
 *  updating it here keeps cost attribution + telemetry pointed at what served, not at
 *  what was requested. Guarded to a LIVE row (`in_progress`): /connect writes it after
 *  the provider connect, and a row that left live meanwhile — revoked, or finalized by
 *  a raced /complete — must take nothing. Returns whether the row took it, and the
 *  route refuses to hand out the credentials it just minted when it did not. */
export function setInterviewSessionProvider(
  id: string,
  provider: VoiceProviderId,
  /** The provider the call was asked to serve, when THIS write is a failover. Stored
   *  with COALESCE so the FIRST fallen-from provider wins: that is the one the
   *  recruiter actually chose, and a second failover on the same link must not
   *  rewrite it into an intermediate. Omitted for a plain provider write, which then
   *  leaves the column alone rather than inventing "fell back from itself". */
  failoverFrom?: VoiceProviderId | null
): boolean {
  const db = ensureDb();
  const res = db
    .prepare(
      `UPDATE interview_sessions SET provider=?, failover_from=COALESCE(failover_from, ?), updated_at=? WHERE id=? AND status='${LIVE_INTERVIEW_STATUS}'`
    )
    .run(provider, failoverFrom ?? null, new Date().toISOString(), id);
  return res.changes > 0;
}

/** Persist the director's agenda built at connect (spark ai-interview-parity). The
 *  director validates tool calls against it and the recruiter's evidence view reads
 *  its competencies, so it is written on every connect that built one — the stored
 *  copy always matches the brief the provider was just given. Guarded to a LIVE row
 *  like every other post-connect write: a raced /complete is never perturbed and a
 *  revoke during the kit build is never written past. Returns whether the row took
 *  it; /connect refuses the call when it did not. */
export function setInterviewAgenda(id: string, agenda: InterviewAgenda): boolean {
  const res = ensureDb()
    .prepare(`UPDATE interview_sessions SET agenda_json=? WHERE id=? AND status='${LIVE_INTERVIEW_STATUS}'`)
    .run(JSON.stringify(agenda), id);
  return res.changes > 0;
}

/** Whether a session is still LIVE (`in_progress`) — the last gate before /connect
 *  hands the credentials it minted to the browser. The effect it guards is the HTTP
 *  response, not a store write, and the route returns synchronously after asking, so
 *  a point read here is the compare step of that compare-and-act: a revoke (or a raced
 *  /complete) that landed during the kit build or the provider connect is seen, and
 *  the minted credentials are dropped rather than handed out. */
export function isInterviewSessionStillLive(id: string): boolean {
  const r = ensureDb()
    .prepare(`SELECT 1 AS live FROM interview_sessions WHERE id=? AND status='${LIVE_INTERVIEW_STATUS}'`)
    .get(id) as { live: number } | undefined;
  return r !== undefined;
}

/** Stamp the candidate's AUDIO-recording consent — separate from `consent_at` (the
 *  transcribed conversation). COALESCE keeps the FIRST agreement: a reconnect that
 *  repeats it must not move the record of when consent was given. The caller gates
 *  this on the workspace actually offering recording (interview-recording.ts). Written
 *  by /connect right after the start, so it is guarded to the LIVE row like the other
 *  post-connect writes. */
export function markInterviewRecordingConsent(id: string): boolean {
  const now = new Date().toISOString();
  const res = ensureDb()
    .prepare(
      `UPDATE interview_sessions SET recording_consent_at=COALESCE(recording_consent_at, ?) WHERE id=? AND status='${LIVE_INTERVIEW_STATUS}'`
    )
    .run(now, id);
  return res.changes > 0;
}

// ---- Recordings (opt-in candidate microphone audio) -----------------------
//
// The FILES live under the data dir (app/_lib/interview-recording.ts); this column is
// their ledger. Every function here is module-prefixed (`…InterviewRecording…`) because
// the route-tenancy ratchet matches store functions by NAME across the tree, and every
// one is workspace-scoped: a recording is candidate audio, the single most sensitive
// artifact the product holds, and it must never be reachable by session id alone.
//
// A DELETED recording keeps its row. The deletion IS the record — "we held audio of
// this call and it is gone, for this reason, at this time" is exactly what a candidate
// or a regulator asks, and an erased entry in an array cannot answer it.

/** The per-attempt ledger's read→compute→write helpers all share this shape. */
export type RecordingChunkClaim = {
  /** `claimed` — the chunk is ours to append. `duplicate` — a replay at or below the
   *  stored cursor, already on disk, acknowledge and append nothing. `full` — the
   *  session's byte budget is spent (the attempt is marked partial). `missing` — no
   *  such session in this workspace. */
  outcome: "claimed" | "duplicate" | "full" | "missing";
  meta: RecordingMeta | null;
  /** True when this claim CREATED the attempt's record — the caller writes the
   *  `recording_started` event exactly once off this flag. */
  first: boolean;
};

function readRecordings(db: ReturnType<typeof ensureDb>, sessionId: string, workspaceId: string): RecordingMeta[] | null {
  const row = db
    .prepare(`SELECT recordings_json FROM interview_sessions WHERE id = ? AND workspace_id = ?`)
    .get(sessionId, workspaceId) as { recordings_json: string | null } | undefined;
  if (!row) return null;
  return safeRowParse<RecordingMeta[]>(row.recordings_json ?? null, "interview.recordings", sessionId) ?? [];
}

/**
 * Claim ONE chunk of an attempt's recording: the cursor bump, the byte accounting and
 * the per-session ceiling, decided under the write lock and written back in the same
 * statement batch.
 *
 * IMMEDIATE, not a plain `tx()` — this is the canonical read→compute→write (read the
 * ledger, decide duplicate/full/claimed, write the new ledger) and two chunks of the
 * same call arriving together on different connections must not both pass the read.
 * Synchronous throughout: the FILE append happens in the caller, AFTER this returns,
 * so no await can ever sit between BEGIN and COMMIT.
 *
 * The claim is deliberately taken BEFORE the bytes are written: a crash between the two
 * leaves the ledger claiming bytes the file does not have, which the caller answers by
 * marking the attempt `partial` — the honest direction. The reverse order would let a
 * replay append the same audio twice.
 */
export function claimInterviewRecordingChunk(input: {
  sessionId: string;
  workspaceId: string;
  attempt: number;
  /** 0-based, per attempt. */
  chunk: number;
  bytes: number;
  mime: string;
  /** File name relative to the workspace's recordings folder — built by the caller
   *  from SERVER ids only (interview-recording-paths.recordingFileName). */
  file: string;
  maxSessionBytes: number;
  nowIso?: string;
}): RecordingChunkClaim {
  const db = ensureDb();
  const now = input.nowIso ?? new Date().toISOString();
  const tx = db.transaction((): RecordingChunkClaim => {
    const recordings = readRecordings(db, input.sessionId, input.workspaceId);
    if (recordings === null) return { outcome: "missing", meta: null, first: false };
    const idx = recordings.findIndex((r) => r.attempt === input.attempt);
    const existing = idx >= 0 ? recordings[idx]! : null;
    // A replayed chunk (a retried POST, a browser that re-sent after a timeout) is
    // ALREADY on disk. Acknowledge it — a client that cannot settle keeps retrying —
    // and change nothing.
    if (existing && typeof existing.lastChunk === "number" && input.chunk <= existing.lastChunk) {
      return { outcome: "duplicate", meta: existing, first: false };
    }
    // The ceiling counts every attempt of this session, including deleted ones: what is
    // bounded is how much audio ONE interview link may ever push onto the disk.
    const held = recordings.reduce((sum, r) => sum + (Number.isFinite(r.bytes) ? r.bytes : 0), 0);
    if (held + input.bytes > input.maxSessionBytes) {
      const marked: RecordingMeta[] = existing
        ? recordings.map((r, i) => (i === idx ? { ...r, partial: true, endedAt: r.endedAt ?? now } : r))
        : recordings;
      db.prepare(`UPDATE interview_sessions SET recordings_json = ? WHERE id = ? AND workspace_id = ?`).run(
        JSON.stringify(marked),
        input.sessionId,
        input.workspaceId
      );
      return { outcome: "full", meta: idx >= 0 ? marked[idx]! : null, first: false };
    }
    const next: RecordingMeta = existing
      ? { ...existing, bytes: existing.bytes + input.bytes, endedAt: now, lastChunk: input.chunk }
      : {
          attempt: input.attempt,
          file: input.file,
          bytes: input.bytes,
          mime: input.mime,
          startedAt: now,
          endedAt: now,
          partial: false,
          deletedAt: null,
          deleteReason: null,
          lastChunk: input.chunk,
        };
    const merged = existing ? recordings.map((r, i) => (i === idx ? next : r)) : [...recordings, next];
    db.prepare(`UPDATE interview_sessions SET recordings_json = ? WHERE id = ? AND workspace_id = ?`).run(
      JSON.stringify(merged),
      input.sessionId,
      input.workspaceId
    );
    return { outcome: "claimed", meta: next, first: existing === null };
  });
  return tx.immediate();
}

/** Flag an attempt's recording as incomplete — an upload that failed after its claim,
 *  or a session that hit the byte ceiling. Never deletes: a partial recording is still
 *  the candidate's audio, and the recruiter is told it is partial rather than shown
 *  nothing. */
export function markInterviewRecordingPartial(sessionId: string, workspaceId: string, attempt: number): boolean {
  const db = ensureDb();
  const tx = db.transaction((): boolean => {
    const recordings = readRecordings(db, sessionId, workspaceId);
    if (!recordings || !recordings.some((r) => r.attempt === attempt)) return false;
    const merged = recordings.map((r) => (r.attempt === attempt ? { ...r, partial: true } : r));
    db.prepare(`UPDATE interview_sessions SET recordings_json = ? WHERE id = ? AND workspace_id = ?`).run(
      JSON.stringify(merged),
      sessionId,
      workspaceId
    );
    return true;
  });
  return tx.immediate();
}

/** Record that an attempt's FILE is gone. Called AFTER the unlink, never before: a
 *  crash between the two then leaves a row that still says "held", which the next sweep
 *  simply re-runs — the opposite order would leave a row claiming a deletion that never
 *  happened. Returns the attempts actually marked (a second call is a no-op). */
export function markInterviewRecordingsDeleted(
  sessionId: string,
  workspaceId: string,
  attempts: readonly number[],
  reason: RecordingDeleteReason,
  nowIso: string = new Date().toISOString()
): number[] {
  if (attempts.length === 0) return [];
  const db = ensureDb();
  const wanted = new Set(attempts);
  const tx = db.transaction((): number[] => {
    const recordings = readRecordings(db, sessionId, workspaceId);
    if (!recordings) return [];
    const marked: number[] = [];
    const merged = recordings.map((r) => {
      if (!wanted.has(r.attempt) || r.deletedAt) return r;
      marked.push(r.attempt);
      return { ...r, deletedAt: nowIso, deleteReason: reason };
    });
    if (marked.length === 0) return [];
    db.prepare(`UPDATE interview_sessions SET recordings_json = ? WHERE id = ? AND workspace_id = ?`).run(
      JSON.stringify(merged),
      sessionId,
      workspaceId
    );
    return marked;
  });
  return tx.immediate();
}

/** One session's recording ledger, scoped to the team that owns it. Null when the id
 *  names no session of THIS workspace — the same answer an unknown id gives, so the
 *  door is never an existence oracle across tenants. */
export function interviewRecordingsForSession(sessionId: string, workspaceId: string): RecordingMeta[] | null {
  return readRecordings(ensureDb(), sessionId, workspaceId);
}

/** A session that still holds at least one undeleted recording, with the timestamps the
 *  retention rule needs. */
export type RecordingRetentionRow = {
  sessionId: string;
  workspaceId: string;
  entryId: string | null;
  recordings: RecordingMeta[];
  /** The call's own clock — the backstop is measured from here. */
  callAt: string | null;
  /** The entry's status/stage/stamps, for the hiring-decision anchor. Null for a
   *  session with no pipeline entry (a lab or simulation run). */
  entryStatus: string | null;
  entryStage: string | null;
  entryStageChangedAt: string | null;
  entryUpdatedAt: string | null;
};

function toRetentionRows(rows: RetentionRow[]): RecordingRetentionRow[] {
  const out: RecordingRetentionRow[] = [];
  for (const r of rows) {
    const recordings = safeRowParse<RecordingMeta[]>(r.recordings_json ?? null, "interview.recordings", r.id) ?? [];
    if (!recordings.some((m) => !m.deletedAt)) continue;
    out.push({
      sessionId: r.id,
      workspaceId: r.workspace_id ?? DEFAULT_WORKSPACE_ID,
      entryId: r.entry_id,
      recordings,
      callAt: r.started_at ?? r.created_at,
      entryStatus: r.entry_status ?? null,
      entryStage: r.entry_stage ?? null,
      entryStageChangedAt: r.entry_stage_changed_at ?? null,
      entryUpdatedAt: r.entry_updated_at ?? null,
    });
  }
  return out;
}

type RetentionRow = {
  id: string;
  workspace_id: string | null;
  entry_id: string | null;
  recordings_json: string | null;
  started_at: string | null;
  created_at: string;
  entry_status: string | null;
  entry_stage: string | null;
  entry_stage_changed_at: string | null;
  entry_updated_at: string | null;
};

// The three reads below spell their SELECT list out rather than sharing a constant.
// That is deliberate and it is not style: the tenancy guards in this repo are SOURCE
// scans over the template literals in this file (interviews-tenancy.test.ts), and a
// query assembled from `${COLUMNS}` hides its own scoping from every one of them — a
// guard that cannot read the SQL is a guard that passes on a name.

/** EVERY tenant's sessions that still hold audio — the nightly retention sweep's read.
 *  Deliberately unscoped (`-- tenancy:global`, the shape `anonymizeExpiredConsents`
 *  uses): storage limitation is a deployment-wide duty, and each row carries its own
 *  workspace_id so every WRITE the sweep performs is scoped again. */
export function listInterviewRecordingsDue(limit = 2000): RecordingRetentionRow[] {
  const rows = ensureDb()
    .prepare(
      `SELECT s.id, s.workspace_id, s.entry_id, s.recordings_json, s.started_at, s.created_at,
              e.status AS entry_status, e.stage AS entry_stage,
              e.stage_changed_at AS entry_stage_changed_at, e.updated_at AS entry_updated_at
         FROM interview_sessions s -- tenancy:global
         LEFT JOIN pipeline_entries e ON e.id = s.entry_id
        WHERE s.recordings_json IS NOT NULL AND s.recordings_json != '[]'
        ORDER BY s.created_at ASC
        LIMIT ?`
    )
    .all(Math.max(1, Math.min(Math.trunc(limit), 20_000))) as RetentionRow[];
  return toRetentionRows(rows);
}

/** ONE session's retention row, scoped to the caller's team — the recruiter playback
 *  door's read. Null when the session holds no live recording, when the id belongs to
 *  another workspace, or when it names nothing: one answer for all three, so the door
 *  cannot be used to learn which candidates were recorded. */
export function interviewRecordingRowForSession(sessionId: string, workspaceId: string): RecordingRetentionRow | null {
  const rows = ensureDb()
    .prepare(
      `SELECT s.id, s.workspace_id, s.entry_id, s.recordings_json, s.started_at, s.created_at,
              e.status AS entry_status, e.stage AS entry_stage,
              e.stage_changed_at AS entry_stage_changed_at, e.updated_at AS entry_updated_at
         FROM interview_sessions s
         LEFT JOIN pipeline_entries e ON e.id = s.entry_id
        WHERE s.id = ? AND s.workspace_id = ?`
    )
    .all(sessionId, workspaceId) as RetentionRow[];
  return toRetentionRows(rows)[0] ?? null;
}

/** One entry's sessions that still hold audio, scoped to its team — the GDPR erasure
 *  path and the candidate's own "delete my recording" door. */
export function listInterviewRecordingsForEntry(entryId: string, workspaceId: string): RecordingRetentionRow[] {
  const rows = ensureDb()
    .prepare(
      `SELECT s.id, s.workspace_id, s.entry_id, s.recordings_json, s.started_at, s.created_at,
              e.status AS entry_status, e.stage AS entry_stage,
              e.stage_changed_at AS entry_stage_changed_at, e.updated_at AS entry_updated_at
         FROM interview_sessions s
         LEFT JOIN pipeline_entries e ON e.id = s.entry_id
        WHERE s.entry_id = ? AND s.workspace_id = ?
          AND s.recordings_json IS NOT NULL AND s.recordings_json != '[]'
        ORDER BY s.created_at ASC`
    )
    .all(entryId, workspaceId) as RetentionRow[];
  return toRetentionRows(rows);
}

/** Attach the synthesized scorecard to an already-persisted session. Separate
 *  from completeInterviewSession so the transcript write can happen FIRST and
 *  scoring strictly after it (idea-55fd89f9) — a scoring step that sets the
 *  Interview→Offer approval must never run ahead of the durable transcript it
 *  scores.
 *
 *  It lands AFTER an awaited LLM synthesis, so it is a conditional write: only a
 *  `completed` row that still holds a transcript takes it. A GDPR erasure during
 *  the scoring await (scrubEntryLinkedPii sets transcript_json='[]' and
 *  scorecard_json=NULL, because the scorecard quotes the candidate) and a revoke
 *  both leave the row refusing, and `applied: false` tells the route to skip the
 *  decision seal as well. It used to be an unguarded write by id. */
export function attachInterviewScorecard(
  id: string,
  scorecard: unknown
): { session: InterviewSession | null; applied: boolean } {
  const db = ensureDb();
  const now = new Date().toISOString();
  const res = db
    .prepare(
      `UPDATE interview_sessions SET scorecard_json=?, updated_at=?
        WHERE id=? AND status='completed' AND transcript_json IS NOT NULL AND transcript_json != '[]'`
    )
    .run(JSON.stringify(scorecard), now, id);
  return { session: getInterviewSessionById(id), applied: res.changes > 0 };
}
