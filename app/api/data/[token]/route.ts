import { NextRequest, NextResponse } from "next/server";
import { interviewStatusByEntries } from "@/app/_lib/db/interviews";
import { getJob } from "@/app/_lib/db/jobs";
import { anonymizeEntry, findEntryByErasureToken } from "@/app/_lib/db/pipeline";
import { heldDataCategories } from "@/app/_lib/data-held";
import { jsonOk, jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";

// Abuse containment (2026-09-01): this was the one public token door with NO
// throttle while status / offer / schedule / apply all have one — and its POST is
// the most consequential public write in the product, an IRREVERSIBLE scrub. The
// token is a strong CSPRNG capability, so this is not guessing prevention: it caps
// what a single link-holder (or a logged/leaked link) can do per minute, and it
// runs BEFORE the token lookup so a flood is rejected without touching the store.
// Keyed by token AND client, like the status route, so the untrusted-proxy shared
// client key still gives each candidate their own bucket.
//
// The read side mirrors the status bound: DataClient loads once and re-reads after
// an erasure; 60/min leaves more than an order of magnitude of headroom. The erase
// side is tighter: one candidate erases once, so 10/min is generous for a human and
// hostile to a script.
const DATA_VIEW_RATE_LIMIT = { limit: 60, windowMs: 60_000 };
const DATA_ERASE_RATE_LIMIT = { limit: 10, windowMs: 60_000 };

// Public, token-gated GDPR self-service data endpoint (right to erasure, Art. 17).
// The token is the entry's opaque erasure capability (ensureErasureToken), carried
// by the "manage your data" footer on every candidate comm. Like the status route,
// it returns a candidate-safe projection only — role/company/applied-date + consent
// expiry — never the internal entry id, name, score, archetype or reasoning.
export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    if (!rateLimit(`data-view:${clientIpFrom(request.headers)}:${token}`, DATA_VIEW_RATE_LIMIT)) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }
    const entry = findEntryByErasureToken(token);
    if (!entry) return jsonRefusal("DATA_LINK_INVALID", 404);
    const company = entry.jobId ? getJob(entry.jobId)?.company ?? null : null;
    // #5 — project the "what we hold" list from what this entry ACTUALLY has, so we
    // never claim to hold interview records / scores for a candidate who only applied.
    const held = heldDataCategories({
      hasContact: entry.contact != null,
      hasInterview: interviewStatusByEntries([entry.id], entry.workspaceId ?? undefined)[entry.id] != null,
      hasScore: entry.matchScore != null,
    });
    return jsonOk({
      jobTitle: entry.jobTitle ?? null,
      company,
      appliedAt: entry.createdAt ?? null,
      consentExpiresAt: entry.consentExpiresAt ?? null,
      anonymized: entry.anonymizedAt != null,
      held,
    });
  } catch (error) {
    return safeJsonError(error, "api:data", "DATA_LOOKUP_FAILED");
  }
}

// Candidate-initiated erasure: scrub PII while retaining the de-identified
// recruitment record (anonymizeEntry, reason "erasure"). Idempotent — the token is
// nulled on first erasure, so a replay simply 404s. No body required.
export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    // Throttle BEFORE the lookup: an irreversible write must never be the cheap
    // thing a flood reaches first.
    if (!rateLimit(`data-erase:${clientIpFrom(request.headers)}:${token}`, DATA_ERASE_RATE_LIMIT)) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }
    const entry = findEntryByErasureToken(token);
    if (!entry) return jsonRefusal("DATA_LINK_INVALID", 404);
    // Tenant (P1): erase inside the entry's OWN team. anonymizeEntry scrubs under
    // `WHERE id = ? AND workspace_id = ?`, so the bare call matched NO row for any
    // candidate outside the default workspace — the scrub silently did nothing while
    // this endpoint still answered `{ erased: true }`. A candidate exercised their
    // Art. 17 right to erasure, was told it was done, and their name, contact, CV
    // profile, saved analyses and interview transcript stayed fully readable on the
    // recruiter's board. The workspace comes off the row the TOKEN resolved to —
    // never a session: this is a public capability-link route and has none.
    anonymizeEntry(entry.id, "erasure", entry.workspaceId);
    return jsonOk({ erased: true });
  } catch (error) {
    return safeJsonError(error, "api:data", "DATA_ERASE_FAILED");
  }
}
