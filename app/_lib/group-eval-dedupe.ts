// Pure identity/dedupe-key logic for the `group_eval` background task, split out so
// the "which re-triggers may reuse an in-flight run" decision is unit-testable and so
// a materially different re-trigger can never silently collapse onto an earlier run.
//
// bug-ui-scan-2026-07-09 #3: the group_eval dedupe key was `group_eval:${roleKey}` —
// the ROLE ALONE. A concurrent re-trigger with a different governanceMode (e.g. a
// recruiter switching a role to `committee`) or a changed candidate pool matched the
// in-flight run and was handed ITS result — the earlier run's auto-sealed
// `recommendation` lead, or its stale pool. The fix folds BOTH the (normalized)
// governance mode and an order-independent fingerprint of the candidate identity set
// into the key, so a genuinely different request starts its own run while a true retry
// (same role, mode AND set) still dedupes.

import { normalizeGovernanceMode } from "./group-eval-governance.ts";
// FNV-1a (32-bit) — a tiny, dependency-free, deterministic string hash so the
// candidate-set fingerprint stays BOUNDED (8 hex chars) regardless of pool size,
// rather than embedding every id verbatim into the dedupe key. This module used to
// carry its own copy; the SAME feature's selection cache key carried a second one.
// One helper now, with its digests pinned in hash.test.ts (the fingerprints below
// are byte-identical to the ones the private copy produced).
import { fnv1a } from "./hash.ts";

type CandidateIdentity = { entryId?: string | null; candidateId?: string | null };

/**
 * Order-independent fingerprint of a candidate SET by stable identity (candidateId
 * when present, else entryId — mirrors runGroupEval's own dedupe identity). Reordering
 * the same people yields the SAME fingerprint; adding or removing anyone changes it.
 * Blank/absent identities are ignored. Prefixed with the set size (`count-hash`) so
 * two differently-sized sets that happen to hash-collide still differ.
 */
export function candidateSetFingerprint(candidates: readonly CandidateIdentity[] | null | undefined): string {
  const ids = new Set<string>();
  for (const c of Array.isArray(candidates) ? candidates : []) {
    const id = (c?.candidateId || c?.entryId || "").trim();
    if (id) ids.add(id);
  }
  const sorted = [...ids].sort();
  return `${sorted.length}-${fnv1a(sorted.join(","))}`;
}

/**
 * The dedupe key for a `group_eval` task, or `null` when the required role identity is
 * missing/blank (so startTask falls back to a guaranteed-unique key rather than a
 * colliding constant — the stableKey null-contract). The key folds the role, the
 * NORMALIZED governance mode and the candidate-set fingerprint, so a re-trigger that
 * changes the mode or the pool no longer aliases an in-flight run (bug-ui-scan #3).
 */
export function groupEvalDedupeKey(params: Record<string, unknown>): string | null {
  const raw = params.roleKey;
  const roleKey = (typeof raw === "string" ? raw : raw == null ? "" : String(raw)).trim();
  if (!roleKey) return null;
  const mode = normalizeGovernanceMode(params.governanceMode);
  const fingerprint = candidateSetFingerprint((params.candidates as CandidateIdentity[] | undefined) ?? []);
  return `group_eval:${roleKey}:${mode}:${fingerprint}`;
}
