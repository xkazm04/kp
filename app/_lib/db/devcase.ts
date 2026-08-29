import { createHash } from "node:crypto";
import { coerceOutboxStatus, type OutboxStatus } from "../comms-status";
import { randomId } from "../random-id";
import { jdJobId } from "../jd-limits";
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
  /** ONE THREAD — the job (`jd-<slug>`) this assignment was cut for, resolved at
   *  creation from the picked JD and verified to exist (resolveCaseJobId). NULL when
   *  no JD was picked, or when the picked JD has no ingested job row: the JD → Job
   *  ingest is best-effort, and a link that does not resolve is worse than none. */
  jobId: string | null;
  /** The linked job's title, joined at read. NULL when jobId is NULL — and also when
   *  the job row has since been removed, which is the honest reading of a stale link. */
  jobTitle: string | null;
  /** The JD the recruiter picked, straight out of need_json. Present even when jobId
   *  is NULL, which is exactly the case the UI has to explain: a JD was chosen but was
   *  never sourced into a job, so there is nothing to link to yet. */
  jdSlug: string | null;
  /** The owning tenant — same rationale as DevSubmission.workspaceId. */
  workspaceId: string;
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
  job_id?: string | null;
  // Not a column: the LEFT JOIN alias every read below selects (jobs.title).
  job_title?: string | null;
  // Present on every row (reads are SELECT *); mapped so a caller holding a case
  // never has to be told its tenant.
  workspace_id?: string | null;
};

// Every dev-case read maps through rowToDevCase, so `jobId` and its joined title can
// never be present on one read path and missing on another — the drift that put three
// different mappers on Posting before rowToPosting became the single one.
//
// The select-plus-LEFT-JOIN-jobs head the three reads share is deliberately NOT hoisted
// into a shared constant: devcase-tenancy.test.ts classifies each SQL template literal in
// this file on its own, and a bare SELECT fragment with no WHERE reads to that guard
// exactly like an unscoped enumeration. Repeating the join keeps every statement a
// complete, self-evidently-scoped one. (Which is also why no comment here quotes that
// head back-ticked — the guard scrapes every backtick block in the file, prose included.)

function rowToDevCase(r: DevCaseRow): DevCaseRecord {
  const need = safeRowParse<{ jdSlug?: unknown }>(r.need_json, "devCase.need", r.id);
  return {
    id: r.id,
    title: r.title,
    roleTitle: r.role_title,
    seniority: r.seniority,
    need,
    analysis: safeRowParse(r.analysis_json, "devCase.analysis", r.id),
    role: safeRowParse(r.role_json, "devCase.role", r.id),
    case: safeRowParse(r.case_json, "devCase.case", r.id),
    scenario: safeRowParse(r.scenario_json, "devCase.scenario", r.id),
    seed: safeRowParse(r.seed_json, "devCase.seed", r.id),
    status: r.status,
    createdAt: r.created_at,
    jobId: r.job_id ?? null,
    jobTitle: r.job_title ?? null,
    jdSlug: typeof need?.jdSlug === "string" && need.jdSlug.trim() ? need.jdSlug.trim() : null,
    workspaceId: (r.workspace_id ?? null) || DEFAULT_WORKSPACE_ID,
  };
}

/** ONE THREAD — the job id an assignment should carry, given the need it was cut from.
 *
 *  The recruiter picks a saved JD in DevNeedForm and that pick rides along as
 *  `need.jdSlug`; `jdJobId` is the deterministic id its ingested opening would have.
 *  The EXISTENCE check is the point of this function: the JD → Job ingest is
 *  best-effort (docs/features/jobs/README.md — a save can answer `jobIngested: false`),
 *  so writing `jd-<slug>` unconditionally would store a reference that resolves to
 *  nothing while looking exactly like one that does. Returning null instead keeps
 *  "this case has a job" a fact rather than an assumption; the JD itself is not lost —
 *  it stays on the record as `jdSlug`, and the UI says so.
 *
 *  Exported so the write paths and their tests agree on one rule. */
export function resolveCaseJobId(need: unknown): string | null {
  const slug = (need as { jdSlug?: unknown } | null | undefined)?.jdSlug;
  const trimmed = typeof slug === "string" ? slug.trim() : "";
  if (!trimmed) return null;
  const jobId = jdJobId(trimmed);
  const db = ensureDb();
  return db.prepare(`SELECT 1 FROM jobs WHERE id = ?`).get(jobId) ? jobId : null;
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
): { id: string; createdAt: string; jobId: string | null } {
  const db = ensureDb();
  const now = new Date().toISOString();
  const id = randomId("dc");
  // ONE THREAD: resolve the job HERE rather than at each caller. Both write paths — the
  // lifecycle's approve transition and the manual POST /api/devcase — funnel through
  // this function, so a single resolution point is what makes "every assignment knows
  // its job" true of both instead of of whichever one remembered.
  const jobId = resolveCaseJobId(input.need);
  db.prepare(
    `INSERT INTO dev_cases (id, title, role_title, seniority, need_json, analysis_json, role_json, case_json, status, created_at, workspace_id, job_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?)`
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
    workspaceId,
    jobId
  );
  return { id, createdAt: now, jobId };
}

export function listDevCases(limit = 50, workspaceId: string = DEFAULT_WORKSPACE_ID): DevCaseRecord[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT c.*, j.title AS job_title FROM dev_cases c LEFT JOIN jobs j ON j.id = c.job_id
       WHERE c.workspace_id = ? ORDER BY c.created_at DESC LIMIT ?`
    )
    .all(workspaceId, limit) as DevCaseRow[];
  return rows.map(rowToDevCase);
}

export function getDevCase(id: string): DevCaseRecord | null {
  const db = ensureDb();
  const r = db
    .prepare(`SELECT c.*, j.title AS job_title FROM dev_cases c LEFT JOIN jobs j ON j.id = c.job_id WHERE c.id = ?`)
    .get(id) as DevCaseRow | undefined;
  return r ? rowToDevCase(r) : null;
}

/** ONE THREAD — the assignments cut for one job, newest first.
 *
 *  Workspace-scoped like every other dev-case ENUMERATION (listDevCases, listPostings):
 *  the job id alone is not an authority to read a team's cases, and the caller passing a
 *  job it can see must still only see its own assignments for it. */
export function listDevCasesForJob(jobId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): DevCaseRecord[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT c.*, j.title AS job_title FROM dev_cases c LEFT JOIN jobs j ON j.id = c.job_id
       WHERE c.workspace_id = ? AND c.job_id = ? ORDER BY c.created_at DESC`
    )
    .all(workspaceId, jobId) as DevCaseRow[];
  return rows.map(rowToDevCase);
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
  /** The owning tenant — same rationale as DevSubmission.workspaceId above. */
  workspaceId: string;
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
  // The owning tenant, surfaced for the same reason PipelineEntry.workspaceId is:
  // getSubmission is a by-id point read (globally-unique id, so exempt from
  // WHERE-scoping), but promoteSubmission then WRITES a pipeline entry, an
  // approval and an event off it — and with no tenant on hand those all landed on
  // the default team. A caller holding a submission must not have to be told.
  workspaceId: string;
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
    workspaceId: ((r.workspace_id as string) ?? null) || DEFAULT_WORKSPACE_ID,
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
    workspaceId: ((r.workspace_id as string) ?? null) || DEFAULT_WORKSPACE_ID,
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
  // Through rowToPosting rather than a second inline mapper: this list hand-rolled
  // the same eight fields, so a field added to Posting landed in one mapper and
  // not the other (which is exactly how it missed workspaceId).
  return rows.map((r) => ({ ...rowToPosting(r), submissionCount: Number(r.submission_count ?? 0) }));
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

// dev_submissions is the fastest-growing table (public intake writes it), and
// better-sqlite3 is synchronous — an unbounded workspace-wide SELECT * blocks the
// event loop for the whole materialization. The per-posting read stays unbounded
// (close/orchestrator must see every submission of ONE posting); the workspace-wide
// read is capped, and pure counts go through countSubmissions instead of loading rows.
const SUBMISSION_LIST_LIMIT = 500;

export function listSubmissions(postingId?: string, workspaceId: string = DEFAULT_WORKSPACE_ID, limit = SUBMISSION_LIST_LIMIT): DevSubmission[] {
  const db = ensureDb();
  const rows = (
    postingId
      ? db.prepare(`SELECT * FROM dev_submissions WHERE posting_id = ? AND workspace_id = ? ORDER BY received_at DESC`).all(postingId, workspaceId)
      : db.prepare(`SELECT * FROM dev_submissions WHERE workspace_id = ? ORDER BY received_at DESC LIMIT ?`).all(workspaceId, limit)
  ) as Array<Record<string, unknown>>;
  return rows.map(rowToSubmission);
}

/** A COUNT, not a load — for surfaces (palette preview) that only need "how many". */
export function countSubmissions(workspaceId: string = DEFAULT_WORKSPACE_ID): number {
  const row = ensureDb().prepare(`SELECT COUNT(*) AS n FROM dev_submissions WHERE workspace_id = ?`).get(workspaceId) as { n: number };
  return row.n;
}

export function getSubmission(id: string): DevSubmission | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT * FROM dev_submissions WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? rowToSubmission(r) : null;
}

// SQLite's default SQLITE_MAX_VARIABLE_NUMBER is 999; chunk well under it so a
// board holding hundreds of promoted entries still resolves in one pass per chunk
// rather than one query per entry.
const TRANSFER_SCORE_CHUNK = 400;

/** The work-sample transfer scores for a set of submissions, id → score.
 *
 *  ONE THREAD (gap 2): the transfer score is a fact about the SUBMISSION and lives
 *  only here — it is deliberately NOT copied onto `pipeline_entries`, where a copy
 *  would be a second producer of the same number, drifting from the submission the
 *  moment it is re-evaluated. The board reaches it through the entry's
 *  `dev_submission_id` link; see pipeline-transfer-score.ts for the read path and
 *  app/_lib/match-score.ts for why it is not a match score.
 *
 *  Workspace-scoped: an entry on one team's board must never resolve a score off
 *  another team's submission, even though submission ids are globally unique.
 *  Submissions with no evaluation yet (NULL transfer_score) are simply absent from
 *  the map — an unevaluated work sample has no score, and 0 would be a fabrication. */
export function transferScoresBySubmissionIds(
  ids: readonly string[],
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Map<string, number> {
  const out = new Map<string, number>();
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.trim() !== ""))];
  if (unique.length === 0) return out;
  const db = ensureDb();
  for (let i = 0; i < unique.length; i += TRANSFER_SCORE_CHUNK) {
    const chunk = unique.slice(i, i + TRANSFER_SCORE_CHUNK);
    const rows = db
      .prepare(
        `SELECT id, transfer_score FROM dev_submissions
          WHERE workspace_id = ? AND transfer_score IS NOT NULL
            AND id IN (${chunk.map(() => "?").join(",")})`
      )
      .all(workspaceId, ...chunk) as Array<{ id: string; transfer_score: number | null }>;
    for (const r of rows) {
      const score = r.transfer_score == null ? null : Number(r.transfer_score);
      if (score != null && Number.isFinite(score)) out.set(r.id, score);
    }
  }
  return out;
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

// The flush/chat hot-path read (case-sim round 3, verifier's find): those routes
// only branch on status/token/createdAt, but getDevSession parses the FULL
// files_json blob (up to 50×256KB) on every ~8s flush per active candidate just
// to check a status column. Status-only projection, no JSON parse.
export type DevSessionMeta = { id: string; token: string | null; status: string; createdAt: string };

export function getDevSessionMeta(id: string): DevSessionMeta | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT id, token, status, created_at FROM dev_sessions WHERE id = ?`).get(id) as
    | { id: string; token: string | null; status: string; created_at: string }
    | undefined;
  return r ? { id: r.id, token: r.token ?? null, status: r.status, createdAt: r.created_at } : null;
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

// ---- Tamper-evident event log (LLM-era controls #1) ------------------------
// Each stored event carries a SERVER-computed SHA-256 chain link over the previous
// link + the event's canonical form + the server receive time. The client never
// supplies or sees a hash — it is derived at INSERT, inside the same transaction
// that assigns `seq` — so backward manipulation (editing, deleting, reordering, or
// re-timing an already-persisted event) breaks every later link and is detectable
// by recomputation. The chain seeds from `genesis:<sessionId>`, binding it to ONE
// session: replaying another session's rows breaks at the first link.

function chainLink(prev: string, sessionId: string, seq: number, e: DevSessionEvent, receivedAt: string): string {
  const canonical = `${prev}|${sessionId}|${seq}|${e.t ?? ""}|${e.kind}|${e.path ?? ""}|${e.size ?? ""}|${receivedAt}`;
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export type ChainVerdict = {
  // true = every hashed link recomputes; false = a link failed (log was altered
  // after the fact). null = unverifiable (no events, or legacy NULL-hash rows).
  valid: boolean | null;
  events: number;
  brokenAtSeq: number | null;
};

/** Recompute the whole chain from stored rows. O(n), cheap at MAX_SESSION_EVENTS. */
export function verifyDevSessionChain(id: string): ChainVerdict {
  const db = ensureDb();
  const rows = db
    .prepare(`SELECT seq, t, kind, path, size, created_at, hash FROM dev_session_events WHERE session_id = ? ORDER BY seq ASC`)
    .all(id) as Array<{ seq: number; t: number | null; kind: string; path: string | null; size: number | null; created_at: string; hash: string | null }>;
  if (rows.length === 0) return { valid: null, events: 0, brokenAtSeq: null };
  let prev = `genesis:${id}`;
  let sawHash = false;
  for (const r of rows) {
    if (r.hash == null) {
      // Legacy prefix (pre-chain rows): can't verify. A NULL AFTER hashed rows,
      // however, is a hole punched in a live chain — that IS a break.
      if (sawHash) return { valid: false, events: rows.length, brokenAtSeq: r.seq };
      continue;
    }
    sawHash = true;
    const expect = chainLink(prev, id, r.seq, { t: r.t ?? 0, kind: r.kind, path: r.path, size: r.size }, r.created_at);
    if (expect !== r.hash) return { valid: false, events: rows.length, brokenAtSeq: r.seq };
    prev = r.hash;
  }
  return { valid: sawHash ? true : null, events: rows.length, brokenAtSeq: null };
}

/** Append observed events to the session's append-only log. One transaction so
 *  the per-session seq can't collide under concurrent flushes — and so each row's
 *  chain hash links the true predecessor. Returns the new high-water seq. No-op
 *  once submitted. */
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
    // Chain seed: the last stored link, or the session-bound genesis for row 1.
    const last = db
      .prepare(`SELECT hash FROM dev_session_events WHERE session_id = ? AND seq = ?`)
      .get(id, seq) as { hash: string | null } | undefined;
    let prev = last?.hash ?? `genesis:${id}`;
    const stmt = db.prepare(
      `INSERT INTO dev_session_events (session_id, seq, t, kind, path, size, created_at, workspace_id, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const e of accepted) {
      seq += 1;
      // `size` = paste magnitude (char count) for "paste" events; null otherwise.
      const size = typeof e.size === "number" && Number.isFinite(e.size) ? e.size : null;
      const row: DevSessionEvent = { t: Number.isFinite(e.t) ? e.t : 0, kind: String(e.kind), path: e.path ?? null, size };
      const hash = chainLink(prev, id, seq, row, now);
      stmt.run(id, seq, row.t, row.kind, row.path, row.size, now, workspaceId, hash);
      prev = hash;
    }
    db.prepare(`UPDATE dev_sessions SET updated_at = ? WHERE id = ?`).run(now, id);
    return seq;
  });
  return tx();
}

// Client timestamps are candidate-controlled; the server receive time is not. An
// event whose claimed `t` sits outside [session start - skew, receive + skew] was
// backdated or future-dated — the exact manipulation that would fake read-before-write
// ordering. The skew absorbs honest clock drift + the 8s client flush buffer.
const INTEGRITY_CLOCK_SKEW_MS = 2 * 60 * 1000;

export type SessionIntegrity = {
  chain: ChainVerdict;
  // Events whose client timestamp contradicts the server receive window.
  backdatedEvents: number;
  // Worst observed client-vs-server disagreement (ms) among flagged events.
  maxClockDriftMs: number;
  // Per-session watermark verdict (LLM-era controls #4): `foreign` markers are the
  // circulation tell — another session's watermark inside THIS session's files means
  // a shared/relayed solution. A merely-missing own marker is a mild note (the
  // candidate may have deleted the line), never decisive alone.
  watermark: { expected: string; present: boolean; foreign: string[] };
};

// LLM-era controls #4 — the per-session seed watermark. Deterministically derived
// from the session id (never stored), injected into the served DECISIONS log as an
// innocuous session reference, and scanned for at evaluation. Task substance is
// untouched, so per-case comparability (freeze-at-publish) is preserved — only the
// marker differs per session.
const WATERMARK_RE = /wm-[0-9a-f]{10}/g;

export function devSessionWatermark(sessionId: string): string {
  return `wm-${createHash("sha256").update(`kp-devcase-wm|${sessionId}`, "utf8").digest("hex").slice(0, 10)}`;
}

/** One integrity verdict per session: recompute the hash chain + check every
 *  client timestamp against its server receive time. Read at evaluation and
 *  persisted with the bundle so the verdict survives beside the scores. */
export function getDevSessionIntegrity(id: string): SessionIntegrity {
  const db = ensureDb();
  const chain = verifyDevSessionChain(id);
  const session = getDevSession(id);
  const startMs = session ? Date.parse(session.createdAt) : NaN;
  const rows = db
    .prepare(`SELECT t, created_at FROM dev_session_events WHERE session_id = ? AND t IS NOT NULL AND t > 0`)
    .all(id) as Array<{ t: number; created_at: string }>;
  let backdated = 0;
  let maxDrift = 0;
  for (const r of rows) {
    const received = Date.parse(r.created_at);
    if (!Number.isFinite(received)) continue;
    const future = r.t - received - INTEGRITY_CLOCK_SKEW_MS; // claimed after it was received
    const preSession = Number.isFinite(startMs) ? startMs - INTEGRITY_CLOCK_SKEW_MS - r.t : -1; // claimed before the session existed
    if (future > 0 || preSession > 0) {
      backdated += 1;
      maxDrift = Math.max(maxDrift, future > 0 ? future : preSession);
    }
  }
  // Watermark scan over the submitted tree: our marker present? any FOREIGN one?
  const expected = devSessionWatermark(id);
  const body = (session?.files ?? []).map((f) => f.contents).join("\n");
  const found = new Set(body.match(WATERMARK_RE) ?? []);
  const foreign = [...found].filter((m) => m !== expected);
  return {
    chain,
    backdatedEvents: backdated,
    maxClockDriftMs: maxDrift,
    watermark: { expected, present: found.has(expected), foreign },
  };
}

// ---- Captured prompt channel (LLM-era controls #2) -------------------------
// The assistant / stakeholder dialogue is evidence, not chrome: it flows through
// the platform and is stored per session, append-only, in exchange order.

export type DevChatMessage = { seq: number; channel: string; role: "user" | "model"; text: string; createdAt: string };

const MAX_CHAT_MESSAGES = 400; // per session — generous vs. a real 2h timebox
const MAX_CHAT_TEXT = 8_000;

/** Append one chat message. Returns the stored seq, or 0 when refused (session
 *  not active / at cap). Same transaction discipline as the event log. */
export function appendDevSessionChat(id: string, channel: string, role: "user" | "model", text: string): number {
  const db = ensureDb();
  const now = new Date().toISOString();
  const tx = db.transaction((): number => {
    const active = db.prepare(`SELECT status, workspace_id FROM dev_sessions WHERE id = ?`).get(id) as
      | { status: string; workspace_id?: string }
      | undefined;
    if (!active || active.status !== "active") return 0;
    const max = db.prepare(`SELECT COALESCE(MAX(seq), 0) AS m FROM dev_session_chat WHERE session_id = ?`).get(id) as { m: number };
    const seq = Number(max.m) + 1;
    if (seq > MAX_CHAT_MESSAGES) return 0;
    db.prepare(
      `INSERT INTO dev_session_chat (session_id, seq, channel, role, text, created_at, workspace_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, seq, channel, role, String(text).slice(0, MAX_CHAT_TEXT), now, active.workspace_id ?? DEFAULT_WORKSPACE_ID);
    return seq;
  });
  return tx();
}

export function getDevSessionChat(id: string, channel?: string): DevChatMessage[] {
  const db = ensureDb();
  const rows = (
    channel
      ? db.prepare(`SELECT seq, channel, role, text, created_at FROM dev_session_chat WHERE session_id = ? AND channel = ? ORDER BY seq ASC`).all(id, channel)
      : db.prepare(`SELECT seq, channel, role, text, created_at FROM dev_session_chat WHERE session_id = ? ORDER BY seq ASC`).all(id)
  ) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    seq: Number(r.seq),
    channel: String(r.channel),
    role: r.role === "model" ? "model" : "user",
    text: String(r.text),
    createdAt: String(r.created_at),
  }));
}

// ---- Naive-LLM baselines (LLM-era controls #6) -----------------------------

/** Freeze the case's one-shot baseline solutions: set only if absent, mirroring
 *  the seed/scenario freeze contract (identical comparison target per candidate). */
export function saveDevCaseBaselineIfAbsent(id: string, baseline: unknown): boolean {
  const db = ensureDb();
  return (
    db
      .prepare(`UPDATE dev_cases SET baseline_json = ? WHERE id = ? AND baseline_json IS NULL`)
      .run(JSON.stringify(baseline ?? null), id).changes > 0
  );
}

export function getDevCaseBaseline(id: string): unknown {
  const db = ensureDb();
  const r = db.prepare(`SELECT baseline_json FROM dev_cases WHERE id = ?`).get(id) as { baseline_json?: string | null } | undefined;
  return r?.baseline_json ? safeRowParse(r.baseline_json, "devCase.baseline", id) : null;
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
