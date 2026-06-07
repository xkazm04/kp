// Single source of truth for the `pipeline_entries.status` lifecycle contract.
// A pipeline entry is either live or in one of two DISTINCT terminal states, and
// telling those two apart is the whole point of this module: querying `status`
// alone must be able to distinguish a candidate who turned the company DOWN from
// one the company passed ON. Collapsing them into a single `rejected` value (as
// the code used to, leaving the real meaning only in the `offer_declined` event)
// corrupts funnel, re-engagement and offer-acceptance reporting — idea-275e251e.
//
//   active   — live in the pipeline. Includes the terminal STAGE "Hired": a hired
//              candidate keeps status='active' (stage='Hired'), so "active" means
//              "not closed out", not "still being actively worked".
//   rejected — the COMPANY passed on the candidate (recruiter / AI reject;
//              `actOnPipelineEntry('reject')`).
//   declined — the CANDIDATE turned the company down (declined an extended offer;
//              `respondToOffer('decline')`). This used to be written as 'rejected'
//              too — that overload is exactly what this status removes.
//
// Kept import-free (mirrors comms-status.ts) so BOTH the Node unit runner can load
// it directly AND client components (e.g. MatrixTab) can import it without pulling
// better-sqlite3 in transitively via db.ts.

export const PIPELINE_ENTRY_STATUSES = ["active", "rejected", "declined"] as const;

export type PipelineEntryStatus = (typeof PIPELINE_ENTRY_STATUSES)[number];

// The two closed-out states. An entry in either is terminal — it drops out of the
// active pipeline (listPipeline), is excluded from automation, and is eligible to
// be re-surfaced as 'active' if a recruiter re-adds the candidate.
export const TERMINAL_ENTRY_STATUSES = ["rejected", "declined"] as const;

export type TerminalEntryStatus = (typeof TERMINAL_ENTRY_STATUSES)[number];

/** Membership guard for the documented status set. Accepts a free-form value
 *  because the DB column is TEXT (also written by the Python seed). */
export function isPipelineEntryStatus(value: string | null | undefined): value is PipelineEntryStatus {
  return value != null && (PIPELINE_ENTRY_STATUSES as readonly string[]).includes(value);
}

/** Whether a status is one of the two terminal closed-out states. Readers that
 *  mean "is this entry closed?" should call this instead of string-comparing
 *  'rejected' — that literal silently excludes the equally-terminal 'declined',
 *  which is the bug this taxonomy exists to prevent. */
export function isTerminalEntryStatus(status: string | null | undefined): boolean {
  return status === "rejected" || status === "declined";
}
