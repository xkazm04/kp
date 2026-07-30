import { NextRequest, NextResponse } from "next/server";
import { getPipelineEntry } from "@/app/_lib/db";
import { getEntryIdByStatusToken } from "@/app/_lib/application-status-store";
import { candidateStatusFor, isTerminalCandidateStatus } from "@/app/_lib/application-status";
import { parseNpsSubmission } from "@/app/_lib/candidate-nps";
import { candidateNpsFor, recordCandidateNps } from "@/app/_lib/candidate-nps-store";
import { jsonOk, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";

// W0.6b — candidate NPS capture on the public, token-gated status page.
//
//   GET  -> { asked: boolean, answered: { score, comment } | null }
//   POST -> { ok: true }   body: { score: 0..10, comment?: string }
//
// Tighter than the status route's 60/min: this WRITES, and a candidate legitimately
// submits once (twice if they change their mind), so a low cap costs nothing real.
const NPS_RATE_LIMIT = { limit: 10, windowMs: 60_000 };

/** Resolve the token to an entry, and decide whether asking is even appropriate. */
function resolve(token: string) {
  const entryId = getEntryIdByStatusToken(token);
  if (!entryId) return null;
  const entry = getPipelineEntry(entryId);
  if (!entry) return null;
  // Only a TERMINAL outcome (hired / not selected) gets the question. Asking someone
  // mid-process how the process went would both be premature and read as pressure while
  // their application is still live.
  const asked = isTerminalCandidateStatus(candidateStatusFor(entry.status, entry.stage));
  return { entryId, asked };
}

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    if (!rateLimit(`nps:${clientIpFrom(request.headers)}:${token}`, NPS_RATE_LIMIT)) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }
    const resolved = resolve(token);
    if (!resolved) return NextResponse.json({ error: "not found" }, { status: 404 });
    return jsonOk({ asked: resolved.asked, answered: candidateNpsFor(resolved.entryId) });
  } catch (error) {
    return safeJsonError(error, "api:status:nps", "STATUS_NPS_READ_FAILED");
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    if (!rateLimit(`nps:${clientIpFrom(request.headers)}:${token}`, NPS_RATE_LIMIT)) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }
    const resolved = resolve(token);
    if (!resolved) return NextResponse.json({ error: "not found" }, { status: 404 });
    // Refuse rather than silently store: a response captured mid-process would be folded
    // into a "candidate experience" figure that claims to measure completed journeys.
    if (!resolved.asked) return NextResponse.json({ error: "not applicable yet" }, { status: 409 });

    const body = (await request.json().catch(() => ({}))) as { score?: unknown; comment?: unknown };
    const parsed = parseNpsSubmission(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.reason }, { status: 400 });

    recordCandidateNps(resolved.entryId, parsed.score, parsed.comment);
    return jsonOk({ ok: true });
  } catch (error) {
    return safeJsonError(error, "api:status:nps", "STATUS_NPS_WRITE_FAILED");
  }
}
