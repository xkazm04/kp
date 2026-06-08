// Single source of truth for the `pipeline_entries.status` lifecycle contract.
// A pipeline entry is either live or in one of three DISTINCT terminal states, and
// telling those apart is the whole point of this module: querying `status`
// alone must be able to distinguish a candidate who turned the company DOWN from
// one the company passed ON from one who was REDIRECTED to a better-fit role.
// Collapsing reject/decline into a single `rejected` value (as the code used to,
// leaving the real meaning only in the `offer_declined` event) corrupts funnel,
// re-engagement and offer-acceptance reporting — idea-275e251e; folding a rematch
// into `rejected` would repeat that mistake (idea-9ad8a777).
//
//   active    — live in the pipeline. Includes the terminal STAGE "Hired": a hired
//               candidate keeps status='active' (stage='Hired'), so "active" means
//               "not closed out", not "still being actively worked".
//   rejected  — the COMPANY passed on the candidate (recruiter / AI reject;
//               `actOnPipelineEntry('reject')`).
//   declined  — the CANDIDATE turned the company down (declined an extended offer;
//               `respondToOffer('decline')`). This used to be written as 'rejected'
//               too — that overload is exactly what this status removes.
//   rematched — the candidate was REDIRECTED off THIS role to a better-fit open one:
//               the rematch task opened a target entry for another job and closed
//               THIS source (`rematchSourceEntry` in db.ts; the rematch branch of
//               automation-run.ts). Terminal for this role — it drops out of the
//               active board + automation so the person is never advanced/emailed
//               twice — but neither a company reject nor a candidate decline, so the
//               two reporting counts above stay honest and the funnel never
//               double-counts one person as two ACTIVE applications (idea-9ad8a777).
//
// Kept import-free (mirrors comms-status.ts) so BOTH the Node unit runner can load
// it directly AND client components (e.g. MatrixTab) can import it without pulling
// better-sqlite3 in transitively via db.ts.

export const PIPELINE_ENTRY_STATUSES = ["active", "rejected", "declined", "rematched"] as const;

export type PipelineEntryStatus = (typeof PIPELINE_ENTRY_STATUSES)[number];

// The closed-out states. An entry in any of them is terminal — it drops out of the
// active pipeline (listPipeline), is excluded from automation, and is eligible to
// be re-surfaced as 'active' if a recruiter re-adds the candidate.
export const TERMINAL_ENTRY_STATUSES = ["rejected", "declined", "rematched"] as const;

export type TerminalEntryStatus = (typeof TERMINAL_ENTRY_STATUSES)[number];

/** Membership guard for the documented status set. Accepts a free-form value
 *  because the DB column is TEXT (also written by the Python seed). */
export function isPipelineEntryStatus(value: string | null | undefined): value is PipelineEntryStatus {
  return value != null && (PIPELINE_ENTRY_STATUSES as readonly string[]).includes(value);
}

/** Whether a status is one of the terminal closed-out states. Readers that mean
 *  "is this entry closed?" should call this instead of string-comparing 'rejected'
 *  — that literal silently excludes the equally-terminal 'declined'/'rematched',
 *  which is the bug this taxonomy exists to prevent. */
export function isTerminalEntryStatus(status: string | null | undefined): boolean {
  return status === "rejected" || status === "declined" || status === "rematched";
}

/** Whether a confirmed interview invite linked to this pipeline entry should still
 *  receive timed interview reminders. An entry that has LEFT the interview track —
 *  rejected or declined (either terminal status) or Hired (status stays 'active',
 *  stage 'Hired'; see the header) — must NOT be reminded: its slot may still sit
 *  inside the ~24h look-ahead, but the call won't happen, and "see you at your
 *  interview" sent to a candidate the company already passed on is a trust-eroding,
 *  candidate-facing message (idea-d7a8d30e). A null entry — the invite has no
 *  matching pipeline row (orphan) — stays eligible, preserving the pre-join
 *  behavior. The reminder sweep (schedule-store.dueReminders) is the ONLY place the
 *  invite and pipeline states are reconciled, so this rule lives here as the single
 *  source it shares with any future reader, and dueReminders applies it directly
 *  rather than re-encoding it in SQL — the two can't drift. ('Hired' is the terminal
 *  member of PIPELINE_STAGES in pipeline-stages.ts; kept a literal here to preserve
 *  this module's import-free contract.) */
export function isEntryReminderEligible(entry: { status: string; stage: string } | null | undefined): boolean {
  if (!entry) return true; // orphaned invite — no linked entry to disqualify it
  return entry.status === "active" && entry.stage !== "Hired";
}
