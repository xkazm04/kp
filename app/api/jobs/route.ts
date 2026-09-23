import { NextRequest, NextResponse } from "next/server";
import { getSeedHealth } from "@/app/_lib/db/core";
import { countJobs, isJobBrowseSort, isRoleStatus, jobStats, JOBS_WINDOW_LIMIT, listJobsPage, type JobFilter } from "@/app/_lib/db/jobs";
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

// The window's offset: a non-negative integer, else 0 (never NaN or a negative bind).
function parseOffset(raw: string | null): number {
  const n = Number(raw);
  return raw !== null && raw.trim() !== "" && Number.isInteger(n) && n > 0 ? n : 0;
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const entry = sp.get("entryEligible");
    const open = sp.get("openOnly");
    const ws = await currentWorkspace();
    // The Roles desk's window. Each value is checked against an allowlist HERE, so an
    // unknown sort/dir/status falls back to the default and never reaches the SQL.
    const rawSort = sp.get("sort");
    const sort = isJobBrowseSort(rawSort) ? rawSort : undefined;
    const rawDir = sp.get("dir");
    const dir = sort && (rawDir === "asc" || rawDir === "desc") ? rawDir : sort ? "asc" : undefined;
    const rawStatus = sp.get("roleStatus");
    const roleStatus = isRoleStatus(rawStatus) ? rawStatus : undefined;
    const offset = parseOffset(sp.get("offset"));
    // A windowed read (the desk sends one of these) is a pager page unless it names a limit.
    const windowed = sp.has("sort") || sp.has("offset") || sp.has("roleStatus");
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
      limit: parseLimit(sp.get("limit")) ?? (windowed ? JOBS_WINDOW_LIMIT : undefined),
      sort,
      dir,
      offset,
      roleStatus,
      // The Status column reads "hired / target": `hired` is the PIPELINE's own
      // terminal-ROLE count on this workspace's axis, read by the store in the same
      // query that filters and sorts on it, so badge, filter and order cannot disagree.
      withHired: true,
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
        // The failing SEED PATH is operator detail, not client detail: it used to ride
        // in the response prose, so an absolute filesystem path landed in the catalog's
        // red box — in English, in every locale. safeJsonError logs the path + reason
        // server-side and answers the code the client resolves through `errors.*`.
        return safeJsonError(
          new Error(`jobs seed failed to load (${seedError.path}): ${seedError.reason}`),
          "api:jobs/list",
          "JOB_SEED_BROKEN"
        );
      }
    }
    // `window` echoes what was APPLIED (null = the default), not what was asked.
    const window = { sort: sort ?? null, dir: dir ?? null, offset, roleStatus: roleStatus ?? null };
    return NextResponse.json({ jobs, stats, truncated, matching, limit, window });
  } catch (error) {
    return safeJsonError(error, "api:jobs/list", "JOB_LIST_FAILED");
  }
}
