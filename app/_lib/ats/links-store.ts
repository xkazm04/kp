import { ensureDb } from "../db/core";
import { DEFAULT_WORKSPACE_ID } from "../db/workspaces";

// W1.1 — the external-id ↔ entry-id map. Sync identity, and nothing else.
//
// The whole difference between an integration and a duplicate-generator is a stable
// answer to "have I imported this application before?". kp's entry ids are ours; the
// vendor's ids are theirs; this table is the join, scoped per tenant because two customers
// can legitimately connect the same ATS account.

export type AtsLink = {
  provider: string;
  externalId: string;
  entryId: string;
  lastSeenStage: string | null;
  lastSyncedAt: string;
};

type Row = { provider: string; external_id: string; entry_id: string; last_seen_stage: string | null; last_synced_at: string };

const toLink = (r: Row): AtsLink => ({
  provider: r.provider,
  externalId: r.external_id,
  entryId: r.entry_id,
  lastSeenStage: r.last_seen_stage,
  lastSyncedAt: r.last_synced_at,
});

/** The kp entry this vendor application already maps to, or null for a first import. */
export function findAtsLink(
  provider: string,
  externalId: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): AtsLink | null {
  const row = ensureDb()
    .prepare(
      `SELECT provider, external_id, entry_id, last_seen_stage, last_synced_at
       FROM ats_links WHERE provider = ? AND external_id = ? AND workspace_id = ?`
    )
    .get(provider, externalId, workspaceId) as Row | undefined;
  return row ? toLink(row) : null;
}

/** The vendor application(s) an entry came from — the reverse lookup an egress push needs
 *  to know WHERE to write a stage change back to. */
export function linksForEntry(entryId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): AtsLink[] {
  return (
    ensureDb()
      .prepare(
        `SELECT provider, external_id, entry_id, last_seen_stage, last_synced_at
         FROM ats_links WHERE entry_id = ? AND workspace_id = ? ORDER BY provider ASC`
      )
      .all(entryId, workspaceId) as Row[]
  ).map(toLink);
}

/**
 * Record (or refresh) the link after a successful import.
 *
 * `entry_id` is deliberately NOT updated on conflict. Once a vendor application is bound
 * to a kp entry that binding is permanent: re-pointing it would orphan the decision
 * history, the comms trail and the sealed records already attached to the first entry,
 * and a caller passing a different entry id for the same external id is a bug in the
 * connector, not a re-parenting instruction. Only the sync bookkeeping moves.
 */
export function upsertAtsLink(
  input: { provider: string; externalId: string; entryId: string; lastSeenStage?: string | null },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): void {
  ensureDb()
    .prepare(
      `INSERT INTO ats_links (provider, external_id, workspace_id, entry_id, last_seen_stage, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider, external_id, workspace_id)
         DO UPDATE SET last_seen_stage = excluded.last_seen_stage, last_synced_at = excluded.last_synced_at`
    )
    .run(
      input.provider,
      input.externalId,
      workspaceId,
      input.entryId,
      input.lastSeenStage ?? null,
      new Date().toISOString()
    );
}

/** Drop a link — used when a connection is removed, so re-connecting re-imports cleanly
 *  rather than silently adopting stale bindings to entries that may have been erased.
 *
 *  SCOPED to ONE workspace. Correct for a per-tenant cleanup; NOT correct for removing a
 *  connection, which is installation-level — see deleteAtsLinksForProviderEverywhere. */
export function deleteAtsLinksForProvider(provider: string, workspaceId: string = DEFAULT_WORKSPACE_ID): number {
  return ensureDb()
    .prepare(`DELETE FROM ats_links WHERE provider = ? AND workspace_id = ?`)
    .run(provider, workspaceId).changes;
}

/**
 * Drop a provider's links in EVERY workspace.
 *
 * `ats_connections` is keyed by provider alone — one installation, one credential per
 * ATS, no workspace column (tenancy.ts lists it exempt for exactly that reason), while
 * `ats_links` IS per-tenant. So deleting a connection through the workspace-scoped
 * function above forgot the caller's own links and left every OTHER workspace bound to a
 * provider whose credential no longer exists: a re-connect then adopted their stale
 * bindings silently — the failure mode the opt-in `forgetLinks` question exists to
 * prevent — while telling the operator a count that only covered their own team.
 *
 * The org-wide drop is the honest counterpart of an org-wide delete. Kept as a SEPARATE
 * function rather than a flag so no caller reaches installation-wide scope by accident.
 */
export function deleteAtsLinksForProviderEverywhere(provider: string): number {
  return ensureDb().prepare(`DELETE FROM ats_links WHERE provider = ?`).run(provider).changes;
}

/**
 * Drop every link pointing at ONE entry, in one workspace.
 *
 * The erasure counterpart. `ats_links` holds the entry-id ↔ vendor-id join, which is an
 * identity join: after an entry is anonymized the row still says "this kp record is
 * Recruitee application 907", so a re-sync re-attaches the vendor's copy of the name and
 * contact to the very record the erasure emptied. Scrubbing the entry's PII columns
 * without scrubbing this leaves the re-identification path open.
 *
 * Workspace-scoped, like every other read here: an entry belongs to exactly one.
 */
export function deleteAtsLinksForEntry(entryId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): number {
  return ensureDb()
    .prepare(`DELETE FROM ats_links WHERE entry_id = ? AND workspace_id = ?`)
    .run(entryId, workspaceId).changes;
}
