import { NextRequest, NextResponse } from "next/server";
import { listJobs, jobStats, getSeedHealth } from "@/app/_lib/db";


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
    const jobs = listJobs({
      roleFamily: sp.get("roleFamily") ?? undefined,
      seniority: sp.get("seniority") ?? undefined,
      workMode: sp.get("workMode") ?? undefined,
      entryEligible: entry === null ? undefined : entry === "true" || entry === "1",
      // Opt-in: only roles open for applications (NULL/'published' status).
      openOnly: open === "true" || open === "1" ? true : undefined,
      q: sp.get("q") ?? undefined,
      limit: parseLimit(sp.get("limit")),
    });
    const stats = jobStats();
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
    return NextResponse.json({ jobs, stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list jobs.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
