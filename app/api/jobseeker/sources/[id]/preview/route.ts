import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { getJobseekerSource } from "@/app/_lib/db/jobseeker-sources";
import { listingPages } from "@/app/_lib/jobseeker/adapters/boardRules";
import { politeFetch } from "@/app/_lib/jobseeker/fetch/politeFetch";
import { isCollapsed } from "@/app/_lib/jobseeker/rules/collapse";
import { isRulesError, validateRules } from "@/app/_lib/jobseeker/rules/dsl";
import { dryRun } from "@/app/_lib/jobseeker/rules/engine";
import { isOffline } from "@/app/_lib/offline";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// POST /api/jobseeker/sources/[id]/preview — { rules?, url? } → the rules run against
// the LIVE listing page through the production engine; nothing is written. The
// owner reads per-rule verdicts and the first items before saving (PATCH). Tier C is
// never fetched. `offline` → 503 JOBSEEKER_OFFLINE; a denial → 423 JOBSEEKER_SOURCE_BLOCKED.

type PreviewBody = { rules?: unknown; url?: unknown };
const PREVIEW_ITEMS = 5;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  // THROTTLE before the fetch: every preview is a request to a third-party host under
  // our politeness budget. 10/10min per IP — a rule-authoring session is a few tries.
  if (!rateLimit(`jobseeker-preview:${clientIpFrom(request.headers)}`, { limit: 10, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as PreviewBody;
    const ws = await currentWorkspace();
    const source = getJobseekerSource(id, ws);
    if (!source) return jsonRefusal("JOBSEEKER_SOURCE_NOT_FOUND", 404);
    if (source.tier === "C") return jsonRefusal("JOBSEEKER_SOURCE_REFUSED", 403);
    const rules = validateRules(body.rules ?? source.rules);
    if (isRulesError(rules)) return jsonRefusal("JOBSEEKER_RULES_INVALID", 400, { detail: rules.error });
    const url = typeof body.url === "string" && /^https?:\/\//.test(body.url) ? body.url : listingPages(source)[0];
    if (!url) return jsonRefusal("JOBSEEKER_RULES_INVALID", 400, { detail: "url: no listing page to preview" });
    if (isOffline()) return jsonRefusal("JOBSEEKER_OFFLINE", 503);

    const fetched = await politeFetch(url, { sourceId: source.id, host: source.host, accept: "text/html, application/xhtml+xml;q=0.9" });
    if (fetched.kind === "offline") return jsonRefusal("JOBSEEKER_OFFLINE", 503);
    if (fetched.kind === "blocked") return jsonRefusal("JOBSEEKER_SOURCE_BLOCKED", 423, { detail: fetched.detail });
    if (fetched.kind !== "ok") return jsonRefusal("JOBSEEKER_PREVIEW_FAILED", 502, { detail: fetched.detail });

    const { items, perRule } = dryRun(rules, fetched.body, fetched.finalUrl || url);
    const collapsed = isCollapsed(perRule, rules, source.rulesBaseline);
    return NextResponse.json({
      outcome: collapsed ? "collapsed" : items.length > 0 ? "ok" : "empty",
      url: fetched.finalUrl || url,
      perRule,
      items: items.slice(0, PREVIEW_ITEMS),
      itemCount: items.length,
      // What PATCH persists beside the rules as the collapse-detection baseline.
      baseline: Object.fromEntries(perRule.map((r) => [r.field, r.matched])),
    });
  } catch (error) {
    return safeJsonError(error, "api:jobseeker/sources/[id]/preview", "JOBSEEKER_STORE_FAILED");
  }
}
