import { NextRequest, NextResponse } from "next/server";
import { salaryBenchmark } from "@/app/_lib/db/salary-benchmark";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";

// Phase 2 (cross-company reference tier) — the market salary band for a role, aggregated
// from the SHARED reference corpus. Aggregate-only + min-cohort guarded (benchmark is null
// below the floor). No workspace scope: the corpus is the deployment-wide reference and
// PII-free (synthetic reference roles).
export async function GET(request: NextRequest) {
  try {
    const roleFamily = request.nextUrl.searchParams.get("roleFamily")?.trim();
    // A coded refusal, not bare prose: the caller's move is to name a role family, and
    // the surface that shows it must be able to say so in the reader's language.
    if (!roleFamily) return jsonRefusal("BENCHMARK_ROLE_FAMILY_REQUIRED", 400);
    const seniority = request.nextUrl.searchParams.get("seniority")?.trim() || null;
    return NextResponse.json({ benchmark: salaryBenchmark({ roleFamily, seniority }) });
  } catch (error) {
    return safeJsonError(error, "api:benchmarks:salary", "BENCHMARK_FAILED");
  }
}
