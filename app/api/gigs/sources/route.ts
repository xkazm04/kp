import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { createGigSource, listGigSources } from "@/app/_lib/db/gigs-sources";
import { gigCatalogEntry, gigSourcesCatalog, gigSourceTermsCurrent } from "@/app/_lib/gigs/sources-catalog";
import { isGigAdapterName } from "@/app/_lib/gigs/types";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// /api/gigs/sources - the operator-confirmed list of official APIs a gig scan reads.
// GET  -> { sources (each with `termsCurrent`: its acknowledgement matches the terms
//         summary as it reads NOW), catalog: one entry per adapter (tier, arena, host,
//         needsKey + env var NAMES, keyless behaviour, terms summary + termsHash for tier
//         B; gigs/sources-catalog.ts) }
// POST { adapter, config? } -> 201 { source }. Tier comes from the adapter, never the
//         body: tier A is created enabled, tier B disabled + paused `terms_review` until
//         the operator acknowledges (PATCH /api/gigs/sources/[id]). A tier-C adapter, or
//         one with no source to fetch (`manual`), is 403 GIG_SOURCE_REFUSED.

export async function GET(): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const ws = await currentWorkspace();
    const sources = listGigSources(ws).map((s) => ({ ...s, termsCurrent: gigSourceTermsCurrent(s) }));
    return NextResponse.json({ sources, catalog: gigSourcesCatalog() });
  } catch (error) {
    return safeJsonError(error, "api:gigs/sources", "GIG_STORE_FAILED");
  }
}

const CONFIG_MAX_CHARS = 4000;

export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`gigs-sources-write:${clientIpFrom(request.headers)}`, { limit: 60, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const body = (await request.json().catch(() => ({}))) as { adapter?: unknown; config?: unknown };
    if (!isGigAdapterName(body.adapter)) return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "adapter" });
    if (body.config !== undefined && (!body.config || typeof body.config !== "object" || Array.isArray(body.config))) {
      return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "config" });
    }
    const config = (body.config ?? {}) as Record<string, unknown>;
    // Config is adapter search parameters, never a secret and never a document.
    if (JSON.stringify(config).length > CONFIG_MAX_CHARS) return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "config" });
    const entry = gigCatalogEntry(body.adapter);
    if (entry.tier === "C" || !entry.creatable || !entry.host || !entry.arena) {
      return jsonRefusal("GIG_SOURCE_REFUSED", 403, { adapter: entry.adapter });
    }
    const source = createGigSource(await currentWorkspace(), { adapter: entry.adapter, arena: entry.arena, host: entry.host, config });
    return NextResponse.json({ source: { ...source, termsCurrent: gigSourceTermsCurrent(source) } }, { status: 201 });
  } catch (error) {
    return safeJsonError(error, "api:gigs/sources", "GIG_STORE_FAILED");
  }
}
