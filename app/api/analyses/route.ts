import { listAnalyses } from "@/app/_lib/db/analyses";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { jsonOk, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";

// How many rows this door will return at most, and what it returns when the caller says
// nothing. The handler used to call `listAnalyses(200, ws)` with 200 typed inline and no
// way for the caller to ask for fewer or to learn there were more: a workspace past 200
// analyses silently lost the tail, and History rendered a complete-looking list that
// wasn't. The cap stays (each row is a summary, but the list is unpaged and the History
// tab renders every one), and the answer now SAYS when it bit.
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

/** The caller's `?limit=`, clamped into [1, MAX_LIMIT]. A missing, blank, non-numeric or
 *  out-of-range value falls back rather than 400ing: this is a read whose caller is a tab
 *  refresh, and refusing it would replace a list with an error box over a typo in a URL.
 *  NOT exported: a Next route module may only export its verbs, so the clamp is proven
 *  through the handler in analyses-routes.test.ts rather than called directly. */
function clampLimit(raw: string | null): number {
  // Number(null) is 0 and Number("") is 0 — both FINITE, so an absent or blank param
  // would clamp to 1 and hand History a one-row list. The blank check comes first.
  if (raw == null || !raw.trim()) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(n)));
}

export async function GET(request: Request) {
  // Defense in depth: /api/analyses is not on the public allow-list, so middleware already
  // requires a session — but presence is not authorization, and this door serves every
  // analyzed candidate's full summary row in the workspace. `read` is the capability every
  // seated role holds, including `viewer`, so this refuses only a caller with no seat at
  // all; it is the assertion, not a new restriction.
  const denied = await requireCapabilityCoded("read", requireCapability);
  if (denied) return denied;
  try {
    const limit = clampLimit(new URL(request.url).searchParams.get("limit"));
    const rows = listAnalyses(limit, await currentWorkspace());
    return jsonOk({
      analyses: rows,
      limit,
      // A full page is indistinguishable from "exactly this many exist" without asking for
      // one more row, and this list collapses re-runs by (cv_hash, jd_slug) so a COUNT(*)
      // would answer a different question. Reporting the boundary honestly is what the
      // client needs: it can ask for more, and it can stop claiming the list is complete.
      truncated: rows.length >= limit,
    });
  } catch (error) {
    // The thrown message carries SQLITE_* text and the absolute db path; the client gets
    // the code and resolves `errors.ANALYSES_LIST_FAILED` in its own language.
    return safeJsonError(error, "api:analyses", "ANALYSES_LIST_FAILED");
  }
}
