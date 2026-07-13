import type { AtsCandidateRecord } from "@/app/_lib/ats-record.ts";

// bug-ui-scan-2026-07-09 (ats-integration-egress #5): the per-candidate PII export
// (GET /api/ats/candidate/[id]) is now OPERATOR-gated (finding #2, a prior wave), which
// closes anonymous enumeration. But a PII egress door must ALSO be LOGGED — an operator
// pulling a full candidate record (display name, contact, archetype, salary offer, sealed
// decision) should leave an audit trail on that candidate's own immutable, workspace-
// scoped pipeline-event timeline, so a bulk harvest is detectable after the fact (the
// finding's remaining gap: "unscoped, unlogged, and enumerable").
//
// Pure builder: it turns the exported record into the recordEvent descriptor. The route
// does the DB write (recordEvent) around it; keeping the SHAPE here makes the audit
// CONTRACT unit-testable without a DB.

/** The audit kind stamped on the pipeline-event timeline for a per-candidate ATS export.
 *  Not in PipelineShared's EVENT_CATALOG, so it renders via the documented event fallback
 *  ("ats export", CircleDot) — deliberately: this is an operator/audit event, not a
 *  candidate lifecycle transition. */
export const ATS_EXPORT_EVENT_KIND = "ats_export";

/**
 * Build the recordEvent descriptor auditing ONE per-candidate ATS PII export. The detail
 * is a compact, PII-LIGHT marker (schema version + whether a sealed decision and an offer
 * were included) — enough to prove WHAT egressed without copying the PII into the audit
 * row. `entryId` is the pipeline entry the export was keyed by, so recordEvent files the
 * audit on that candidate's own (workspace-derived) timeline.
 */
export function buildAtsExportAudit(
  entryId: string,
  record: AtsCandidateRecord,
): { entryId: string; candidateLabel: string; kind: string; detail: string } {
  const parts = [
    record.schemaVersion,
    record.decision ? "decision" : "no-decision",
    record.offer ? "offer" : "no-offer",
  ];
  return {
    entryId,
    candidateLabel: record.candidate.displayName,
    kind: ATS_EXPORT_EVENT_KIND,
    detail: `ATS per-candidate PII export (${parts.join(", ")})`,
  };
}
