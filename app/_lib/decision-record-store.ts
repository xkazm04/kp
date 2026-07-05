import Database from "better-sqlite3";
import { openStore } from "./db-path";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { decisionContentHash } from "./decision-hash";

// Decision System of Record (moonshot D) — a tamper-evident hash chain of
// consequential hiring decisions, stored in SQLite (a hash chain, NOT a
// blockchain — see the moonshot's risk note). Isolated connection
// (decision-config-store / scheduler-store pattern) so it never touches the
// fork-active db.ts. Each row links to the previous via content_hash;
// verifyDecisionChain() recomputes the chain to detect any after-the-fact edit.
//
// Tenancy (E0 Phase 1): the chain is PER-TENANT (org plan §6, the hard structural
// item). A seal links off the LATEST hash IN ITS OWN WORKSPACE, so each team has an
// independent chain and one team's sealed rows never enter another's proof; verify walks
// a single workspace's records in seq order. The global seq stays a plain row id — the
// chain identity is (workspace_id, prev_hash). Existing rows backfill to the default
// workspace, so the pre-tenancy chain verifies unchanged as that workspace's chain.

export type DecisionRecordInput = {
  kind: string; // e.g. "auto_rejected"
  actor: string; // "auto:screen-wave" | "human:recruiter" | "auto:scorecard-v3"
  policyVersion: string; // a stable hash/label of the policy that produced it
  candidateRef: string; // the subject (pipeline entry id)
  rationale: string; // human-readable explanation
  reasonCode: string; // structured code (e.g. "reject")
  inputs: unknown; // snapshot of the decisive inputs the decision actually saw
};

export type DecisionRecord = {
  seq: number;
  prevHash: string;
  contentHash: string;
  kind: string;
  actor: string;
  policyVersion: string;
  candidateRef: string;
  rationale: string;
  reasonCode: string;
  payloadJson: string;
  createdAt: string;
};

export type ChainVerdict = { ok: boolean; count: number; brokenAtSeq: number | null };

type DecisionRow = {
  seq: number;
  prev_hash: string;
  content_hash: string;
  kind: string;
  actor: string;
  policy_version: string;
  candidate_ref: string;
  rationale: string;
  reason_code: string;
  payload_json: string;
  created_at: string;
};

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  const d = openStore();
  d.exec(`
    CREATE TABLE IF NOT EXISTS decision_records (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      prev_hash TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      kind TEXT NOT NULL,
      actor TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      candidate_ref TEXT NOT NULL,
      rationale TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT 'workspace'
    );
    CREATE INDEX IF NOT EXISTS idx_decision_records_candidate ON decision_records(candidate_ref);
  `);
  // Tenancy scoping (E0 Phase 1): workspace_id on a pre-existing table (isolated store).
  // Existing rows backfill to the default workspace, so their (globally-built) chain
  // becomes that workspace's chain and still verifies. An index on the per-tenant chain
  // head read (workspace_id, seq) keeps the seal's head lookup fast.
  try {
    d.exec(`ALTER TABLE decision_records ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'workspace'`);
  } catch {
    /* column already exists — idempotent */
  }
  d.exec(`CREATE INDEX IF NOT EXISTS idx_decision_records_ws_seq ON decision_records(workspace_id, seq)`);
  _db = d;
  return d;
}

// The exact object that gets hashed AND stored — everything that defines the
// decision. verify re-canonicalizes the stored payload_json against prev_hash, so
// this is the single source of the hashed content.
function recordPayload(input: DecisionRecordInput, createdAt: string) {
  return {
    kind: input.kind,
    actor: input.actor,
    policyVersion: input.policyVersion,
    candidateRef: input.candidateRef,
    rationale: input.rationale,
    reasonCode: input.reasonCode,
    inputs: input.inputs,
    createdAt,
  };
}

function rowToRecord(r: DecisionRow): DecisionRecord {
  return {
    seq: r.seq,
    prevHash: r.prev_hash,
    contentHash: r.content_hash,
    kind: r.kind,
    actor: r.actor,
    policyVersion: r.policy_version,
    candidateRef: r.candidate_ref,
    rationale: r.rationale,
    reasonCode: r.reason_code,
    payloadJson: r.payload_json,
    createdAt: r.created_at,
  };
}

/** Seal one decision into the chain. Atomic: reading the latest hash and inserting
 *  happen in ONE transaction so two concurrent seals can't both link off the same
 *  prev and fork the chain (better-sqlite3 is synchronous; the tx serializes them). */
export function sealDecisionRecord(input: DecisionRecordInput): DecisionRecord {
  const d = db();
  const createdAt = new Date().toISOString();
  const payload = recordPayload(input, createdAt);
  const payloadJson = JSON.stringify(payload);
  const tx = d.transaction((): DecisionRecord => {
    // Tenant (P1): the record joins its subject entry's workspace chain (candidateRef is
    // the pipeline entry id). Guarded: a system decision with no matching entry, or an
    // isolated store without pipeline_entries, seals onto the default workspace's chain.
    let workspaceId = DEFAULT_WORKSPACE_ID;
    try {
      const ws = d.prepare(`SELECT workspace_id FROM pipeline_entries WHERE id = ?`).get(input.candidateRef) as { workspace_id?: string } | undefined;
      workspaceId = ws?.workspace_id ?? DEFAULT_WORKSPACE_ID;
    } catch {
      /* pipeline_entries absent on this connection — seal onto the default chain */
    }
    // Link off the latest hash IN THIS WORKSPACE — a per-tenant chain, so one team's
    // seals never enter another's proof (org plan §6).
    const last = d
      .prepare(`SELECT content_hash FROM decision_records WHERE workspace_id = ? ORDER BY seq DESC LIMIT 1`)
      .get(workspaceId) as { content_hash: string } | undefined;
    const prevHash = last?.content_hash ?? "";
    const contentHash = decisionContentHash(prevHash, payload);
    const info = d
      .prepare(
        `INSERT INTO decision_records
          (prev_hash, content_hash, kind, actor, policy_version, candidate_ref, rationale, reason_code, payload_json, created_at, workspace_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(prevHash, contentHash, input.kind, input.actor, input.policyVersion, input.candidateRef, input.rationale, input.reasonCode, payloadJson, createdAt, workspaceId);
    return {
      seq: Number(info.lastInsertRowid),
      prevHash,
      contentHash,
      kind: input.kind,
      actor: input.actor,
      policyVersion: input.policyVersion,
      candidateRef: input.candidateRef,
      rationale: input.rationale,
      reasonCode: input.reasonCode,
      payloadJson,
      createdAt,
    };
  });
  return tx();
}

/** Best-effort seal: never throws. Sealing a decision record is an audit side
 *  effect that must NEVER abort or fail the decision it records (a hire, a
 *  scorecard, an offer). Logs + returns null on failure (e.g. KP-less env, DB
 *  lock). Use this at every decision call site instead of a hand-rolled try/catch. */
export function sealDecisionSafe(input: DecisionRecordInput): DecisionRecord | null {
  try {
    return sealDecisionRecord(input);
  } catch (error) {
    console.warn(`[decision-record] seal failed for kind="${input.kind}" ref="${input.candidateRef}":`, error);
    return null;
  }
}

export function listDecisionRecords(opts?: { candidateRef?: string; limit?: number; workspaceId?: string }): DecisionRecord[] {
  const d = db();
  const limit = Math.min(Math.max(Math.trunc(opts?.limit ?? 200), 1), 1000);
  const workspaceId = opts?.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const rows = (
    opts?.candidateRef
      ? d
          .prepare(`SELECT * FROM decision_records WHERE candidate_ref = ? AND workspace_id = ? ORDER BY seq DESC LIMIT ?`)
          .all(opts.candidateRef, workspaceId, limit)
      : d.prepare(`SELECT * FROM decision_records WHERE workspace_id = ? ORDER BY seq DESC LIMIT ?`).all(workspaceId, limit)
  ) as DecisionRow[];
  return rows.map(rowToRecord);
}

/** Recompute the entire chain in seq order and confirm each link's prev_hash and
 *  content_hash still match a fresh hash of its stored payload. A single edited /
 *  deleted / reordered row trips `ok:false` at the first divergent seq. */
export function verifyDecisionChain(workspaceId: string = DEFAULT_WORKSPACE_ID): ChainVerdict {
  const d = db();
  // Per-tenant verify: walk ONLY this workspace's records in seq order — its chain is
  // independent, so another team's rows are neither read nor needed for this proof.
  const rows = d.prepare(`SELECT * FROM decision_records WHERE workspace_id = ? ORDER BY seq ASC`).all(workspaceId) as DecisionRow[];
  let prevHash = "";
  for (const r of rows) {
    let payload: unknown;
    try {
      payload = JSON.parse(r.payload_json);
    } catch {
      return { ok: false, count: rows.length, brokenAtSeq: r.seq };
    }
    const expected = decisionContentHash(prevHash, payload);
    if (r.prev_hash !== prevHash || r.content_hash !== expected) {
      return { ok: false, count: rows.length, brokenAtSeq: r.seq };
    }
    prevHash = r.content_hash;
  }
  return { ok: true, count: rows.length, brokenAtSeq: null };
}
