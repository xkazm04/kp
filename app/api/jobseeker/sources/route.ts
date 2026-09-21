import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { createJobseekerSource, listJobseekerSources } from "@/app/_lib/db/jobseeker-sources";
import { hostForAdapter } from "@/app/_lib/jobseeker/adapters/registry";
import { catalogEntry, sourcesCatalog, tierForHost } from "@/app/_lib/jobseeker/sources-catalog";
import { isSourceAdapterName, type SourceKind } from "@/app/_lib/jobseeker/types";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// /api/jobseeker/sources — the owner-confirmed acquisition list (ADR 0009 §3).
// GET  — the research catalog (tiers, quoted clauses, termsHash) + this workspace's sources.
// POST — create a source from a catalog id, or from {adapter, config, host} (an ATS by
//        company slug, a board by host). Tier C is refused: it has no enable control.
// Operator-gated by the proxy AND re-verified here; the limiter is the real bound in
// open mode (pinned in app/api/rate-limit-contract.test.ts).

export async function GET(): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const ws = await currentWorkspace();
    return NextResponse.json({ catalog: sourcesCatalog(), sources: listJobseekerSources(ws) });
  } catch (error) {
    return safeJsonError(error, "api:jobseeker/sources", "JOBSEEKER_STORE_FAILED");
  }
}

type CreateBody = { catalogId?: unknown; adapter?: unknown; config?: unknown; host?: unknown };

function kindFor(adapter: string): SourceKind {
  if (adapter === "eures" || adapter === "mpsv_bulk") return "feed";
  return adapter.startsWith("ats_") ? "ats" : "board";
}

export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  // The seeker's own data, but still a WRITE behind a seat: a viewer seat may read the
  // feed, not spend a scan, a model turn or a source acknowledgement (route-capability-coverage).
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  // THROTTLE before the body is read: a source row is a write, and open mode makes
  // the operator gate a no-op. 60/10min per IP — the Sources page creates one at a time.
  if (!rateLimit(`jobseeker-sources-write:${clientIpFrom(request.headers)}`, { limit: 60, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const body = (await request.json().catch(() => ({}))) as CreateBody;
    const config = body.config && typeof body.config === "object" && !Array.isArray(body.config) ? (body.config as Record<string, unknown>) : {};
    let adapter: string;
    let host: string | null;
    let tier;
    if (typeof body.catalogId === "string") {
      const entry = catalogEntry(body.catalogId);
      if (!entry) return jsonRefusal("JOBSEEKER_SOURCE_NOT_FOUND", 404);
      if (entry.tier === "C") return jsonRefusal("JOBSEEKER_SOURCE_REFUSED", 403, { reason: entry.refusedReason });
      adapter = entry.adapter;
      tier = entry.tier;
      const merged = { ...entry.defaultConfig, ...config };
      host = entry.needsCompanyConfig ? hostForAdapter(entry.adapter, merged) : entry.host;
      if (!host) return jsonRefusal("JOBSEEKER_RULES_INVALID", 400, { field: "config" });
      const created = createJobseekerSource({ kind: entry.kind, adapter: entry.adapter, tier, host, config: merged }, await currentWorkspace());
      return NextResponse.json({ source: created }, { status: 201 });
    }
    if (!isSourceAdapterName(body.adapter)) return jsonRefusal("JOBSEEKER_RULES_INVALID", 400, { field: "adapter" });
    adapter = body.adapter;
    host = hostForAdapter(body.adapter, config) ?? (typeof body.host === "string" && body.host.trim() ? body.host.trim().toLowerCase() : null);
    if (!host) return jsonRefusal("JOBSEEKER_RULES_INVALID", 400, { field: "host" });
    tier = tierForHost(host);
    if (tier === "C") return jsonRefusal("JOBSEEKER_SOURCE_REFUSED", 403);
    const created = createJobseekerSource({ kind: kindFor(adapter), adapter: body.adapter, tier, host, config }, await currentWorkspace());
    return NextResponse.json({ source: created }, { status: 201 });
  } catch (error) {
    return safeJsonError(error, "api:jobseeker/sources", "JOBSEEKER_STORE_FAILED");
  }
}
