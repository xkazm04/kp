import { ensureDb } from "./core";

// Cross-company reference tier (E0 Phase 2, tier-1 shared corpus) — market salary bands
// per role, aggregated from the SHARED reference corpus: the jobs rows with workspace_id
// NULL, which are the deployment-wide reference every team already matches against
// (listCorpusJobs). PII-free (synthetic reference roles) and AGGREGATE-ONLY: percentiles
// over the band midpoints, never an individual role's figure. A min-cohort floor stops a
// 1–2 role sample from masquerading as a market rate. Reads ONLY the corpus (workspace_id
// IS NULL), not a team's authored openings, so a team's own postings can't skew "the
// market"; this deliberately isn't the (IS NULL OR = ?) ownership predicate.

export const SALARY_BENCHMARK_MIN_COHORT = 3;

export type SalaryBenchmark = {
  roleFamily: string;
  seniority: string | null;
  currency: "CZK"; // the reference corpus is Česká spořitelna (CZK); multi-currency bands are a later tier
  count: number;
  p25: number;
  median: number;
  p75: number;
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return Math.round(lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo));
}

/** Market salary band for a role family (optionally narrowed to a seniority), from the
 *  shared reference corpus. Returns null below the min-cohort floor (too few reference
 *  roles to be a meaningful — or anonymous — band). */
export function salaryBenchmark(input: { roleFamily: string; seniority?: string | null }): SalaryBenchmark | null {
  const db = ensureDb();
  const clauses = ["workspace_id IS NULL", "salary_min IS NOT NULL", "salary_max IS NOT NULL", "role_family = ?"];
  const params: unknown[] = [input.roleFamily];
  if (input.seniority) {
    clauses.push("seniority = ?");
    params.push(input.seniority);
  }
  const rows = db.prepare(`SELECT salary_min, salary_max FROM jobs WHERE ${clauses.join(" AND ")}`).all(...params) as {
    salary_min: number;
    salary_max: number;
  }[];
  if (rows.length < SALARY_BENCHMARK_MIN_COHORT) return null;
  const mids = rows.map((r) => Math.round((r.salary_min + r.salary_max) / 2)).sort((a, b) => a - b);
  return {
    roleFamily: input.roleFamily,
    seniority: input.seniority ?? null,
    currency: "CZK",
    count: rows.length,
    p25: percentile(mids, 0.25),
    median: percentile(mids, 0.5),
    p75: percentile(mids, 0.75),
  };
}
