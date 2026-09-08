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
  candidate_halt_at: string | null;
};

function toState(row: Row | undefined): OutreachState {
  if (!row) return EMPTY_OUTREACH_STATE;
  return {
    sends: Number(row.sends) || 0,
    lastSentAt: row.last_sent_at,
    repliedAt: row.replied_at,
    manualHaltAt: row.manual_halt_at,
    candidateHaltAt: row.candidate_halt_at,
  };
}

export function outreachStateFor(entryId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): OutreachState {
  const row = ensureDb()
    .prepare(
      `SELECT sends, last_sent_at, replied_at, manual_halt_at, candidate_halt_at
         FROM outreach_state WHERE entry_id = ? AND workspace_id = ?`
    )
    .get(entryId, workspaceId) as Row | undefined;
  return toState(row);
}

/** Has THE PERSON behind this entry opted out of further contact, anywhere?
 *
 *  The entry-scoped read above is not sufficient and would be trivially bypassed.
 *  Rediscovery mints a BRAND-NEW pipeline entry per role, with a fresh
 *  `outreach_state` row and no halt on it — exactly the hole the consent gate already
 *  had to close (candidateOutreachSuppression resolves at the durable `candidate_id`
 *  for this reason). An opt-out that only bound one entry would be re-armed by the next
 *  campaign, which is the precise failure the objection exists to prevent.
 *
 *  So this resolves at the DURABLE identity: opted out on ANY entry this `candidate_id`
 *  owns ⇒ opted out everywhere. The entry's own row is checked too, so an entry that
 *  carries no candidate_id (a recruiter stub, a legacy row) still gets the exact
 *  entry-level guarantee.
 *
 *  DELIBERATELY WORKSPACE-GLOBAL, for the same reason candidateConsentSnapshots is (see
 *  rediscovery-alert-store.ts): a person's objection to being contacted is a property of
 *  the person, not of the team that happens to hold a row about them, and this reads
 *  only lifecycle timestamps — no labels, no content. Over-suppressing across a rare
 *  same-id collision is the lawful direction. Do not add a workspace filter here.
 *
 *  FAILS CLOSED, unlike its reply/manual siblings below. Those are workflow state, where
 *  an unreadable row must not silently strangle legitimate outreach. This one is in the
 *  same class as consent: a missed send is recoverable, a send to someone who told us to
 *  stop is a standalone offence. The one tolerated exception is the "no such table"
 *  identity — a database on which `outreach_state` has never been created holds no
 *  opt-outs, so nobody CAN be halted by one (the same carve-out suppressedCandidateIds
 *  makes, and for the same reason: treating a fresh install as "everyone opted out"
 *  would read as a broken product). */
export function candidateOptOutHalt(entryId: string): "candidate" | null {
  try {
    const row = ensureDb()
      .prepare(
        `SELECT 1 AS hit
           FROM outreach_state os
           LEFT JOIN pipeline_entries pe ON pe.id = os.entry_id
          WHERE os.candidate_halt_at IS NOT NULL
            AND (
                  os.entry_id = @entryId
              OR (
                   pe.candidate_id IS NOT NULL AND TRIM(pe.candidate_id) <> ''
                   AND pe.candidate_id = (SELECT candidate_id FROM pipeline_entries WHERE id = @entryId)
                 )
            )
          LIMIT 1`
      )
      .get({ entryId }) as { hit: number } | undefined;
    return row ? "candidate" : null;
  } catch (err) {
    if (err instanceof Error && /no such table/i.test(err.message)) return null;
    console.error(`[outreach] could not read the candidate opt-out for entry "${entryId}" — refusing the send (fail-closed):`, err);
    return "candidate";
  }
}

/** The BATCH form of candidateOptOutHalt, for the rank-time filter: which of these
 *  durable candidate identities have told us to stop. One SELECT per chunk instead of
 *  one per candidate — the rediscovery pool runs to ~160 and is re-ranked on every
 *  publish and every swept role, so the singular form would be 160 round-trips each time.
 *
 *  Same semantics as the singular gate and the same reasons: workspace-GLOBAL (an
 *  objection is a property of the person), resolved through the entries the identity
 *  owns so a fresh per-role entry cannot hide it, and an id with no entry anywhere is
 *  contactable.
 *
 *  FAILS CLOSED, exactly as suppressedCandidateIds does and for the same trade: every id
 *  is reported opted-out, so a broken read surfaces NOBODY rather than everybody. A
 *  rediscovery that finds no one is recoverable on the next sweep; mailing a campaign to
 *  people who told us to stop is a standalone offence. The one carve-out is the "no such
 *  table" identity — a database with no outreach_state holds no opt-outs. */
export function optedOutCandidateIds(candidateIds: readonly (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  const ids = [...new Set(candidateIds.map((c) => (c ?? "").trim()).filter(Boolean))];
  if (ids.length === 0) return out;
  try {
    // Chunked so the parameter list stays well under SQLITE_MAX_VARIABLE_NUMBER however
    // large a future pool cap gets.
    const CHUNK = 400;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const rows = ensureDb()
        .prepare(
          `SELECT DISTINCT pe.candidate_id AS id
             FROM outreach_state os
             JOIN pipeline_entries pe ON pe.id = os.entry_id
            WHERE os.candidate_halt_at IS NOT NULL
              AND pe.candidate_id IN (${slice.map(() => "?").join(",")})`
        )
        .all(...slice) as { id: string }[];
      for (const r of rows) out.add(r.id);
    }
    return out;
  } catch (err) {
    if (err instanceof Error && /no such table/i.test(err.message)) return out;
    console.error(`[outreach] could not resolve ${ids.length} candidate opt-outs — withholding all of them (fail-closed):`, err);
    for (const id of ids) out.add(id);
    return out;
  }
}

/** Why outreach must not go out for this entry, or null.
 *
 *  Two gates with two different failure directions, and the order matters. The
 *  CANDIDATE'S opt-out is asked first and fails CLOSED (see candidateOptOutHalt): it is a
 *  legal obligation, resolved at the durable identity so a fresh entry cannot re-arm the
 *  contact. The reply/manual sequence state is asked second and still fails OPEN: unlike
 *  consent (where a missed send is recoverable and a violating send is not), an
 *  unreadable workflow row must not silently stop legitimate outreach — and the consent
 *  gate ahead of it already fails closed, so the irreversible risk stays covered. */
export function outreachHaltFor(entryId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): HaltReason | null {
  const optedOut = candidateOptOutHalt(entryId);
  if (optedOut) return optedOut;
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

/** THE CANDIDATE'S OWN STOP — recorded from the public /stop/[token] door.
 *
 *  Same upsert shape as haltOutreach (a person can opt out of a sequence that has not
 *  run yet — a rediscovery campaign is exactly that case), same COALESCE so a second
 *  click keeps the FIRST objection timestamp, and the same tenant re-assertion in the
 *  DO UPDATE: the workspace comes off the row the TOKEN resolved to, never a session,
 *  because this is a capability-link path with no session at all.
 *
 *  Writing one entry is enough to stop mail on ALL of the person's entries: the READ
 *  (candidateOptOutHalt) resolves at the durable candidate_id, so a rediscovery entry
 *  minted tomorrow inherits the objection instead of re-arming the contact. Idempotent
 *  — the door answers the same thing on a replay, so a mail client that pre-fetches the
 *  one-click unsubscribe cannot produce a different outcome from a human clicking it. */
export function recordCandidateOptOut(entryId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): void {
  ensureDb()
    .prepare(
      `INSERT INTO outreach_state (entry_id, sends, candidate_halt_at, workspace_id)
       VALUES (?, 0, ?, ?)
       ON CONFLICT(entry_id) DO UPDATE SET candidate_halt_at = COALESCE(candidate_halt_at, excluded.candidate_halt_at)
        WHERE outreach_state.workspace_id = excluded.workspace_id`
    )
    .run(entryId, new Date().toISOString(), workspaceId);
}
