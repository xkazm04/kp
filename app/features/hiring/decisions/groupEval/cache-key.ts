// selection-rerun-cache — the storage key for ONE comparative evaluation.
//
// The eval cache (app/_lib/group-eval.ts) is keyed by (role_key, workspace_id), so
// it can hold exactly one eval per role: the default top-N run. An eval launched
// with an EXPLICIT selection ("compare these four") is a different comparison of the
// same role, so the modal simply bypassed the cache for every selection open —
// re-spawning the full ≤8-process pipeline (LLM weight proposal, embeddings, the
// per-candidate reasoning, the compare narrative) even when the recruiter reopened
// the byte-identical four-candidate comparison seconds later.
//
// The fix layers the selection's identity ONTO the existing role_key column instead
// of migrating the schema:
//   • no rebuild of a table that already carries two hand-written migrations;
//   • the tenancy scoping is untouched — a selection row is still keyed
//     (role_key, workspace_id), so one team can never read another's;
//   • listEvaluatedRoles matches role keys with an exact `IN (…)`, so selection rows
//     are invisible to it and the "evaluated" chip keeps meaning "this ROLE has a
//     saved top-N eval" (a schema-less marker column would have needed a WHERE guard
//     added there to avoid listing selections as separate roles).
// The `#sel:` marker cannot collide with a real role key (DecisionsTab.roleKeyOf =
// jobId ?? jobTitle ?? "unassigned").
//
// Pure + dependency-free ON PURPOSE: the SERVER computes the key when it persists a
// run and the CLIENT computes it to look one up before spawning, so both must derive
// the identical string from the same ids. Single-sourcing it here is the only way
// that can't drift (same rule as the payload wire contract in ./types.ts). No
// node:crypto — it has to run in the browser too, and this is a cache key, not a
// security boundary.

/** 32-bit FNV-1a, hex. Deterministic across runtimes and stable across releases. */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply, kept in 32-bit range without BigInt.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The cache key for an eval over an explicit SELECTION of the role's cohort.
 *
 *  Order-independent (the ids are sorted first): the same four candidates picked in
 *  a different click order are the SAME comparison and must hit the same row.
 *  Duplicates collapse for the same reason. The member count is carried in the key
 *  alongside the hash so a hash collision would also have to match the field size. */
export function selectionCacheKey(roleKey: string, entryIds: string[]): string {
  const ids = [...new Set(entryIds)].sort();
  return `${roleKey}#sel:${ids.length}-${fnv1a(ids.join("\u0000"))}`;
}

/** The key an eval is stored under: the bare role key for the default top-N run
 *  (unchanged, so every legacy row and the "evaluated" chip keep working), the
 *  selection key when the recruiter chose the field. One function so the client's
 *  lookup and the server's write can never disagree about which run is which. */
export function groupEvalCacheKey(roleKey: string, selectedEntryIds: string[] | null | undefined): string {
  return selectedEntryIds && selectedEntryIds.length > 0 ? selectionCacheKey(roleKey, selectedEntryIds) : roleKey;
}
