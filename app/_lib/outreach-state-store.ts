import { ensureDb } from "./db/core";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import {
  EMPTY_OUTREACH_STATE,
  isReplyToOutreach,
  outreachHaltReason,
  type HaltReason,
  type OutreachState,
} from "./outreach-halt";

// W2.3 — persistence for the outreach memory. The rules live in outreach-halt.ts; this
// file only reads and writes, so the policy stays testable without a database.

type Row = {
  sends: number;
  last_sent_at: string | null;
  replied_at: string | null;
  manual_halt_at: string | null;
};

function toState(row: Row | undefined): OutreachState {
  if (!row) return EMPTY_OUTREACH_STATE;
  return {
    sends: Number(row.sends) || 0,
    lastSentAt: row.last_sent_at,
    repliedAt: row.replied_at,
    manualHaltAt: row.manual_halt_at,
  };
}

export function outreachStateFor(entryId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): OutreachState {
  const row = ensureDb()
    .prepare(`SELECT sends, last_sent_at, replied_at, manual_halt_at FROM outreach_state WHERE entry_id = ? AND workspace_id = ?`)
    .get(entryId, workspaceId) as Row | undefined;
  return toState(row);
}

/** Why outreach must not go out for this entry, or null. Fails OPEN on a read error:
 *  unlike consent (where a missed send is recoverable and a violating send is not), an
 *  unreadable halt state must not silently stop legitimate outreach — the consent gate
 *  still runs first and fails closed, so the irreversible risk stays covered. */
export function outreachHaltFor(entryId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): HaltReason | null {
  try {
    return outreachHaltReason(outreachStateFor(entryId, workspaceId));
  } catch (err) {
    console.error(`[outreach] could not read halt state for entry "${entryId}" — allowing the send:`, err);
    return null;
  }
}

/** Count a message that actually went out.
 *
 *  TENANT (P1): the table's PK is `entry_id` alone, so the conflict target cannot carry
 *  the workspace. The `DO UPDATE` re-asserts it instead - a call made under another team
 *  finds the row already taken and updates NOTHING, rather than bumping a counter that
 *  decides whether the next inbound message reads as a REPLY (outreach-halt.ts). The
 *  reads have always filtered workspace_id, so a cross-tenant write was invisible until
 *  the halt failed to hold. Proven by outreach-state-tenancy.test.ts. */
export function recordOutreachSend(entryId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): void {
  ensureDb()
    .prepare(
      `INSERT INTO outreach_state (entry_id, sends, last_sent_at, workspace_id)
       VALUES (?, 1, ?, ?)
       ON CONFLICT(entry_id) DO UPDATE SET sends = sends + 1, last_sent_at = excluded.last_sent_at
        WHERE outreach_state.workspace_id = excluded.workspace_id`
    )
    .run(entryId, new Date().toISOString(), workspaceId);
}

/**
 * Record an inbound message from a known candidate, halting the sequence if it is a
 * genuine reply. Returns true when it counted as a reply.
 *
 * `COALESCE(replied_at, ?)` keeps the FIRST reply timestamp, so an eager candidate's
 * follow-ups do not keep resetting the clock (the pure module's `withReply` rule,
 * expressed in SQL because this is an UPDATE rather than a read-modify-write).
 */
export function recordOutreachReply(entryId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): boolean {
  const state = outreachStateFor(entryId, workspaceId);
  if (!isReplyToOutreach(state)) return false;
  ensureDb()
    .prepare(`UPDATE outreach_state SET replied_at = COALESCE(replied_at, ?) WHERE entry_id = ? AND workspace_id = ?`)
    .run(new Date().toISOString(), entryId, workspaceId);
  return true;
}

/** Recruiter-initiated stop. Upserts, so a sequence can be halted before it ever ran.
 *  Tenant-re-asserted in the DO UPDATE for the same reason as recordOutreachSend: a
 *  foreign workspace must not be able to silence another team's sequence by entry id.
 *
 *  NOT YET REACHABLE FROM THE UI — there is no "stop contacting this person" control on
 *  the candidate drawer yet, so today the only halt in production is a reply. Kept
 *  because the column and the "manual outranks replied" precedence are part of one
 *  coherent state model, and adding them later would mean a migration plus a re-read of
 *  the policy; called out here so nobody reads it as a live path. */
export function haltOutreach(entryId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): void {
  ensureDb()
    .prepare(
      `INSERT INTO outreach_state (entry_id, sends, manual_halt_at, workspace_id)
       VALUES (?, 0, ?, ?)
       ON CONFLICT(entry_id) DO UPDATE SET manual_halt_at = COALESCE(manual_halt_at, excluded.manual_halt_at)
        WHERE outreach_state.workspace_id = excluded.workspace_id`
    )
    .run(entryId, new Date().toISOString(), workspaceId);
}
