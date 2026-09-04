import Database from "better-sqlite3";
import { openStore } from "./db-path";
import { safeRowParse } from "./db/core";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { decisionContentHash, decisionContentMac } from "./decision-hash";
import { chunk, SQL_IN_CHUNK } from "./entries-param";

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
  // "auto:<engine>" | "human:<who>". UAT LUC-ANA-4 — `<who>` is the NATURAL PERSON when
  // the request carries identity ("human:Petra Nováková"), and falls back to the role
  // ("human:recruiter") only where the deployment genuinely cannot name one. Always
  // server-derived (humanActor() in auth/operator-approver.ts reads the signed session,
  // never the request body): the actor field is sealed into the hash chain, so a caller
  // that could set it could attribute their own decision to a colleague, permanently.
  actor: string;
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
  // The id of the HMAC key this link was sealed under ("" = a legacy keyless row,
  // sealed before the chain was keyed or when no key is configured). See the key
  // registry below.
  keyId: string;
};

// UAT LUC-ANA-1 — the verdict carries a KEY CENSUS beside the integrity result, because
// `ok:true` alone is not a security claim. A link sealed with key_id "" was hashed with a
// public SHA-256 and no secret, so the same insider who can write decision_records can
// recompute it (decision-record-store.test.ts pins that: "a keyless chain ACCEPTS an
// insider re-hash"). Without these fields the route could not tell the badge which of the
// two very different guarantees it is looking at, so the badge asserted the stronger one
// over 66 rows that only had the weaker. The census is DERIVED from the stored key_id
// column — nothing about what gets sealed, or how, changes (guardrail G2).
export type ChainVerdict = {
  ok: boolean;
  count: number;
  brokenAtSeq: number | null;
  /** True only when EVERY link is sealed under an HMAC key (and the chain is non-empty):
   *  the one state in which "tamper-resistant" is a claim this store can back. */
  keyed: boolean;
  /** Links sealed with the keyless SHA-256 (key_id ""). `keylessCount === count` is a
   *  chain that was NEVER keyed — integrity-evident, but forgeable by an insider. */
  keylessCount: number;
  /** seq of the first keyed link, or null on a never-keyed chain. On a mixed chain the
   *  keyless PREFIX is still protected — a forge cascades into this link, which cannot be
   *  re-MAC'd without the key — so the surface can name where the protection begins. */
  firstKeyedSeq: number | null;
  /** The seq this run actually re-hashed FROM (exclusive). 0 = the whole chain was
   *  re-hashed. A non-zero value means links at or below it were taken from a checkpoint
   *  this process verified earlier — see the checkpoint note below. Reported rather than
   *  hidden: "ok" over a partial re-hash is a weaker statement than "ok" over all of it,
   *  and a verdict that could not say which it was would let a surface claim the stronger. */
  verifiedFromSeq: number;
  /** True when this run re-hashed every link from genesis (no checkpoint was used). */
  fullyVerified: boolean;
};

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
  key_id: string;
};

// --- Decision-chain keying (finding SD-1: keyless chain is not tamper-EVIDENT) ------
//
// The chain is keyed with HMAC-SHA256 (decisionContentMac) under a secret the DB
// writer does NOT hold, so an insider with decision_records write access can no longer
// re-run the seal code to forge a valid chain: without the key, no valid MAC.
//
// DEDICATED KEY, not KP_SECRET. The key is its own env var (KP_DECISION_HMAC_KEY), NOT
// the session/provider-key secret KP_SECRET. KP_SECRET is a rotatable credential (it
// also signs sessions and, per the skill-profile finding, is expected to rotate), and a
// tamper-evident AUDIT chain must survive a rotation of the auth secret unbroken — so
// the two secrets are decoupled. Rotating KP_SECRET never touches the audit history.
//
// ROTATION STORY. Each row stores the key id it was sealed under (key_id column). The
// ACTIVE key is (KP_DECISION_HMAC_KEY_ID, default "k1") → KP_DECISION_HMAC_KEY. To
// rotate: pick a new id, set KP_DECISION_HMAC_KEY to the new secret and
// KP_DECISION_HMAC_KEY_ID to the new id, and KEEP the retired secret readable as
// KP_DECISION_HMAC_KEY_<oldId>. verify resolves each row's key BY its stored id, so old
// rows keep verifying under the retired key while new rows seal under the new one — a
// rotation never invalidates history. (Retired keys must be kept available; dropping one
// makes its rows unverifiable — that is the price of keying, and is asserted in tests.)
//
// LEGACY / BACKWARD COMPAT. Rows written before this change (and any row sealed while no
// key is configured, e.g. dev/open mode) carry key_id "" and use the keyless hash, so the
// pre-existing chain verifies unchanged. verify accepts a keyless row ONLY as a contiguous
// PREFIX: once any keyed row has appeared, a later keyless row is treated as a DOWNGRADE
// forgery. Consequently, enabling the key makes the ENTIRE prior history tamper-evident
// too — editing any legacy row cascades into the first keyed link downstream, which can't
// be reforged without the key. The only unprotected case is a chain that was NEVER keyed.

const LEGACY_KEY_ID = "";

/** The active (id, secret) to seal new rows under, or null when no key is configured
 *  (dev / open mode) — in which case new rows are sealed keyless (legacy). */
function activeDecisionKey(): { id: string; secret: string } | null {
  const secret = process.env.KP_DECISION_HMAC_KEY?.trim();
  if (!secret) return null;
  const id = process.env.KP_DECISION_HMAC_KEY_ID?.trim() || "k1";
  return { id, secret };
}

/** Resolve the secret for a row's stored key id. "" → null (a keyless legacy row).
 *  The active id resolves to KP_DECISION_HMAC_KEY; a retired id resolves to
 *  KP_DECISION_HMAC_KEY_<id> (kept available across a rotation). null for an id with no
 *  key material available — verify then fails closed (can't prove that row's integrity). */
function decisionKeyById(keyId: string): string | null {
  if (keyId === LEGACY_KEY_ID) return null;
  const activeId = process.env.KP_DECISION_HMAC_KEY_ID?.trim() || "k1";
  if (keyId === activeId) return process.env.KP_DECISION_HMAC_KEY?.trim() || null;
  return process.env[`KP_DECISION_HMAC_KEY_${keyId}`]?.trim() || null;
}

// --- Verification checkpoint (per-load full re-hash → bounded work) -----------------
//
// verifyDecisionChain used to load and re-hash EVERY row of a workspace's chain on every
// call, and /api/decisions/records calls it on every panel mount (behind a ~20s memo).
// The chain only grows — a screening wave seals one row per decision — so the cost of
// reading the decisions panel grew with the customer's entire decision history, while the
// sibling list read beside it was capped at 1000 rows.
//
// A verified prefix does not need re-hashing to extend the proof: each link commits to
// the one before it, so re-hashing only the rows ABOVE a known-good (seq, content_hash)
// gives the same verdict for the tail, and any edit inside the prefix that changes a
// stored content_hash breaks the anchor check below.
//
// IN-PROCESS, NOT PERSISTED — deliberately, and it is the stronger of the two:
//   * a checkpoint row in the DB is written by exactly the party the chain defends
//     against (an insider with decision_records write access), who could forge it and
//     make their own tamper permanently invisible. Process memory is not in their reach.
//   * a restart re-verifies from genesis, so the full proof is never more than one
//     deploy away, and it costs no schema, no migration and no tenancy classification.
// The price is that it does not survive a restart and is not shared between workers —
// both of which only ever cost extra work, never a missed tamper.
//
// AND IT EXPIRES. A checkpoint hides an edit to an already-verified row that leaves its
// stored content_hash alone (a payload rewritten without re-hashing — the clumsy tamper).
// So a checkpoint is only honoured for CHAIN_FULL_VERIFY_INTERVAL_MS; past that, the next
// call re-hashes the whole chain and re-anchors. That is the "verifies on a schedule, not
// per load" half of the design, and `fullyVerified` on the verdict says which run it was.
// Callers that must have the full proof NOW pass { full: true }.
export const CHAIN_FULL_VERIFY_INTERVAL_MS = 15 * 60 * 1000;

type ChainCheckpoint = {
  /** The highest seq re-hashed and found good. */
  seq: number;
  /** That row's content_hash — both the prev for the next link and the anchor we re-read. */
  hash: string;
  /** Whether a keyed row had been seen at or below `seq` (the downgrade guard's state). */
  seenKeyed: boolean;
  /** The anchor row's key id ("" = keyless) — part of the anchor identity. */
  keyId: string;
  /** EVERY distinct HMAC key id the verified prefix was sealed under. Re-resolved on each
   *  checkpointed run: a retired key dropped instead of kept makes its rows unprovable NOW,
   *  and a checkpoint must not carry an "ok" earned while the key was still available. Small
   *  by construction — one id per rotation, not one per row. */
  keyIds: string[];
  /** When the chain was last re-hashed IN FULL (epoch ms). */
  fullAt: number;
};
const chainCheckpoints = new Map<string, ChainCheckpoint>();

/** Test seam: node --test isolates each file in its own process, not each test inside it,
 *  and a tamper test must be able to establish "no checkpoint yet". */
export function resetDecisionChainCheckpointsForTests(): void {
  chainCheckpoints.clear();
}

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
      workspace_id TEXT NOT NULL DEFAULT 'workspace',
      key_id TEXT NOT NULL DEFAULT ''
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
  // Chain keying (finding SD-1): key_id records which HMAC key sealed each row. Existing
  // rows backfill to '' (legacy keyless) via the DEFAULT, so the pre-key chain verifies
  // unchanged; new rows seal under the active key. Idempotent, same pattern as above.
  try {
    d.exec(`ALTER TABLE decision_records ADD COLUMN key_id TEXT NOT NULL DEFAULT ''`);
  } catch {
    /* column already exists — idempotent */
  }
  d.exec(`CREATE INDEX IF NOT EXISTS idx_decision_records_ws_seq ON decision_records(workspace_id, seq)`);
  // Clean-arm read (heldOutEntryIds) filters by (kind, workspace_id).
  d.exec(`CREATE INDEX IF NOT EXISTS idx_decision_records_ws_kind ON decision_records(workspace_id, kind)`);
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
    keyId: r.key_id ?? LEGACY_KEY_ID,
  };
}

/** Seal one decision into the chain. Atomic: reading the latest hash and inserting
 *  happen in ONE transaction so two concurrent seals can't both link off the same
 *  prev and fork the chain (better-sqlite3 is synchronous; the tx serializes them). */
export function sealDecisionRecord(input: DecisionRecordInput, workspaceOverride?: string): DecisionRecord {
  const d = db();
  const createdAt = new Date().toISOString();
  const payload = recordPayload(input, createdAt);
  const payloadJson = JSON.stringify(payload);
  const tx = d.transaction((): DecisionRecord => {
    // Tenant (P1): the record joins its subject entry's workspace chain (candidateRef is
    // the pipeline entry id). Guarded: a system decision with no matching entry, or an
    // isolated store without pipeline_entries, seals onto the default workspace's chain.
    //
    // EXPLICIT OVERRIDE: a NON-ENTRY ref (e.g. a policy seal keyed on
    // "policy:screening:<ws>") matches no pipeline_entries row, so the entry-derived
    // resolution below would silently fall back to the DEFAULT workspace even when the
    // caller already holds the authenticated one. Such callers pass workspaceOverride so
    // the policy record lands on THEIR chain, not the default. Entry-backed refs pass
    // nothing and keep the entry-derived resolution as their default.
    let workspaceId = DEFAULT_WORKSPACE_ID;
    if (workspaceOverride) {
      workspaceId = workspaceOverride;
    } else {
      try {
        const ws = d.prepare(`SELECT workspace_id FROM pipeline_entries WHERE id = ?`).get(input.candidateRef) as { workspace_id?: string } | undefined;
        workspaceId = ws?.workspace_id ?? DEFAULT_WORKSPACE_ID;
      } catch {
        /* pipeline_entries absent on this connection — seal onto the default chain */
      }
    }
    // Link off the latest hash IN THIS WORKSPACE — a per-tenant chain, so one team's
    // seals never enter another's proof (org plan §6). Read its key_id too, to refuse a
    // downgrade (see below).
    const last = d
      .prepare(`SELECT content_hash, key_id FROM decision_records WHERE workspace_id = ? ORDER BY seq DESC LIMIT 1`)
      .get(workspaceId) as { content_hash: string; key_id: string } | undefined;
    const prevHash = last?.content_hash ?? "";
    // Key the new link with the active HMAC key; fall back to the legacy keyless hash
    // only when no key is configured (dev / open mode).
    const active = activeDecisionKey();
    // Safety net: never APPEND an unkeyed row onto a keyed chain. If this chain already
    // has keyed rows but the key is now missing (an accidental un-set of KP_DECISION_HMAC_KEY),
    // sealing keyless would create a downgrade row that permanently breaks verify. Throw
    // instead — sealDecisionSafe turns it into a logged skip, leaving the chain verifiable.
    // Operational contract: KP_DECISION_HMAC_KEY, once set, is rotated, never removed.
    if (!active && last && (last.key_id ?? LEGACY_KEY_ID) !== LEGACY_KEY_ID) {
      throw new Error(
        "KP_DECISION_HMAC_KEY is unset but this decision chain is keyed — refusing to append an unkeyed (downgrade) row. Restore the key (rotate, never remove)."
      );
    }
    const keyId = active ? active.id : LEGACY_KEY_ID;
    const contentHash = active
      ? decisionContentMac(prevHash, keyId, payload, active.secret)
      : decisionContentHash(prevHash, payload);
    const info = d
      .prepare(
        `INSERT INTO decision_records
          (prev_hash, content_hash, kind, actor, policy_version, candidate_ref, rationale, reason_code, payload_json, created_at, workspace_id, key_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(prevHash, contentHash, input.kind, input.actor, input.policyVersion, input.candidateRef, input.rationale, input.reasonCode, payloadJson, createdAt, workspaceId, keyId);
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
      keyId,
    };
  });
  return tx();
}

/** Best-effort seal: never throws. Sealing a decision record is an audit side
 *  effect that must NEVER abort or fail the decision it records (a hire, a
 *  scorecard, an offer). Logs + returns null on failure (e.g. KP-less env, DB
 *  lock). Use this at every decision call site instead of a hand-rolled try/catch. */
export function sealDecisionSafe(input: DecisionRecordInput, workspaceOverride?: string): DecisionRecord | null {
  try {
    return sealDecisionRecord(input, workspaceOverride);
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

/** Batched sibling of {@link listDecisionRecords}: read the latest records for a WHOLE
 *  SET of candidate refs in one (chunked) query instead of one query per ref. Both the
 *  reconsider queue and the analytics log used to call listDecisionRecords({candidateRef})
 *  INSIDE a map over up to 50 rows — up to 50 SELECTs per load, on every live-refresh
 *  (decision-io-diet). This collapses that to ⌈refs/SQL_IN_CHUNK⌉ queries.
 *
 *  SEMANTICS ARE PER-REF, byte-identical to calling listDecisionRecords once per ref:
 *  the returned Map has one entry per requested ref (an empty array when that ref has no
 *  records — exactly what the per-ref read returns), and each array is that ref's records
 *  ordered `seq DESC` and capped to `limit` PER REF — the limit is NOT a global cap across
 *  the batch. We fetch every matching row for the ref set ordered `seq DESC` and, walking
 *  in that order, push into each ref's bucket only while it is under `limit`, which yields
 *  the same top-`limit` slice per ref the per-ref `ORDER BY seq DESC LIMIT ?` produces. The
 *  IN list is chunked under the SQLite variable floor (chunk/SQL_IN_CHUNK), the same idiom
 *  entryIdsWithEvent uses; because ordering/capping happens per ref, the chunk boundary
 *  never affects a ref's result (a ref lands wholly within one chunk — refs are de-duped). */
export function listDecisionRecordsForRefs(
  refs: string[],
  opts?: { limit?: number; workspaceId?: string }
): Map<string, DecisionRecord[]> {
  const out = new Map<string, DecisionRecord[]>();
  const uniqueRefs = Array.from(new Set(refs.filter(Boolean)));
  // Pre-seed every requested ref with an empty array so map.get(ref) is always an array,
  // matching the per-ref read's "no records → []" contract for callers.
  for (const ref of uniqueRefs) out.set(ref, []);
  if (uniqueRefs.length === 0) return out;
  const d = db();
  const limit = Math.min(Math.max(Math.trunc(opts?.limit ?? 200), 1), 1000);
  const workspaceId = opts?.workspaceId ?? DEFAULT_WORKSPACE_ID;
  for (const idsChunk of chunk(uniqueRefs, SQL_IN_CHUNK)) {
    const placeholders = idsChunk.map(() => "?").join(", ");
    const rows = d
      .prepare(
        `SELECT * FROM decision_records WHERE candidate_ref IN (${placeholders}) AND workspace_id = ? ORDER BY seq DESC`
      )
      .all(...idsChunk, workspaceId) as DecisionRow[];
    for (const r of rows) {
      const bucket = out.get(r.candidate_ref);
      // Rows arrive seq DESC; take only the first `limit` per ref = the per-ref top slice.
      if (bucket && bucket.length < limit) bucket.push(rowToRecord(r));
    }
  }
  return out;
}

/** Recompute the entire chain in seq order and confirm each link's prev_hash and
 *  content_hash still match a fresh hash of its stored payload. A single edited /
 *  deleted / reordered row trips `ok:false` at the first divergent seq.
 *
 *  Returns the KEY CENSUS too (keyed / keylessCount / firstKeyedSeq): `ok` says the
 *  chain is internally consistent, the census says how much that is worth against an
 *  insider. UAT LUC-ANA-1 — the two are different claims and the surface must be able
 *  to tell them apart. */
export function verifyDecisionChain(
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  opts?: {
    /** Re-hash every link from genesis, ignoring (and refreshing) this process's
     *  checkpoint. Use it wherever the full proof is the point rather than the freshness
     *  of a badge — a tamper test, an export, an on-demand integrity audit. */
    full?: boolean;
    /** Clock seam, so the scheduled full re-verify can be driven in a test. */
    now?: number;
  }
): ChainVerdict {
  const d = db();
  const now = opts?.now ?? Date.now();
  // UAT LUC-ANA-1 — census FIRST, so every exit below (including each failure) reports the
  // same complete key picture. A verdict that dropped the census on the failure paths would
  // let the surface fall back to the unconditional claim exactly when it is least entitled
  // to it. Computed by AGGREGATE now rather than by walking every row: the census describes
  // the WHOLE chain even when the re-hash below starts from a checkpoint, so it must not be
  // a by-product of the rows that happen to be re-hashed.
  const agg = d
    .prepare(
      `SELECT COUNT(*) AS n,
              SUM(CASE WHEN key_id = '' THEN 1 ELSE 0 END) AS keyless,
              MIN(CASE WHEN key_id <> '' THEN seq END) AS first_keyed
         FROM decision_records WHERE workspace_id = ?`
    )
    .get(workspaceId) as { n: number; keyless: number | null; first_keyed: number | null };
  const keylessCount = Number(agg.keyless ?? 0);
  const census = {
    count: Number(agg.n ?? 0),
    keylessCount,
    keyed: Number(agg.n ?? 0) > 0 && keylessCount === 0,
    firstKeyedSeq: agg.first_keyed ?? null,
  };
  // Should this run start from the checkpoint, or re-hash everything? Three ways to say no:
  // the caller demanded the full proof, no checkpoint exists yet, or the last full re-hash
  // has aged out (the scheduled re-verify).
  let start: ChainCheckpoint | null = null;
  const cp = chainCheckpoints.get(workspaceId);
  if (!opts?.full && cp && now - cp.fullAt <= CHAIN_FULL_VERIFY_INTERVAL_MS) {
    // ANCHOR CHECK — the checkpoint claims row `seq` hashed to `hash`. Re-read that one
    // row: if its stored content_hash moved, the prefix is not the prefix we verified and
    // the checkpoint is void (fall through to a full re-hash). Cheap, and it catches the
    // tamper shape that rewrites a row's hash — the one an insider needs to keep a chain
    // internally consistent.
    const anchor = d
      .prepare(`SELECT content_hash, key_id FROM decision_records WHERE workspace_id = ? AND seq = ?`)
      .get(workspaceId, cp.seq) as { content_hash: string; key_id: string } | undefined;
    // A checkpoint is also void once its anchor's key material is no longer resolvable:
    // integrity is UNPROVABLE then, and a stale "ok" would be exactly the silent pass the
    // fail-closed rule exists to prevent (a retired key dropped instead of kept).
    const keysStillResolvable = cp.keyIds.every((id) => decisionKeyById(id) !== null);
    if (cp.seq === 0 || (anchor?.content_hash === cp.hash && anchor.key_id === cp.keyId && keysStillResolvable)) start = cp;
    else chainCheckpoints.delete(workspaceId);
  }
  // Per-tenant verify: walk ONLY this workspace's records in seq order — its chain is
  // independent, so another team's rows are neither read nor needed for this proof. From
  // the checkpoint's seq (exclusive) when one stands, from genesis otherwise.
  const fromSeq = start?.seq ?? 0;
  const rows = d
    .prepare(`SELECT * FROM decision_records WHERE workspace_id = ? AND seq > ? ORDER BY seq ASC`)
    .all(workspaceId, fromSeq) as DecisionRow[];
  const scope = { verifiedFromSeq: fromSeq, fullyVerified: fromSeq === 0 };
  const broken = (seq: number): ChainVerdict => {
    // A broken chain is never checkpointed: the next call must re-hash from genesis so the
    // break cannot be "verified past" once the offending row is repaired or replaced.
    chainCheckpoints.delete(workspaceId);
    return { ok: false, brokenAtSeq: seq, ...census, ...scope };
  };
  let prevHash = start?.hash ?? "";
  let seenKeyed = start?.seenKeyed ?? false;
  let lastSeq = fromSeq;
  let lastKeyId = start?.keyId ?? LEGACY_KEY_ID;
  const keyIds = new Set<string>(start?.keyIds ?? []);
  for (const r of rows) {
    // Decode at the shared seam (safeRowParse): a corrupt payload still breaks the
    // chain at this seq, but the corruption is also recorded in the row-health
    // ledger, so "unreadable row" and "hash mismatch" stay distinguishable.
    const payload = safeRowParse<unknown>(r.payload_json, "decisionChain.payload", String(r.seq));
    if (payload === null) return broken(r.seq);
    const keyId = r.key_id ?? LEGACY_KEY_ID;
    let expected: string;
    if (keyId === LEGACY_KEY_ID) {
      // A keyless row is legitimate ONLY within the pre-key prefix. Once any keyed row
      // has been seen, a keyless row is a DOWNGRADE forgery (an insider re-hashed a keyed
      // row with the public keyless algorithm to dodge the MAC) — reject it.
      if (seenKeyed) return broken(r.seq);
      expected = decisionContentHash(prevHash, payload);
    } else {
      // Keyed row: recompute the MAC under the row's own key. No key material → fail
      // closed (a rotated-away key that wasn't kept available; integrity unprovable).
      const secret = decisionKeyById(keyId);
      if (!secret) return broken(r.seq);
      seenKeyed = true;
      keyIds.add(keyId);
      expected = decisionContentMac(prevHash, keyId, payload, secret);
    }
    if (r.prev_hash !== prevHash || r.content_hash !== expected) {
      return broken(r.seq);
    }
    prevHash = r.content_hash;
    lastSeq = r.seq;
    lastKeyId = r.key_id ?? LEGACY_KEY_ID;
  }
  chainCheckpoints.set(workspaceId, {
    seq: lastSeq,
    hash: prevHash,
    seenKeyed,
    keyId: lastKeyId,
    keyIds: [...keyIds],
    // Only a run that re-hashed from genesis resets the schedule; an incremental run
    // extends the verified prefix but inherits the older full-verify stamp, so the
    // periodic full re-hash still lands on time however often the panel is opened.
    fullAt: fromSeq === 0 ? now : (start?.fullAt ?? now),
  });
  return { ok: true, brokenAtSeq: null, ...census, ...scope };
}

/** The kind the screening wave seals when it spares a would-be auto-reject to form
 *  the calibration clean arm (screen-wave.ts). Kept here beside the store so the
 *  reader and the writer agree on the literal. */
export const SCREEN_WAVE_HOLDOUT_KIND = "screen_wave_holdout";
/** The kind the wave seals for an actual auto-rejection. */
export const AUTO_REJECTED_KIND = "auto_rejected";

/** Entry ids that form the calibration CLEAN ARM for this workspace (UAT
 *  KAT-L1-001): candidates the screening wave SPARED from auto-rejection, whose
 *  eventual outcome the score therefore did not mechanically produce.
 *
 *  A candidate spared by one wave can be auto-rejected by a LATER wave (e.g. the
 *  holdout rate was lowered) — at which point their reject IS score-caused again, so
 *  they are removed from the clean arm. The set is therefore (holdout refs) MINUS
 *  (auto-rejected refs): membership survives only while the sparing still stands. */
export const HELD_OUT_SCAN_LIMIT = 2000;

export function heldOutEntryIds(
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  opts?: {
    /** Most recently spared candidates to consider. Defaults to HELD_OUT_SCAN_LIMIT. */
    limit?: number;
    /** Scope the arm to ONE role. The calibration panel reads per role family and the
     *  reliability curve of a single role is the question a recruiter actually asks; a
     *  workspace-wide arm makes every such read pay for every role's history. Resolved
     *  through pipeline_entries (candidate_ref IS the entry id); a store without that
     *  table falls back to the unscoped read rather than returning an empty arm. */
    jobId?: string;
  }
): Set<string> {
  const d = db();
  // BOUNDED. Both halves of this used to be unbounded DISTINCT scans of a table that only
  // grows, run TWICE per calibration request while the sibling record list beside them was
  // capped at 1000 — so the analytics read got slower with every wave a customer ever ran.
  // Now: the spared side is capped and newest-first (an arm is a measurement of recent
  // selection quality; a five-year-old sparing is not the pair a recruiter is asking
  // about), and the rejected side is no longer scanned at all — it is looked up FOR THE
  // SPARED REFS ONLY, chunked under the SQLite variable floor, which is a bounded query
  // whatever the size of the reject history.
  const limit = Math.min(Math.max(Math.trunc(opts?.limit ?? HELD_OUT_SCAN_LIMIT), 1), 10_000);
  const jobId = opts?.jobId?.trim() || null;
  // GROUP BY, not DISTINCT: SQLite cannot ORDER a DISTINCT projection by a column outside
  // it, and "newest first" is what makes the cap a recency window rather than an arbitrary
  // slice. MAX(seq) is each candidate's most recent sparing.
  const sparedSql = (scoped: boolean) =>
    `SELECT candidate_ref, MAX(seq) AS last_seq FROM decision_records
      WHERE kind = ? AND workspace_id = ?${scoped ? ` AND EXISTS (SELECT 1 FROM pipeline_entries pe WHERE pe.id = decision_records.candidate_ref AND pe.job_id = ?)` : ""}
      GROUP BY candidate_ref ORDER BY last_seq DESC LIMIT ?`;
  let spared: { candidate_ref: string }[];
  if (jobId) {
    try {
      spared = d.prepare(sparedSql(true)).all(SCREEN_WAVE_HOLDOUT_KIND, workspaceId, jobId, limit) as { candidate_ref: string }[];
    } catch (error) {
      // pipeline_entries absent on this connection (an isolated store) — the role scope
      // cannot be resolved, so answer the workspace arm rather than a false empty one.
      console.warn(`[decision-record] heldOutEntryIds could not scope to job "${jobId}" — falling back to the workspace arm:`, error);
      spared = d.prepare(sparedSql(false)).all(SCREEN_WAVE_HOLDOUT_KIND, workspaceId, limit) as { candidate_ref: string }[];
    }
  } else {
    spared = d.prepare(sparedSql(false)).all(SCREEN_WAVE_HOLDOUT_KIND, workspaceId, limit) as { candidate_ref: string }[];
  }
  if (spared.length === 0) return new Set();
  const refs = spared.map((r) => r.candidate_ref);
  const rejected = new Set<string>();
  for (const idsChunk of chunk(refs, SQL_IN_CHUNK)) {
    const placeholders = idsChunk.map(() => "?").join(", ");
    const hits = d
      .prepare(`SELECT DISTINCT candidate_ref FROM decision_records WHERE kind = ? AND workspace_id = ? AND candidate_ref IN (${placeholders})`)
      .all(AUTO_REJECTED_KIND, workspaceId, ...idsChunk) as { candidate_ref: string }[];
    for (const r of hits) rejected.add(r.candidate_ref);
  }
  const out = new Set<string>();
  for (const ref of refs) {
    if (!rejected.has(ref)) out.add(ref);
  }
  return out;
}
