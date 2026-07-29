import { coerceOutboxStatus, type OutboxStatus } from "../comms-status";
import { randomId } from "../random-id";
import type { DevNeed } from "../devcase-run";
import { ensureDb, safeRowParse } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";

// ---- Dev extension — approved case scenarios (Phase D3) -------------------

export type DevCaseRecord = {
  id: string;
  title: string | null;
  roleTitle: string | null;
  seniority: string | null;
  need: unknown;
  analysis: unknown;
  role: unknown;
  case: unknown;
  // The role's AI-interview scenario generated from the approved case
  // (devcase/interview_scenario.py) — null until the lifecycle generates it.
  scenario: unknown;
  // The case's materialized seed ({files: [{path, contents}], note}) — null
  // until the lifecycle materializes it (devcase/seed_materializer.py).
  seed: unknown;
  status: string;
  createdAt: string;
};

type DevCaseRow = {
  id: string;
  title: string | null;
  role_title: string | null;
  seniority: string | null;
  need_json: string | null;
  analysis_json: string | null;
  role_json: string | null;
  case_json: string | null;
  scenario_json: string | null;
  seed_json: string | null;
  status: string;
  created_at: string;
};

function rowToDevCase(r: DevCaseRow): DevCaseRecord {
  return {
    id: r.id,
    title: r.title,
    roleTitle: r.role_title,
    seniority: r.seniority,
    need: safeRowParse(r.need_json, "devCase.need", r.id),
    analysis: safeRowParse(r.analysis_json, "devCase.analysis", r.id),
    role: safeRowParse(r.role_json, "devCase.role", r.id),
    case: safeRowParse(r.case_json, "devCase.case", r.id),
    scenario: safeRowParse(r.scenario_json, "devCase.scenario", r.id),
    seed: safeRowParse(r.seed_json, "devCase.seed", r.id),
    status: r.status,
    createdAt: r.created_at,
  };
}

/** Persist the case-designed interview scenario on its dev case (one per role). */
export function saveDevCaseScenario(id: string, scenario: unknown): void {
  const db = ensureDb();
  db.prepare(`UPDATE dev_cases SET scenario_json = ? WHERE id = ?`).run(JSON.stringify(scenario ?? null), id);
}

/** Persist the materialized seed (the concrete starter file tree) on its dev case. */
export function saveDevCaseSeed(id: string, seed: unknown): void {
  const db = ensureDb();
  db.prepare(`UPDATE dev_cases SET seed_json = ? WHERE id = ?`).run(JSON.stringify(seed ?? null), id);
}

// FREEZE-AT-PUBLISH (bug-ui-scan-2026-07-09 #1). The seed + interview scenario are
// the candidate-facing assignment; once a posting's token is live, two candidates on
// the SAME case must be handed the IDENTICAL materials (comparability + audit trail).
// These compare-and-set writes fill the column ONLY WHEN IT IS STILL ABSENT
// (`WHERE ... IS NULL`) — SQLite serializes the UPDATE, so the FIRST materialization
// wins and every later attempt (a lifecycle resume re-running the `approved` handler)
// is a no-op that leaves the live seed untouched, instead of the old unconditional
// UPDATE that overwrote it in place with a fresh (non-deterministic LLM) render.
// Returns whether THIS call performed the write (false ⇒ already frozen).

/** Freeze the interview scenario: set it only if the case has none yet. */
export function saveDevCaseScenarioIfAbsent(id: string, scenario: unknown): boolean {
  const db = ensureDb();
  return (
    db
      .prepare(`UPDATE dev_cases SET scenario_json = ? WHERE id = ? AND scenario_json IS NULL`)
      .run(JSON.stringify(scenario ?? null), id).changes > 0
  );
}

/** Freeze the materialized seed: set it only if the case has none yet. */
export function saveDevCaseSeedIfAbsent(id: string, seed: unknown): boolean {
  const db = ensureDb();
  return (
    db
      .prepare(`UPDATE dev_cases SET seed_json = ? WHERE id = ? AND seed_json IS NULL`)
      .run(JSON.stringify(seed ?? null), id).changes > 0
  );
}

export function saveDevCase(
  input: {
    need: unknown;
    analysis: unknown;
    role: { title?: string; seniority?: string } & Record<string, unknown>;
    case: { title?: string } & Record<string, unknown>;
  },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): { id: string; createdAt: string } {
  const db = ensureDb();
  const now = new Date().toISOString();
  const id = randomId("dc");
  db.prepare(
    `INSERT INTO dev_cases (id, title, role_title, seniority, need_json, analysis_json, role_json, case_json, status, created_at, workspace_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)`
  ).run(
    id,
    input.case.title ?? null,
    input.role.title ?? null,
    input.role.seniority ?? null,
    JSON.stringify(input.need ?? null),
    JSON.stringify(input.analysis ?? null),
    JSON.stringify(input.role ?? null),
    JSON.stringify(input.case ?? null),
    now,
    workspaceId
  );
  return { id, createdAt: now };
}

export function listDevCases(limit = 50, workspaceId: string = DEFAULT_WORKSPACE_ID): DevCaseRecord[] {
  const db = ensureDb();
  const rows = db
    .prepare(`SELECT * FROM dev_cases WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(workspaceId, limit) as DevCaseRow[];
  return rows.map(rowToDevCase);
}

export function getDevCase(id: string): DevCaseRecord | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT * FROM dev_cases WHERE id = ?`).get(id) as DevCaseRow | undefined;
  return r ? rowToDevCase(r) : null;
}

// ---- Dev extension — lifecycle orchestration state (Direction A) -----------

// The orchestrator branches on these payload fields, so they carry real shapes
// rather than `unknown` — a mismatch is then a compile error at the read site,
// not a runtime `undefined`. Each keeps an index signature: the Python design
// steps emit richer objects than the orchestrator reads, and those extra keys
// must round-trip through saveDevCase / the UI untouched.
//
// Reality-reflection output the auto-approve gate scores (statedVsRealGaps + confidence).
export type LifecycleAnalysis = { statedVsRealGaps?: string[]; confidence?: number } & Record<string, unknown>;
// Designed RoleSpec — title/seniority drive sourcing labels + candidate comms.
export type LifecycleRole = { title?: string; seniority?: string } & Record<string, unknown>;
// Designed CaseScenario (covert probes, rubric, tasks) — opaque to the orchestrator.
export type LifecycleCase = Record<string, unknown>;

export type LifecycleRecord = {
  id: string;
  title: string | null;
  stage: string;
  auto: boolean;
  // null only when the stored JSON is absent or corrupt (safeRowParse fell back).
  need: DevNeed | null;
  analysis: LifecycleAnalysis | null;
  role: LifecycleRole | null;
  case: LifecycleCase | null;
  caseId: string | null;
  postingId: string | null;
  detail: string | null;
  // DEVP5 — candidate-facing artifact language (en|cs), captured at intake.
  lang: string | null;
  createdAt: string;
  updatedAt: string | null;
  // D5 — the owning tenant. getLifecycle is a by-id point read (globally-unique id, so
  // exempt from WHERE-scoping), but callers that then enumerate the lifecycle's CHILDREN
  // must scope those reads to THIS workspace rather than the session's or the default —
  // see the close route, which re-derived its postings from the default workspace and
  // silently found none for any other team.
  workspaceId: string;
};

function rowToLifecycle(r: Record<string, unknown>): LifecycleRecord {
  return {
    id: r.id as string,
    title: (r.title as string) ?? null,
    stage: r.stage as string,
    auto: Number(r.auto ?? 1) === 1,
    need: safeRowParse<DevNeed>(r.need_json as string | null, "lifecycle.need", r.id as string),
    analysis: safeRowParse<LifecycleAnalysis>(r.analysis_json as string | null, "lifecycle.analysis", r.id as string),
    role: safeRowParse<LifecycleRole>(r.role_json as string | null, "lifecycle.role", r.id as string),
    case: safeRowParse<LifecycleCase>(r.case_json as string | null, "lifecycle.case", r.id as string),
    caseId: (r.case_id as string) ?? null,
    postingId: (r.posting_id as string) ?? null,
    detail: (r.detail as string) ?? null,
    lang: (r.lang as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: (r.updated_at as string) ?? null,
    workspaceId: (r.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
  };
}

export function createLifecycle(
  need: { title?: string } & Record<string, unknown>,
  auto: boolean,
  lang?: string | null,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): LifecycleRecord {
  const db = ensureDb();
  const now = new Date().toISOString();
  const id = randomId("lc");
  db.prepare(
    `INSERT INTO dev_lifecycle (id, title, stage, auto, need_json, detail, lang, created_at, updated_at, workspace_id)
     VALUES (?, ?, 'intake', ?, ?, 'created', ?, ?, ?, ?)`
  ).run(id, need.title ?? "Untitled role", auto ? 1 : 0, JSON.stringify(need), lang ?? null, now, now, workspaceId);
  return getLifecycle(id)!;
}

export function getLifecycle(id: string): LifecycleRecord | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT * FROM dev_lifecycle WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? rowToLifecycle(r) : null;
}

export function listLifecycles(limit = 50, workspaceId: string = DEFAULT_WORKSPACE_ID): LifecycleRecord[] {
  const db = ensureDb();
  const rows = db
    .prepare(`SELECT * FROM dev_lifecycle WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(workspaceId, limit) as Array<Record<string, unknown>>;
  return rows.map(rowToLifecycle);
}

export function lifecycleByPosting(postingId: string): LifecycleRecord | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT * FROM dev_lifecycle WHERE posting_id = ? LIMIT 1`).get(postingId) as Record<string, unknown> | undefined;
  return r ? rowToLifecycle(r) : null;
}

/** Patch a lifecycle record (stage + any artifact columns) and stamp updated_at. */
export function updateLifecycle(
  id: string,
  patch: { stage?: string; analysis?: unknown; role?: unknown; case?: unknown; caseId?: string; postingId?: string; detail?: string }
): void {
  const db = ensureDb();
  const sets: string[] = ["updated_at = ?"];
  const vals: unknown[] = [new Date().toISOString()];
  const set = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    vals.push(value);
  };
  if (patch.stage !== undefined) set("stage", patch.stage);
  if (patch.analysis !== undefined) set("analysis_json", JSON.stringify(patch.analysis));
  if (patch.role !== undefined) set("role_json", JSON.stringify(patch.role));
  if (patch.case !== undefined) set("case_json", JSON.stringify(patch.case));
  if (patch.caseId !== undefined) set("case_id", patch.caseId);
  if (patch.postingId !== undefined) set("posting_id", patch.postingId);
  if (patch.detail !== undefined) set("detail", patch.detail);
  vals.push(id);
  db.prepare(`UPDATE dev_lifecycle SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

/**
 * Atomic close-claim (bug-ui-scan-2026-07-09 #1). Flip the lifecycle to "closed"
 * in ONE conditional statement and report whether THIS call performed the flip.
 * `WHERE stage != 'closed'` is the compare-and-set: SQLite serializes the write,
 * so of any number of overlapping / retried closes exactly the first sees
 * `changes === 1` (returns true) and thus the sole right to run the adverse-action
 * rejection dispatch; every later caller sees `changes === 0` (returns false) and
 * no-ops. Synchronous by design — the flip is committed BEFORE the route's async
 * `sendComm` loop begins, so a later send failure cannot roll the close back: the
 * decision is the source of truth, the comms are best-effort (a missed note is
 * recoverable from the durable Outbox via Resend). Replaces the old
 * read-`stage`-then-`await`-then-write guard, whose check/act gap let two
 * concurrent closes each re-send a full rejection batch.
 */
export function claimLifecycleClose(id: string): boolean {
  const db = ensureDb();
  const info = db
    .prepare(`UPDATE dev_lifecycle SET stage = 'closed', updated_at = ? WHERE id = ? AND stage != 'closed'`)
    .run(new Date().toISOString(), id);
  return Number(info.changes) > 0;
}

// The one approve transition: persist the designed artifacts as a dev case and
// flip the lifecycle to "approved" in a SINGLE transaction. Both writes hit this
// connection, so wrapping them means a concurrent writer (another lifecycle task,
// an API handler) can never observe — nor a mid-sequence failure leave — a saved
// case with its lifecycle still stuck pre-approval. Shared by the orchestrator's
// auto-approve gate and the human-approve route; `detail` carries the path-specific
// reason and the caller records the (separate-connection) audit row after this
// returns. Returns the new case id.
export function approveLifecycleCase(
  id: string,
  lc: Pick<LifecycleRecord, "need" | "analysis" | "role" | "case">,
  detail: string
): { caseId: string } {
  const db = ensureDb();
  const caseId = db.transaction(() => {
    // Tenant (P1): the approved case inherits the lifecycle's workspace (by-id read,
    // globally-unique lifecycle id — exempt from workspace scoping).
    const wsRow = db.prepare(`SELECT workspace_id FROM dev_lifecycle WHERE id = ?`).get(id) as { workspace_id?: string } | undefined;
    const saved = saveDevCase(
      {
        need: lc.need,
        analysis: lc.analysis,
        role: lc.role ?? {},
        case: lc.case ?? {},
      },
      wsRow?.workspace_id ?? DEFAULT_WORKSPACE_ID
    );
    updateLifecycle(id, { stage: "approved", caseId: saved.id, detail });
    return saved.id;
  })();
  return { caseId };
}

// ---- Dev extension — distribution: postings (OUT) + submissions (IN) (D4) -

export type Posting = {
  id: string;
  caseId: string | null;
  channel: string;
  token: string | null;
  roleTitle: string | null;
  caseTitle: string | null;
  status: string;
  createdAt: string;
  submissionCount?: number;
};

export type DevSubmission = {
  id: string;
  postingId: string | null;
  candidateRef: string | null;
  repoRef: string | null;
  notes: string | null;
  contact: string | null;
  status: string;
  evaluation: unknown;
  transferScore: number | null;
  receivedAt: string;
};

function rowToSubmission(r: Record<string, unknown>): DevSubmission {
  return {
    id: r.id as string,
    postingId: (r.posting_id as string) ?? null,
    candidateRef: (r.candidate_ref as string) ?? null,
    repoRef: (r.repo_ref as string) ?? null,
    notes: (r.notes as string) ?? null,
    contact: (r.contact as string) ?? null,
    status: r.status as string,
    evaluation: safeRowParse(r.eval_json as string | null, "submission.eval", r.id as string),
    transferScore: r.transfer_score == null ? null : Number(r.transfer_score),
    receivedAt: r.received_at as string,
  };
}

// ---- Dev extension — comms outbox (Direction B) ---------------------------

export type OutboxEntry = {
  id: string;
  recipient: string | null;
  subject: string | null;
  body: string | null;
  kind: string | null;
  channel: string | null;
  // Delivery status — the canonical three-state contract (see comms-status.ts).
  status: OutboxStatus;
  ref: string | null;
  createdAt: string;
  /** WHY a `failed` row dead-lettered, verbatim from the relay attempt ("http 503",
   *  "getaddrinfo ENOTFOUND relay.example", a timeout message). NULL on every
   *  non-failed row AND on legacy failures written before the column existed — the
   *  UI must render its absence as "no reason recorded", never invent one. */
  failureDetail: string | null;
};

// Tenant (P1): derive the outbox tenant from the referenced pipeline entry (ref =
// entry id — comms.ts resolves it via getPipelineEntry) so no comms call site threads
// a workspace. Shared by the write (recordOutbox) and the relay-callback's orphan
// probe, so a receipt is looked up in exactly the tenant its send was recorded in.
//
// comms-tenancy-pair — the ENTRY-DERIVED tenant always wins (unchanged), but an
// ENTRY-LESS comm no longer falls straight to the default workspace: a dispatch may
// now carry an explicit `workspaceId` and that is used instead. The motivating case is
// dispatchKnockoutDecline, which is entry-less BY DESIGN (a channel lead is declined
// before any pipeline entry exists) yet its caller holds the webhook's owning team — so
// a non-default team's KO-decline used to surface in the DEFAULT team's Comms Center and
// nowhere in its own. The explicit tenant is the LAST resort before the default, never a
// way to re-file a ref'd comm away from its entry's team.
function outboxWorkspaceForRef(ref: string | null | undefined, explicitWorkspaceId?: string | null): string {
  if (ref) {
    const db = ensureDb();
    const wsRow = db.prepare(`SELECT workspace_id FROM pipeline_entries WHERE id = ?`).get(ref) as
      | { workspace_id?: string }
      | undefined;
    if (wsRow?.workspace_id) return wsRow.workspace_id;
  }
  return explicitWorkspaceId?.trim() || DEFAULT_WORKSPACE_ID;
}

/** Does any real SEND exist for this (ref, kind)? — the relay callback's orphan probe.
 *
 *  A delivery receipt is keyed only by (ref, kind); one naming a pair kp never sent is
 *  an integrator vocabulary mismatch (wrong ref scheme, a kind we don't emit), not a
 *  bounce. The callback answers such a receipt `recorded:false, reason:"no_matching_send"`
 *  so the mismatch surfaces on the FIRST call instead of accumulating rows that fold
 *  onto nothing. `bounced` rows are receipts, not sends, so they never count as a match. */
export function hasOutboxSendFor(ref: string, kind: string): boolean {
  const db = ensureDb();
  const r = db
    .prepare(
      `SELECT 1 FROM dev_outbox WHERE workspace_id = ? AND ref = ? AND kind = ? AND status <> 'bounced' LIMIT 1`
    )
    .get(outboxWorkspaceForRef(ref), ref, kind);
  return Boolean(r);
}

export function recordOutbox(input: {
  recipient: string;
  subject: string;
  body: string;
  kind: string;
  channel: string;
  status: OutboxStatus;
  ref?: string | null;
  /** The dead-letter reason for a `failed` row (comms.ts computes it per attempt). */
  failureDetail?: string | null;
  /** The dispatch's own tenant — used ONLY when `ref` names no pipeline entry (an
   *  entry-less comm such as a KO decline). A ref'd comm always files into its
   *  entry's team, whatever this says. */
  workspaceId?: string | null;
}): OutboxEntry {
  const db = ensureDb();
  const now = new Date().toISOString();
  const id = randomId("out");
  // The tenant column is NOT part of the returned message shape (OutboxEntry) — strip it
  // off the payload so it can't leak into an API response through the spread below.
  const { workspaceId: explicitWorkspaceId, ...message } = input;
  const workspaceId = outboxWorkspaceForRef(input.ref, explicitWorkspaceId);
  // A reason belongs to a FAILURE. Storing one on a sent/queued row would put a stale
  // "http 503" (the last retry before the one that worked) next to a green badge.
  const failureDetail = input.status === "failed" ? input.failureDetail?.trim() || null : null;
  db.prepare(
    `INSERT INTO dev_outbox (id, recipient, subject, body, kind, channel, status, ref, created_at, workspace_id, failure_detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.recipient, input.subject, input.body, input.kind, input.channel, input.status, input.ref ?? null, now, workspaceId, failureDetail);
  return { id, ...message, ref: input.ref ?? null, createdAt: now, failureDetail };
}

function rowToOutboxEntry(r: Record<string, unknown>): OutboxEntry {
  return {
    id: r.id as string,
    recipient: (r.recipient as string) ?? null,
    subject: (r.subject as string) ?? null,
    body: (r.body as string) ?? null,
    kind: (r.kind as string) ?? null,
    channel: (r.channel as string) ?? null,
    // Normalize so legacy rows (e.g. "failed:500") and any stray value map to the
    // canonical enum — callers/UI can rely on exactly the three documented states.
    status: coerceOutboxStatus(r.status as string | null),
    ref: (r.ref as string) ?? null,
    createdAt: r.created_at as string,
    failureDetail: (r.failure_detail as string) ?? null,
  };
}

export function listOutbox(limit = 50, workspaceId: string = DEFAULT_WORKSPACE_ID): OutboxEntry[] {
  const db = ensureDb();
  const rows = db
    .prepare(`SELECT * FROM dev_outbox WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(workspaceId, limit) as Array<Record<string, unknown>>;
  return rows.map(rowToOutboxEntry);
}

/** One outbox row by id — the resend route's read (W6-1). */
export function getOutboxEntry(id: string, workspaceId: string = DEFAULT_WORKSPACE_ID): OutboxEntry | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT * FROM dev_outbox WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as
    | Record<string, unknown>
    | undefined;
  return r ? rowToOutboxEntry(r) : null;
}

/** Filterable outbox read (W6-1/SIM1) — per-candidate ("what did this person
 *  receive?"), per-status (dead-letter triage) and per-kind views for the Comms
 *  Center and the drawer's Messages section. All filters optional. */
export function listOutboxFiltered(
  opts: { ref?: string; status?: OutboxStatus; kind?: string; limit?: number },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): OutboxEntry[] {
  const db = ensureDb();
  // workspace_id is the ALWAYS-present base filter (P1 tenant scope); the optional
  // ref/status/kind facets AND onto it.
  const extra: string[] = [];
  const vals: unknown[] = [workspaceId];
  if (opts.ref) {
    extra.push("ref = ?");
    vals.push(opts.ref);
  }
  if (opts.status) {
    extra.push("status = ?");
    vals.push(opts.status);
  }
  if (opts.kind) {
    extra.push("kind = ?");
    vals.push(opts.kind);
  }
  vals.push(Math.min(Math.max(opts.limit ?? 100, 1), 500));
  const rows = db
    .prepare(
      `SELECT * FROM dev_outbox WHERE workspace_id = ?${extra.length ? ` AND ${extra.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`
    )
    .all(...vals) as Array<Record<string, unknown>>;
  return rows.map(rowToOutboxEntry);
}

/** Map a dev_postings row to the Posting shape (shared by the by-id/by-token/dedup reads). */
function rowToPosting(r: Record<string, unknown>): Posting {
  return {
    id: r.id as string,
    caseId: (r.case_id as string) ?? null,
    channel: r.channel as string,
    token: (r.token as string) ?? null,
    roleTitle: (r.role_title as string) ?? null,
    caseTitle: (r.case_title as string) ?? null,
    status: r.status as string,
    createdAt: r.created_at as string,
  };
}

export function createPosting(input: {
  caseId: string;
  channel: string;
  token: string;
  roleTitle: string | null;
  caseTitle: string | null;
}): Posting {
  const db = ensureDb();
  // Tenant (P1): a posting inherits its case's workspace (by-id read of the team's case).
  const wsRow = db.prepare(`SELECT workspace_id FROM dev_cases WHERE id = ?`).get(input.caseId) as { workspace_id?: string } | undefined;
  const workspaceId = wsRow?.workspace_id ?? DEFAULT_WORKSPACE_ID;
  // PUBLISH DEDUP (bug-ui-scan-2026-07-09 (dev-case-authoring-publishing #4)). Publish
  // must be idempotent per (workspace, case, channel) while a posting stays OPEN —
  // otherwise a concurrent / multi-tab / reload-mid-request re-publish mints a SECOND
  // live apply token for one case and its submissions split across two tokens,
  // fragmenting the case-wide shortlist so the "true #1" ranking is wrong. Two layers,
  // mirroring createSubmission: (1) reuse the case+channel's existing OPEN posting if one
  // is already present — read-then-insert is atomic here because better-sqlite3 is
  // synchronous and Node is single-threaded, so no other in-process request interleaves
  // mid-function; (2) the partial UNIQUE index (core.ts) + targetless ON CONFLICT DO
  // NOTHING makes even a cross-connection double-insert impossible. Either way the SAME
  // existing token is returned, never a duplicate. A CLOSED posting is excluded, so a
  // deliberate re-publish after closing still mints a fresh posting.
  const selectOpen = `SELECT * FROM dev_postings WHERE workspace_id = ? AND case_id = ? AND channel = ? AND status = 'open' ORDER BY created_at ASC LIMIT 1`;
  const existing = db.prepare(selectOpen).get(workspaceId, input.caseId, input.channel) as Record<string, unknown> | undefined;
  if (existing) return rowToPosting(existing);

  const now = new Date().toISOString();
  const id = randomId("pst");
  db.prepare(
    `INSERT INTO dev_postings (id, case_id, channel, token, role_title, case_title, status, created_at, workspace_id)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)
     ON CONFLICT DO NOTHING`
  ).run(id, input.caseId, input.channel, input.token, input.roleTitle, input.caseTitle, now, workspaceId);
  // Re-select the canonical open row: ours if the insert won, or the row a concurrent
  // connection inserted first (the unique index rejected ours via ON CONFLICT DO NOTHING).
  const row = db.prepare(selectOpen).get(workspaceId, input.caseId, input.channel) as Record<string, unknown>;
  return rowToPosting(row);
}

export function listPostings(workspaceId: string = DEFAULT_WORKSPACE_ID): Posting[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM dev_submissions s WHERE s.posting_id = p.id) AS submission_count
       FROM dev_postings p WHERE p.workspace_id = ? ORDER BY p.created_at DESC`
    )
    .all(workspaceId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as string,
    caseId: (r.case_id as string) ?? null,
    channel: r.channel as string,
    token: (r.token as string) ?? null,
    roleTitle: (r.role_title as string) ?? null,
    caseTitle: (r.case_title as string) ?? null,
    status: r.status as string,
    createdAt: r.created_at as string,
    submissionCount: Number(r.submission_count ?? 0),
  }));
}

export function getPostingByToken(token: string): Posting | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT * FROM dev_postings WHERE token = ?`).get(token) as Record<string, unknown> | undefined;
  return r ? rowToPosting(r) : null;
}

// Atomic, idempotent on (posting, candidate, repo): the UNIQUE index +
// ON CONFLICT DO NOTHING make a concurrent double-submit impossible at the DB
// level (no read-then-write race). `created` is false when the row already
// existed; the canonical row is always re-selected and returned.
export function createSubmission(input: {
  postingId: string;
  candidateRef: string;
  repoRef: string;
  notes?: string;
  contact?: string;
}): { submission: DevSubmission; created: boolean } {
  const db = ensureDb();
  const now = new Date().toISOString();
  const id = randomId("sub");
  // Tenant (P1): a submission inherits the posting's workspace (by-id read of the posting).
  const wsRow = db.prepare(`SELECT workspace_id FROM dev_postings WHERE id = ?`).get(input.postingId) as { workspace_id?: string } | undefined;
  const workspaceId = wsRow?.workspace_id ?? DEFAULT_WORKSPACE_ID;
  const info = db
    .prepare(
      `INSERT INTO dev_submissions (id, posting_id, candidate_ref, repo_ref, notes, contact, status, received_at, workspace_id)
       VALUES (?, ?, ?, ?, ?, ?, 'received', ?, ?)
       ON CONFLICT DO NOTHING`
    )
    .run(id, input.postingId, input.candidateRef, input.repoRef, input.notes ?? null, input.contact ?? null, now, workspaceId);
  const created = Number(info.changes) > 0;
  // Re-select the canonical row: ours if just created, otherwise the row that
  // won the race / was inserted earlier.
  const row = db
    .prepare(
      `SELECT * FROM dev_submissions
       WHERE posting_id = ? AND candidate_ref = ? AND repo_ref = ?
       ORDER BY received_at ASC LIMIT 1`
    )
    .get(input.postingId, input.candidateRef, input.repoRef) as Record<string, unknown>;
  return { submission: rowToSubmission(row), created };
}

export function listSubmissions(postingId?: string, workspaceId: string = DEFAULT_WORKSPACE_ID): DevSubmission[] {
  const db = ensureDb();
  const rows = (
    postingId
      ? db.prepare(`SELECT * FROM dev_submissions WHERE posting_id = ? AND workspace_id = ? ORDER BY received_at DESC`).all(postingId, workspaceId)
      : db.prepare(`SELECT * FROM dev_submissions WHERE workspace_id = ? ORDER BY received_at DESC`).all(workspaceId)
  ) as Array<Record<string, unknown>>;
  return rows.map(rowToSubmission);
}

export function getSubmission(id: string): DevSubmission | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT * FROM dev_submissions WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? rowToSubmission(r) : null;
}

// ---- Live Work Surface (moonshot E) — in-product work sessions ------------
// Events are typed locally (not imported from the features layer) so the db
// stays a leaf; the API route coerces the wire JSON into this shape.
export type DevSessionEvent = { t: number; kind: string; path?: string | null; size?: number | null };
export type DevSessionFile = { path: string; contents: string };
export type DevSession = {
  id: string;
  token: string | null;
  candidateRef: string | null;
  files: DevSessionFile[];
  status: string;
  submissionId: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
};

function rowToSession(r: Record<string, unknown>): DevSession {
  return {
    id: r.id as string,
    token: (r.token as string) ?? null,
    candidateRef: (r.candidate_ref as string) ?? null,
    files: (safeRowParse(r.files_json as string | null, "devSession.files", r.id as string) as DevSessionFile[]) ?? [],
    status: r.status as string,
    submissionId: (r.submission_id as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    submittedAt: (r.submitted_at as string) ?? null,
  };
}

export function startDevSession(input: { token?: string | null; candidateRef?: string | null }): DevSession {
  const db = ensureDb();
  const now = new Date().toISOString();
  const id = randomId("dsess");
  // Tenant (P1): a live-work session inherits the workspace of the posting its token
  // belongs to (by-token read of the posting); an anonymous/tokenless session falls
  // back to the default workspace.
  const wsRow = input.token
    ? (db.prepare(`SELECT workspace_id FROM dev_postings WHERE token = ?`).get(input.token) as { workspace_id?: string } | undefined)
    : undefined;
  const workspaceId = wsRow?.workspace_id ?? DEFAULT_WORKSPACE_ID;
  db.prepare(
    `INSERT INTO dev_sessions (id, token, candidate_ref, files_json, status, created_at, updated_at, workspace_id)
     VALUES (?, ?, ?, '[]', 'active', ?, ?, ?)`
  ).run(id, input.token ?? null, input.candidateRef ?? null, now, now, workspaceId);
  return getDevSession(id)!;
}

export function getDevSession(id: string): DevSession | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT * FROM dev_sessions WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? rowToSession(r) : null;
}

// bug-ui-scan-2026-07-09 (dev-submissions-live-work-surface #2): a per-token session
// throttle. Apply tokens are deliberately shareable PUBLIC links, so an unauthenticated
// holder is the trust boundary — session POST otherwise minted unlimited sessions per
// token, a cheap storage-exhaustion vector (each session then flushes events). Counting
// sessions created since a window boundary lets the route enforce a per-token/day cap.
export function countRecentDevSessionsForToken(token: string, sinceIso: string): number {
  const db = ensureDb();
  const r = db
    .prepare(`SELECT COUNT(*) AS n FROM dev_sessions WHERE token = ? AND created_at >= ?`)
    .get(token, sinceIso) as { n: number };
  return Number(r.n);
}

// bug-ui-scan-2026-07-09 (dev-submissions-live-work-surface #2): the absolute ceiling on
// stored events per session. The flush route caps per-FLUSH (MAX_EVENTS) but not the
// number of flushes, so one session could accumulate unbounded rows. Genuine sessions
// emit coarse (debounced) events — hundreds, not tens of thousands — so this bounds
// abuse while never touching a real candidate's run. Enforced atomically in
// appendDevSessionEvents below.
export const MAX_SESSION_EVENTS = 20000;

export function getDevSessionEvents(id: string): DevSessionEvent[] {
  const db = ensureDb();
  const rows = db
    .prepare(`SELECT t, kind, path, size FROM dev_session_events WHERE session_id = ? ORDER BY seq ASC`)
    .all(id) as Array<Record<string, unknown>>;
  // `size` carries the paste magnitude for "paste" events (bulk-paste authenticity
  // signal); NULL for other kinds and legacy rows → surfaced as null.
  return rows.map((r) => ({ t: Number(r.t), kind: r.kind as string, path: (r.path as string) ?? null, size: r.size == null ? null : Number(r.size) }));
}

/** Save the (editable) seed tree. No-op once the session is submitted. */
export function saveDevSessionFiles(id: string, files: DevSessionFile[]): boolean {
  const db = ensureDb();
  const now = new Date().toISOString();
  return (
    db
      .prepare(`UPDATE dev_sessions SET files_json = ?, updated_at = ? WHERE id = ? AND status = 'active'`)
      .run(JSON.stringify(files ?? []), now, id).changes > 0
  );
}

/** Append observed events to the session's append-only log. One transaction so
 *  the per-session seq can't collide under concurrent flushes. Returns the new
 *  high-water seq. No-op once submitted. */
export function appendDevSessionEvents(id: string, events: DevSessionEvent[]): number {
  const db = ensureDb();
  if (!events?.length) return 0;
  const now = new Date().toISOString();
  const tx = db.transaction((): number => {
    // Read status + tenant together (by-id): events inherit their session's workspace.
    const active = db.prepare(`SELECT status, workspace_id FROM dev_sessions WHERE id = ?`).get(id) as
      | { status: string; workspace_id?: string }
      | undefined;
    if (!active || active.status !== "active") return 0;
    const workspaceId = active.workspace_id ?? DEFAULT_WORKSPACE_ID;
    const max = db.prepare(`SELECT COALESCE(MAX(seq), 0) AS m FROM dev_session_events WHERE session_id = ?`).get(id) as { m: number };
    let seq = Number(max.m);
    // bug-ui-scan-2026-07-09 (dev-submissions-live-work-surface #2): the per-session
    // event ceiling. `seq` is the current row count (contiguous, no deletes), so only
    // accept up to MAX_SESSION_EVENTS total — a leaked token can no longer amplify one
    // session into unbounded rows. At the cap this is a no-op that returns the high-water
    // seq unchanged; excess events in an over-cap flush are dropped.
    const room = MAX_SESSION_EVENTS - seq;
    if (room <= 0) return seq;
    const accepted = events.length > room ? events.slice(0, room) : events;
    const stmt = db.prepare(`INSERT INTO dev_session_events (session_id, seq, t, kind, path, size, created_at, workspace_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const e of accepted) {
      seq += 1;
      // `size` = paste magnitude (char count) for "paste" events; null otherwise.
      const size = typeof e.size === "number" && Number.isFinite(e.size) ? e.size : null;
      stmt.run(id, seq, Number.isFinite(e.t) ? e.t : null, String(e.kind), e.path ?? null, size, now, workspaceId);
    }
    db.prepare(`UPDATE dev_sessions SET updated_at = ? WHERE id = ?`).run(now, id);
    return seq;
  });
  return tx();
}

/** Finalize a session: mark it submitted and create a linked dev_submissions row
 *  (repo_ref = "session:<id>") so the existing eval machinery can pick it up and
 *  load the observed events. Idempotent — returns the existing submission if the
 *  session was already submitted. */
export function submitDevSession(
  id: string,
  postingId: string,
  identity?: { candidate?: string | null; contact?: string | null }
): DevSubmission | null {
  const db = ensureDb();
  // ONE transaction over read-check-create-link: previously these were three
  // statements with no atomicity, so a crash between createSubmission and the
  // submission_id UPDATE left the session permanently 'active' with an orphan
  // submission and no link — a retry then minted a SECOND submission. Re-checking
  // submissionId INSIDE the tx also lets a concurrent finalize win cleanly (better-
  // sqlite3 serializes transactions on the connection, so the loser sees the link
  // already set and returns that submission instead of creating another).
  const tx = db.transaction((): DevSubmission | null => {
    const session = getDevSession(id);
    if (!session) return null;
    if (session.submissionId) return getSubmission(session.submissionId);
    const { submission } = createSubmission({
      postingId,
      // UAT M9 — the live-work surface is the single submit path when a case has a
      // workspace, so it must carry identity (else a winning evaluation is an
      // unreachable candidate). Prefer the submit-time name, then the session's,
      // then the anonymous fallback.
      candidateRef: identity?.candidate?.trim() || session.candidateRef || "live-session",
      contact: identity?.contact?.trim() || undefined,
      repoRef: `session:${id}`,
    });
    const now = new Date().toISOString();
    db.prepare(`UPDATE dev_sessions SET status = 'submitted', submission_id = ?, submitted_at = ? WHERE id = ?`).run(submission.id, now, id);
    return submission;
  });
  return tx();
}

/** Flip a posting's status (W5-3: "closed" stops the apply page + inbound
 *  webhook from collecting submissions nobody will process). */
export function setPostingStatus(id: string, status: string): boolean {
  const db = ensureDb();
  return db.prepare(`UPDATE dev_postings SET status = ? WHERE id = ?`).run(status, id).changes > 0;
}

export function getPosting(id: string): Posting | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT * FROM dev_postings WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? rowToPosting(r) : null;
}

export function saveSubmissionEvaluation(id: string, evaluation: unknown, transferScore: number): void {
  const db = ensureDb();
  db.prepare(`UPDATE dev_submissions SET eval_json = ?, transfer_score = ?, status = 'evaluated' WHERE id = ?`).run(
    JSON.stringify(evaluation ?? null),
    transferScore,
    id
  );
}
