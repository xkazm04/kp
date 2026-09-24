// The interview DIRECTOR's append-only event record (spark ai-interview-parity; ADR
// 0010 "provider brain + our director").
//
// One row per thing that happened in a live AI interview: a finalized turn, a tool
// call the interviewer model made (topic begun / covered / rejected, guardrail,
// forwarded question, end request), a stage direction the director injected, and the
// observations only the browser can make (focus lost/returned, answer timing). The
// director's state — where the conversation is, what is covered, how much live time
// is spent — is DERIVED from these rows (voice/director.ts), never stored beside them,
// so a reconnect, a retried POST and a recruiter's evidence view all read one truth.
//
// Rules this module holds:
//   - APPEND-ONLY. There is no UPDATE here. The only other write is the erasure
//     DELETE in db/pipeline.ts scrubEntryLinkedPii (GDPR Art. 17 — the turns are the
//     candidate's verbatim words).
//   - WORKSPACE-SCOPED on every statement (interview-events-tenancy.test.ts). The
//     INSERT is an INSERT…SELECT against the session row filtered by the same
//     workspace, so an event can never be filed under a session another team owns.
//   - TURNS ARE IDEMPOTENT on (session_id, attempt, seq) through the partial unique
//     index in core.ts: a retried POST re-sends the same turns and nothing doubles.
//   - Names are module-prefixed (`…InterviewEvents`): the route-tenancy ratchet
//     matches store functions by NAME across the tree.
//
// Every function is synchronous; callers may compose them inside
// withInterviewEventsLock (an IMMEDIATE transaction) — never with an await inside.

import { INTERVIEW_EVENT_KINDS, type InterviewEventKind } from "../voice/director-types";
import { randomId } from "../random-id";
import { ensureDb, safeRowParse } from "./core";

export type InterviewEvent = {
  id: string;
  sessionId: string;
  workspaceId: string;
  /** interview_sessions.attempts the event belongs to (1 = the first connect). */
  attempt: number;
  /** Per-attempt turn number for `turn` rows; null for every other kind. */
  seq: number | null;
  kind: InterviewEventKind;
  /** The agenda block the event is about (or was recorded during), when there is one. */
  blockId: string | null;
  payload: Record<string, unknown>;
  /** When it happened — the browser's stamp for client-originated rows (clamped by
   *  the caller so it is never in the server's future), the server clock otherwise. */
  at: string;
  /** When the server recorded it. The director's elapsed-time arithmetic runs on this
   *  clock only, so a skewed browser clock cannot stretch or shrink the interview. */
  createdAt: string;
};

/** A row to append. `at` defaults to the server's record time. */
export type NewInterviewEvent = {
  sessionId: string;
  attempt: number;
  seq?: number | null;
  kind: InterviewEventKind;
  blockId?: string | null;
  payload?: Record<string, unknown>;
  at?: string;
};

type InterviewEventRow = {
  id: string;
  session_id: string;
  workspace_id: string;
  attempt: number;
  seq: number | null;
  kind: string;
  block_id: string | null;
  payload_json: string | null;
  at: string;
  created_at: string;
};

const KNOWN_KINDS: ReadonlySet<string> = new Set(INTERVIEW_EVENT_KINDS);

function rowToInterviewEvent(r: InterviewEventRow): InterviewEvent {
  return {
    id: r.id,
    sessionId: r.session_id,
    workspaceId: r.workspace_id,
    attempt: Number(r.attempt),
    seq: r.seq == null ? null : Number(r.seq),
    kind: r.kind as InterviewEventKind,
    blockId: r.block_id,
    payload: safeRowParse<Record<string, unknown>>(r.payload_json, "interview_events.payload", r.id) ?? {},
    at: r.at,
    createdAt: r.created_at,
  };
}

/**
 * Append events for ONE workspace in a single synchronous transaction, and return the
 * rows that were actually written (a replayed turn is absorbed by the unique index and
 * is NOT in the result). Rows whose session is not in `workspaceId` write nothing —
 * the INSERT selects its tenant from the session row, so a mismatched pair is inert
 * rather than cross-filed. Unknown kinds are skipped: the vocabulary is closed
 * (director-types INTERVIEW_EVENT_KINDS).
 *
 * `nowIso` is the server's record time for the whole batch (one request = one instant).
 */
export function appendInterviewEvents(
  rows: readonly NewInterviewEvent[],
  workspaceId: string,
  nowIso: string = new Date().toISOString(),
): InterviewEvent[] {
  if (rows.length === 0) return [];
  const db = ensureDb();
  // INSERT…SELECT: the session row must exist IN THIS WORKSPACE for anything to land.
  // ON CONFLICT names the partial turn index, so only a replayed turn is absorbed —
  // any other constraint failure still throws and rolls the batch back.
  const insert = db.prepare(
    `INSERT INTO interview_events (id, session_id, workspace_id, attempt, seq, kind, block_id, payload_json, at, created_at)
       SELECT ?, s.id, s.workspace_id, ?, ?, ?, ?, ?, ?, ?
         FROM interview_sessions s
        WHERE s.id = ? AND s.workspace_id = ?
     ON CONFLICT (session_id, attempt, seq) WHERE kind = 'turn' DO NOTHING`
  );
  const written: InterviewEvent[] = [];
  const tx = db.transaction(() => {
    for (const row of rows) {
      if (!KNOWN_KINDS.has(row.kind)) continue;
      const id = randomId("ive");
      const seq = row.kind === "turn" ? (row.seq ?? null) : null;
      if (row.kind === "turn" && seq == null) continue; // a turn without a number cannot be idempotent
      const payload = row.payload ?? {};
      const at = row.at ?? nowIso;
      const res = insert.run(
        id,
        row.attempt,
        seq,
        row.kind,
        row.blockId ?? null,
        JSON.stringify(payload),
        at,
        nowIso,
        row.sessionId,
        workspaceId,
      );
      if (res.changes > 0) {
        written.push({
          id,
          sessionId: row.sessionId,
          workspaceId,
          attempt: row.attempt,
          seq,
          kind: row.kind,
          blockId: row.blockId ?? null,
          payload,
          at,
          createdAt: nowIso,
        });
      }
    }
  });
  tx();
  return written;
}

export type ListInterviewEventsOptions = {
  /** Only these kinds. */
  kinds?: readonly InterviewEventKind[];
  /** Only this attempt. */
  attempt?: number;
  /** Safety bound on rows read (default 5000 — a long interview is a few hundred). */
  limit?: number;
};

/** A session's events in the order the server recorded them (created_at, then insert
 *  order), scoped to the workspace that owns the session. */
export function listInterviewEvents(
  sessionId: string,
  workspaceId: string,
  opts: ListInterviewEventsOptions = {},
): InterviewEvent[] {
  const limit = Math.max(1, Math.min(Math.trunc(opts.limit ?? 5000), 20_000));
  const attempt = typeof opts.attempt === "number" && Number.isInteger(opts.attempt) ? opts.attempt : null;
  // One literal statement (the tenancy guard reads it as written): the optional
  // attempt filter rides as a nullable parameter, and the kind filter is applied
  // below — a session's event list is small, and a dynamically assembled WHERE is
  // exactly the shape a source-level tenancy proof cannot see into.
  const rows = ensureDb()
    .prepare(
      `SELECT id, session_id, workspace_id, attempt, seq, kind, block_id, payload_json, at, created_at
         FROM interview_events
        WHERE session_id = ? AND workspace_id = ? AND (? IS NULL OR attempt = ?)
        ORDER BY created_at ASC, rowid ASC
        LIMIT ?`
    )
    .all(sessionId, workspaceId, attempt, attempt, limit) as InterviewEventRow[];
  const kinds = opts.kinds ? new Set<string>(opts.kinds) : null;
  return rows.filter((r) => kinds === null || kinds.has(r.kind)).map(rowToInterviewEvent);
}

/** The highest turn seq persisted for one attempt, or -1 when none is — the browser
 *  resends every turn above it. */
export function maxInterviewTurnSeq(sessionId: string, attempt: number, workspaceId: string): number {
  const row = ensureDb()
    .prepare(
      `SELECT MAX(seq) AS max_seq FROM interview_events
        WHERE session_id = ? AND attempt = ? AND kind = 'turn' AND workspace_id = ?`
    )
    .get(sessionId, attempt, workspaceId) as { max_seq: number | null } | undefined;
  return row?.max_seq == null ? -1 : Number(row.max_seq);
}

/** Run `fn` inside ONE IMMEDIATE transaction on the main connection: the write lock is
 *  taken at BEGIN, so a director step's read (the session's events) → compute (tool
 *  result, dedupe, directive) → write (the new events) cannot interleave with a
 *  concurrent request for the same session. `fn` must be synchronous — better-sqlite3
 *  transactions cannot span an await. */
export function withInterviewEventsLock<T>(fn: () => T): T {
  return ensureDb().transaction(fn).immediate();
}
