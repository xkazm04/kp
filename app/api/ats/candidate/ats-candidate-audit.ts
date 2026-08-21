import { maskCandidateName } from "@/app/_lib/consent.ts";
import type { AtsCandidateRecord } from "@/app/_lib/ats-record.ts";

// The PURE helpers behind the per-candidate ATS export door (GET /api/ats/candidate/[id]):
// the audit descriptor the route writes, and the read-time consent redaction it applies
// before anything leaves. Both live here (rather than in the route) so the CONTRACT is
// unit-testable without a DB; the route does the reads and the recordEvent write.
//
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
  opts: { consentRedacted?: boolean } = {},
): { entryId: string; candidateLabel: string; kind: string; detail: string } {
  const parts = [
    record.schemaVersion,
    record.decision ? "decision" : "no-decision",
    record.offer ? "offer" : "no-offer",
  ];
  // WHAT egressed includes whether the identity was withheld — otherwise a redacted
  // export and a full one leave the same audit row.
  if (opts.consentRedacted) parts.push("consent-redacted");
  return {
    entryId,
    candidateLabel: record.candidate.displayName,
    kind: ATS_EXPORT_EVENT_KIND,
    detail: `ATS per-candidate PII export (${parts.join(", ")})`,
  };
}

/**
 * The READ-TIME GDPR consent gate for this export door — `consentWithholdsPii`'s
 * counterpart at the one boundary where identity leaves for a THIRD-PARTY system.
 *
 * Every other PII read boundary already consults the gate (/api/analyses/[slug],
 * /api/interview/by-entry, candidate-timeline, the palette entity labels), because
 * `anonymizeExpiredConsents` is a deferred sweep with no production caller — so an
 * entry whose retention window lapsed keeps its raw `candidate_label` / `contact`
 * columns indefinitely and a raw record read serves them. This export was the outlier:
 * it shipped the full name and deliverable address of a candidate whose lawful basis
 * had expired, into the customer's ATS, where kp can no longer erase it.
 *
 * Redact rather than refuse, matching `anonymizeEntry`: produce exactly what the sweep
 * WOULD have produced — the label masked to "First L.", the contact dropped — while
 * KEEPING the non-identifying retained record (stage, status, match score, archetype,
 * the sealed decision chain) so a connector's stage sync keeps working on the
 * pseudonymous row. Pure; never mutates its input.
 */
export function redactAtsRecordForConsent(record: AtsCandidateRecord): AtsCandidateRecord {
  return {
    ...record,
    candidate: {
      ...record.candidate,
      displayName: maskCandidateName(record.candidate.displayName),
      contact: null,
    },
  };
}
