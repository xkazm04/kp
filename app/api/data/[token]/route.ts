import { NextRequest, NextResponse } from "next/server";
import { anonymizeEntry, findEntryByErasureToken, getJob } from "@/app/_lib/db";
import { jsonOk, safeJsonError } from "@/app/_lib/api-response";

export const runtime = "nodejs";

// Public, token-gated GDPR self-service data endpoint (right to erasure, Art. 17).
// The token is the entry's opaque erasure capability (ensureErasureToken), carried
// by the "manage your data" footer on every candidate comm. Like the status route,
// it returns a candidate-safe projection only — role/company/applied-date + consent
// expiry — never the internal entry id, name, score, archetype or reasoning.
export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const entry = findEntryByErasureToken(token);
    if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });
    const company = entry.jobId ? getJob(entry.jobId)?.company ?? null : null;
    return jsonOk({
      jobTitle: entry.jobTitle ?? null,
      company,
      appliedAt: entry.createdAt ?? null,
      consentExpiresAt: entry.consentExpiresAt ?? null,
      anonymized: entry.anonymizedAt != null,
    });
  } catch (error) {
    return safeJsonError(error, "api:data", "DATA_LOOKUP_FAILED");
  }
}

// Candidate-initiated erasure: scrub PII while retaining the de-identified
// recruitment record (anonymizeEntry, reason "erasure"). Idempotent — the token is
// nulled on first erasure, so a replay simply 404s. No body required.
export async function POST(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const entry = findEntryByErasureToken(token);
    if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });
    anonymizeEntry(entry.id, "erasure");
    return jsonOk({ erased: true });
  } catch (error) {
    return safeJsonError(error, "api:data", "DATA_ERASE_FAILED");
  }
}
