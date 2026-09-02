import { NextRequest, NextResponse } from "next/server";
import { getSeedHealth } from "@/app/_lib/db/core";
import { countJobs, jobStats, listJobsPage, type JobFilter } from "@/app/_lib/db/jobs";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { safeJsonError } from "@/app/_lib/api-response";


const LIMIT_MIN = 1;
const LIMIT_MAX = 500;

// Strict parse + clamp at the trust boundary: a non-integer ("abc", "3.5") or
// empty value falls back to the default (undefined), and out-of-range values are
// clamped to [1, 500] — so `?limit=-1` can't become an unbounded `LIMIT -1` dump
// and `?limit=abc` can't bind NaN and 500 the endpoint.
function parseLimit(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n)) return undefined;
  return Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, n));
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const entry = sp.get("entryEligible");
    const open = sp.get("openOnly");
    const ws = await currentWorkspace();
    // ONE filter object, bound once: the page read and the COUNT below must run the
    // identical predicate or the summary they feed contradicts itself.
    const filter: JobFilter = {
      roleFamily: sp.get("roleFamily") ?? undefined,
      seniority: sp.get("seniority") ?? undefined,
      workMode: sp.get("workMode") ?? undefined,
      entryEligible: entry === null ? undefined : entry === "true" || entry === "1",
      // Opt-in: only roles open for applications (NULL/'published' status).
      openOnly: open === "true" || open === "1" ? true : undefined,
      q: sp.get("q") ?? undefined,
      limit: parseLimit(sp.get("limit")),
    };
    // listJobsPage, not listJobs: the page read looks ONE row past the slice, so the
    // response can say "the first N of more" instead of presenting a cut slice as the
    // whole result. Paired with `matching` — the unbounded COUNT over the SAME
    // predicate — the client can tell "300 of 340 in this workspace" (ordinary
    // filtering) apart from "300 of 312 matching, cut" (40 roles unreachable). With
    // only `stats.total` (a real, UNFILTERED count) the truncation was invisible:
    // a workspace of 340 roles rendered "Showing 300 of 340" and the 40 missing roles
    // read as filtered-out rather than as a page the UI offers no way to advance past.
    const { jobs, truncated, limit } = listJobsPage(filter, ws);
    const matching = countJobs(filter, ws);
    const stats = jobStats(ws);
    // An empty corpus caused by a corrupt seed used to be invisible — surface it
    // with the failing path + reason instead of serving a silent empty catalog.
    if (stats.total === 0) {
      const seedError = getSeedHealth().issues.find((i) => i.seed === "jobs" && i.severity === "error");
      if (seedError) {
        return NextResponse.json(
          { error: `Job catalog is empty — seed failed to load (${seedError.path}: ${seedError.reason}).` },
          { status: 500 }
        );
      }
    }
    return NextResponse.json({ jobs, stats, truncated, matching, limit });
  } catch (error) {
    return safeJsonError(error, "api:jobs/list", "JOB_LIST_FAILED");
  }
}
