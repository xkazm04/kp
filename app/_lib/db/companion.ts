import { randomId } from "../random-id";
import { ensureDb, safeRowParse } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";

// The operator companion's persistence (docs/features/companion/README.md) —
// threads, their turns, the proposals the companion offers, and the read mirror
// of the markdown brain that pipeline/jobfit/companion_brain.py writes.
//
// Tenancy: operator-internal with NO public token, so EVERY query — point reads
// included — filters workspace_id (companion-tenancy.test.ts, whose exemption
// list is empty). A leaked thread or proposal id never resolves across tenants.
//
// The brain index is a POINTER TABLE. The record is the markdown file at
// `path`, relative to ~/.personas/companion-brain; a row here only makes it
// findable from inside the app. Truncating this table loses an index, never a
// memory, which is why it is classed not-portable in the org export.

export type CompanionRole = "user" | "assistant";
export type ProposalStatus = "open" | "accepted" | "declined";

const ROLES: readonly CompanionRole[] = ["user", "assistant"];
const STATUSES: readonly ProposalStatus[] = ["open", "accepted", "declined"];

/** Provenance of one assistant turn: what the companion recalled, which episode
 *  files it wrote, and whether it actually reached a model. Stored so a degraded
 *  reply stays diagnosable after the fact instead of just reading oddly. */
export type CompanionTurnMeta = {
  source?: "llm" | "deterministic";
  fallbackReason?: string;
  recallUsed?: { path: string; excerpt: string }[];
  episodePaths?: string[];
  indexSkipped?: string[];
};

export type CompanionThread = {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: string;
  updatedAt: string | null;
};

export type CompanionTurn = {
  id: string;
  threadId: string;
  workspaceId: string;
  role: CompanionRole;
  content: string;
  meta: CompanionTurnMeta | null;
  createdAt: string;
};

export type CompanionProposal = {
  id: string;
  workspaceId: string;
  kind: string;
  payload: unknown;
  status: ProposalStatus;
  threadId: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type BrainIndexEntry = {
  nodeId: string;
  workspaceId: string;
  kind: string;
  excerpt: string | null;
  path: string;
  createdAt: string;
};

type ThreadRow = { id: string; workspace_id: string; title: string; created_at: string; updated_at: string | null };
type TurnRow = {
  id: string;
  thread_id: string;
  workspace_id: string;
  role: string;
  content: string;
  meta_json: string | null;
  created_at: string;
};
type ProposalRow = {
  id: string;
  workspace_id: string;
  kind: string;
  payload_json: string | null;
  status: string;
  thread_id: string | null;
  created_at: string;
  resolved_at: string | null;
};
type BrainRow = {
  node_id: string;
  workspace_id: string;
  kind: string;
  excerpt: string | null;
  path: string;
  created_at: string;
};

function coerceRole(value: string): CompanionRole {
  return (ROLES as readonly string[]).includes(value) ? (value as CompanionRole) : "assistant";
}

function coerceStatus(value: string): ProposalStatus {
  return (STATUSES as readonly string[]).includes(value) ? (value as ProposalStatus) : "open";
}

function threadFromRow(row: ThreadRow): CompanionThread {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function turnFromRow(row: TurnRow): CompanionTurn {
  const meta = safeRowParse<CompanionTurnMeta>(row.meta_json, "companionTurn.meta", row.id);
  return {
    id: row.id,
    threadId: row.thread_id,
    workspaceId: row.workspace_id,
    role: coerceRole(row.role),
    content: row.content,
    meta: meta && typeof meta === "object" ? meta : null,
    createdAt: row.created_at,
  };
}

function proposalFromRow(row: ProposalRow): CompanionProposal {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    kind: row.kind,
    payload: safeRowParse<unknown>(row.payload_json, "companionProposal.payload", row.id),
    status: coerceStatus(row.status),
    threadId: row.thread_id,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

function brainFromRow(row: BrainRow): BrainIndexEntry {
  return {
    nodeId: row.node_id,
    workspaceId: row.workspace_id,
    kind: row.kind,
    excerpt: row.excerpt,
    path: row.path,
    createdAt: row.created_at,
  };
}

// ---- threads ---------------------------------------------------------------

export function createThread(title: string, workspaceId: string = DEFAULT_WORKSPACE_ID): CompanionThread {
  const db = ensureDb();
  const id = randomId("cthread");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO companion_threads (id, workspace_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  ).run(id, workspaceId, (title ?? "").trim().slice(0, 200), now, now);
  return { id, workspaceId, title: (title ?? "").trim().slice(0, 200), createdAt: now, updatedAt: now };
}

export function listThreads(workspaceId: string = DEFAULT_WORKSPACE_ID): CompanionThread[] {
  const rows = ensureDb()
    .prepare(
      `SELECT id, workspace_id, title, created_at, updated_at FROM companion_threads
       WHERE workspace_id = ? ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 200`
    )
    .all(workspaceId) as ThreadRow[];
  return rows.map(threadFromRow);
}

export function getThread(id: string, workspaceId: string = DEFAULT_WORKSPACE_ID): CompanionThread | null {
  const row = ensureDb()
    .prepare(
      `SELECT id, workspace_id, title, created_at, updated_at FROM companion_threads
       WHERE id = ? AND workspace_id = ?`
    )
    .get(id, workspaceId) as ThreadRow | undefined;
  return row ? threadFromRow(row) : null;
}

/** Rename a thread — the route derives the title from the first exchange rather
 *  than asking the operator to name a conversation before having it. */
export function renameThread(id: string, title: string, workspaceId: string = DEFAULT_WORKSPACE_ID): boolean {
  const res = ensureDb()
    .prepare(`UPDATE companion_threads SET title = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`)
    .run(title.trim().slice(0, 200), new Date().toISOString(), id, workspaceId);
  return res.changes > 0;
}

// ---- turns -----------------------------------------------------------------

/** Append one turn and touch its thread, atomically. IMMEDIATE because the pair
 *  is a read→write on the same thread row and two turns can land together (the
 *  route writes the operator's message and the reply in one request). */
export function appendTurn(
  input: { threadId: string; role: CompanionRole; content: string; meta?: CompanionTurnMeta | null },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): CompanionTurn | null {
  const db = ensureDb();
  const run = db.transaction(() => {
    const thread = db
      .prepare(`SELECT id FROM companion_threads WHERE id = ? AND workspace_id = ?`)
      .get(input.threadId, workspaceId) as { id: string } | undefined;
    if (!thread) return null;
    const id = randomId("cturn");
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO companion_turns (id, thread_id, workspace_id, role, content, meta_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, input.threadId, workspaceId, input.role, input.content, input.meta ? JSON.stringify(input.meta) : null, now);
    db.prepare(`UPDATE companion_threads SET updated_at = ? WHERE id = ? AND workspace_id = ?`).run(
      now,
      input.threadId,
      workspaceId
    );
    return {
      id,
      threadId: input.threadId,
      workspaceId,
      role: input.role,
      content: input.content,
      meta: input.meta ?? null,
      createdAt: now,
    };
  });
  return run.immediate();
}

export function listTurns(
  threadId: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  limit = 200
): CompanionTurn[] {
  const rows = ensureDb()
    .prepare(
      `SELECT id, thread_id, workspace_id, role, content, meta_json, created_at FROM companion_turns
       WHERE thread_id = ? AND workspace_id = ? ORDER BY created_at ASC LIMIT ?`
    )
    .all(threadId, workspaceId, limit) as TurnRow[];
  return rows.map(turnFromRow);
}

// ---- proposals -------------------------------------------------------------

export function createProposal(
  input: { kind: string; payload: unknown; threadId?: string | null },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): CompanionProposal {
  const id = randomId("cprop");
  const now = new Date().toISOString();
  ensureDb()
    .prepare(
      `INSERT INTO companion_proposals (id, workspace_id, kind, payload_json, status, thread_id, created_at)
       VALUES (?, ?, ?, ?, 'open', ?, ?)`
    )
    .run(id, workspaceId, input.kind.slice(0, 80), JSON.stringify(input.payload ?? null), input.threadId ?? null, now);
  return {
    id,
    workspaceId,
    kind: input.kind.slice(0, 80),
    payload: input.payload ?? null,
    status: "open",
    threadId: input.threadId ?? null,
    createdAt: now,
    resolvedAt: null,
  };
}

export function listProposals(
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  status?: ProposalStatus
): CompanionProposal[] {
  const db = ensureDb();
  const rows = (
    status
      ? db
          .prepare(
            `SELECT id, workspace_id, kind, payload_json, status, thread_id, created_at, resolved_at
             FROM companion_proposals WHERE workspace_id = ? AND status = ?
             ORDER BY created_at DESC LIMIT 200`
          )
          .all(workspaceId, status)
      : db
          .prepare(
            `SELECT id, workspace_id, kind, payload_json, status, thread_id, created_at, resolved_at
             FROM companion_proposals WHERE workspace_id = ?
             ORDER BY created_at DESC LIMIT 200`
          )
          .all(workspaceId)
  ) as ProposalRow[];
  return rows.map(proposalFromRow);
}

/** The operator's answer to a proposal. Only an OPEN proposal can be resolved:
 *  the companion may not re-open its own declined suggestion, and a double-click
 *  cannot flip an accepted one to declined. */
export function resolveProposal(
  id: string,
  status: Exclude<ProposalStatus, "open">,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): boolean {
  const res = ensureDb()
    .prepare(
      `UPDATE companion_proposals SET status = ?, resolved_at = ?
       WHERE id = ? AND workspace_id = ? AND status = 'open'`
    )
    .run(status, new Date().toISOString(), id, workspaceId);
  return res.changes > 0;
}

// ---- brain index (a mirror, not the record) --------------------------------

/** Upsert one episode pointer. The Python brain door writes this row itself
 *  after the markdown lands; this is the TS-side entry point for a reindex or a
 *  test, and it keeps the shape in ONE place across the language boundary. */
export function upsertBrainEntry(
  entry: { nodeId: string; kind?: string; excerpt?: string | null; path: string; createdAt?: string },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): void {
  ensureDb()
    .prepare(
      `INSERT INTO companion_brain_index (node_id, workspace_id, kind, excerpt, path, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(node_id) DO UPDATE SET excerpt = excluded.excerpt, path = excluded.path`
    )
    .run(
      entry.nodeId,
      workspaceId,
      entry.kind ?? "episode",
      entry.excerpt ?? null,
      entry.path,
      entry.createdAt ?? new Date().toISOString()
    );
}

/** Substring search over the mirrored excerpts, newest first.
 *
 *  LIKE, not BM25 — see the DDL comment in core.ts for why there is no fts5
 *  table in kp.sqlite. Ranked recall belongs to the brain's own standalone
 *  index (pipeline/jobfit/companion_brain.py `recall`), which is what the
 *  companion actually reasons from; this exists so the APP can find an episode
 *  without spawning Python. `%` and `_` are escaped so a query containing them
 *  matches literally instead of silently becoming a wildcard. */
export function searchBrain(
  query: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  limit = 20
): BrainIndexEntry[] {
  const needle = query.trim();
  if (!needle) return [];
  const escaped = needle.replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = ensureDb()
    .prepare(
      `SELECT node_id, workspace_id, kind, excerpt, path, created_at FROM companion_brain_index
       WHERE workspace_id = ? AND excerpt LIKE ? ESCAPE '\\'
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(workspaceId, `%${escaped}%`, limit) as BrainRow[];
  return rows.map(brainFromRow);
}

export function listBrainEntries(workspaceId: string = DEFAULT_WORKSPACE_ID, limit = 50): BrainIndexEntry[] {
  const rows = ensureDb()
    .prepare(
      `SELECT node_id, workspace_id, kind, excerpt, path, created_at FROM companion_brain_index
       WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(workspaceId, limit) as BrainRow[];
  return rows.map(brainFromRow);
}
