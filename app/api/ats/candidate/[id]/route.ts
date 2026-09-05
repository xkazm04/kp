import { NextRequest, NextResponse } from "next/server";
import { getAtsRecordResult } from "@/app/_lib/ats-egress";
import { jsonRefusal } from "@/app/_lib/api-response";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { consentWithholdsPii } from "@/app/_lib/consent";
import { ensureDb, recordEvent } from "@/app/_lib/db/core";
import { getPipelineEntry } from "@/app/_lib/db/pipeline";
import { buildAtsExportAudit, redactAtsRecordForConsent } from "../ats-candidate-audit.ts";


// P1-5 — the SCOPED, ATS-portable export for ONE candidate (the honest counterpart
// to the whole-DB dump). A connector / iPaaS pulls the normalized record by entry
// id and maps it into the customer's system of record. 404 when the entry is gone.
//
// OPERATOR-only: this returns a full candidate PII record (name, contact, archetype,
// salary, sealed decision) by entry id — a by-id PII egress door that authentication
// alone must not open to any org member. bug-ui-scan-2026-07-09 (ats #5): the operator
// gate closes anonymous enumeration; every successful export is ALSO audited on the
// candidate's own immutable pipeline-event timeline so a bulk harvest is detectable.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  const { id } = await params;
  // Scoped to the caller's team: this is the only ATS route that touches per-tenant
  // candidate PII, and it was the only one not resolving a tenant — so it served
  // the default workspace to everyone and 404'd every other team's own candidates.
  const workspaceId = await currentWorkspace();
  const { record, refusal } = getAtsRecordResult(id, workspaceId);
  // An ANONYMIZED entry is refused by the mapper itself (ats-record.ts, through the
  // shared consent predicates). Surfaced under its own code and 410, never the 404
  // below: the operator can still see the masked row on the board, and "not found"
  // would deny an erasure the product performed on purpose. Logged, not audited —
  // nothing left, so there is no export to audit.
  if (refusal) {
    console.info(`[ats] candidate export refused for ${id}: ${refusal.reason}`);
    return jsonRefusal("ATS_CANDIDATE_ERASED", 410);
  }
  if (!record) {
    return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
  }
  // GDPR read-time consent gate. The `anonymizeExpiredConsents` sweep DOES run (the
  // clock calls it every tick — instrumentation-node.ts), but it is best-effort and
  // periodic: between a consent lapsing and the next successful sweep an entry still
  // holds its raw label/contact columns, and a sweep that throws is logged and skipped.
  // The read-time gate is the control; the sweep is the optimization behind it — which is
  // exactly what consent.ts says. Every other PII read boundary already consults
  // consentWithholdsPii; this one is the EXPORT, so it matters most: what leaves here
  // lands in a third-party ATS kp can no longer erase. Fail closed: if the entry can't be
  // re-read (a race with erasure), redact.
  const entry = getPipelineEntry(id, workspaceId);
  const consentRedacted =
    !entry ||
    consentWithholdsPii({
      givenAt: entry.consentGivenAt,
      expiresAt: entry.consentExpiresAt,
      anonymizedAt: entry.anonymizedAt,
    });
  const exported = consentRedacted ? redactAtsRecordForConsent(record) : record;
  // Audit the PII egress (bug-ui-scan #5). Best-effort: a failed audit-write must not
  // break a legitimate operator export, but it is never silent — it falls back to a
  // server error log so the access is recorded somewhere either way. Audits what ACTUALLY
  // left (the redacted record, flagged as such), never the pre-gate one.
  try {
    recordEvent(ensureDb(), buildAtsExportAudit(id, exported, { consentRedacted }));
  } catch (e) {
    console.error(`[ats] failed to audit candidate export for ${id}:`, e instanceof Error ? e.message : e);
  }
  return NextResponse.json(exported);
}
