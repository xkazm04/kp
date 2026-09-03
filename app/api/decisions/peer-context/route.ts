import { NextResponse } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jdSlugOfJobId } from "@/app/_lib/jd-limits";
import { getJobsByIds } from "@/app/_lib/db/jobs";
import { listEntriesForJob } from "@/app/_lib/db/pipeline";
import { freshestAnalysisSlugByLabel, loadAnalysis } from "@/app/_lib/db/analyses";
import { buildFreshestFits } from "@/app/_lib/match-score-resolve";
import type { AnalysisFit } from "@/app/_lib/match-score";

// Peer-comparison facts for the Decisions AI-review cards: per active entry on a
// job, the candidate's SAVED salary expectation and skill coverage against the
// role — all read from stored CV analyses, never a fresh LLM/ranker run. Score
// ranking itself is NOT served here: the client already holds every entry's
// canonicalScore from GET /api/pipeline and ranks locally.
//
// Join, two tiers (honesty over coverage):
//   1. STRICT (label, jd-slug) — the same freshest-fit map the canonical score
//      uses. Skills come from the analysis' own jobFit (verified against THIS
//      JD) → basis "verified".
//   2. LABEL-ONLY fallback — the freshest analysis for the candidate regardless
//      of JD (corpus jobs have no jd slug at all). Only CANDIDATE-level facts
//      may cross this join: the salary expectation, and skills as a declared
//      overlap (candidate.skills ∩ job requirements, case-insensitive) →
//      basis "declared". A jobFit computed against another role is never used.
// Operator-gated + tenant-scoped like the rest of /api/decisions/*.

type SalaryFacts = { minimum: number; maximum: number; midpoint: number; currency: string };
type SkillFacts = { matched: number; missing: number; basis: "verified" | "declared" };
export type PeerEntryFacts = { salary: SalaryFacts | null; skills: SkillFacts | null };
export type JobPeerContext = {
  // The role's recommended salary band [min, max] (job.salaryBand, APP_CURRENCY
  // by contract) — the reference each expectation is plotted against. Null when
  // the job carries none.
  salaryBand: number[] | null;
  byEntry: Record<string, PeerEntryFacts>;
};

const fitKey = (label: string, jdSlug: string) => `${label.trim().toLowerCase()} ${jdSlug}`;

function salaryFrom(payload: unknown): SalaryFacts | null {
  const s = (payload as { salary?: Partial<SalaryFacts> } | null)?.salary;
  if (!s || !((s.minimum ?? 0) > 0 || (s.maximum ?? 0) > 0)) return null;
  return {
    minimum: s.minimum ?? 0,
    maximum: s.maximum ?? 0,
    midpoint: s.midpoint ?? Math.round(((s.minimum ?? 0) + (s.maximum ?? 0)) / 2),
    currency: s.currency ?? "",
  };
}

function verifiedSkillsFrom(payload: unknown): SkillFacts | null {
  const jf = (payload as { jobFit?: { matchingSkills?: unknown; missingSkills?: unknown } } | null)?.jobFit;
  if (!jf || !Array.isArray(jf.matchingSkills) || !Array.isArray(jf.missingSkills)) return null;
  return { matched: jf.matchingSkills.length, missing: jf.missingSkills.length, basis: "verified" };
}

/** Declared coverage: how many of the role's named requirements appear among the
 *  candidate's declared skills (exact name, case-insensitive). Deliberately NOT
 *  fuzzy — a taxonomy miss undercounts, which is the safe direction. */
function declaredSkillsFrom(payload: unknown, requirements: { skill: string }[]): SkillFacts | null {
  const skills = (payload as { candidate?: { skills?: unknown } } | null)?.candidate?.skills;
  if (!Array.isArray(skills) || requirements.length === 0) return null;
  const declared = new Set(skills.filter((s): s is string => typeof s === "string").map((s) => s.trim().toLowerCase()));
  if (declared.size === 0) return null;
  const matched = requirements.filter((r) => declared.has(r.skill.trim().toLowerCase())).length;
  return { matched, missing: requirements.length - matched, basis: "declared" };
}

export async function GET(request: Request) {
  const denied = await requireOperator();
  if (denied) return denied;
  const ws = await currentWorkspace();
  const raw = new URL(request.url).searchParams.get("jobs") ?? "";
  const jobIds = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 50);
  if (jobIds.length === 0) return NextResponse.json({ jobs: {} });

  // One analyses query per map for all jobs; per-entry payload reads are point
  // SELECTs on the resolved slug, memoized per (label) so two entries for the
  // same candidate don't re-read.
  const fits: Map<string, AnalysisFit> = jobIds.some((id) => jdSlugOfJobId(id))
    ? buildFreshestFits(ws)
    : new Map<string, AnalysisFit>();
  const byLabel = freshestAnalysisSlugByLabel(ws);
  const payloadCache = new Map<string, unknown | null>();
  const readPayload = (slug: string): unknown | null => {
    if (!payloadCache.has(slug)) payloadCache.set(slug, loadAnalysis(slug, ws)?.payload ?? null);
    return payloadCache.get(slug) ?? null;
  };

  // One chunked IN-query for all requested jobs (getJobsByIds) instead of a point
  // SELECT per id — up to 50 ids arrive in one request.
  const jobById = new Map(getJobsByIds(jobIds, ws).map((j) => [j.id, j]));
  const jobs: Record<string, JobPeerContext> = {};
  for (const jobId of jobIds) {
    const job = jobById.get(jobId) ?? null;
    const slug = jdSlugOfJobId(jobId);
    const band = Array.isArray(job?.salaryBand) && job.salaryBand.length >= 2 ? job.salaryBand.slice(0, 2) : null;
    const requirements = (job?.requirements ?? [])
      .filter((r) => typeof r?.skill === "string")
      .map((r) => ({ skill: r.skill }));
    const byEntry: Record<string, PeerEntryFacts> = {};
    for (const e of listEntriesForJob(jobId, ws)) {
      if (e.status !== "active") continue;
      // Tier 1: the JD-strict analysis (same join as the canonical score).
      const fit = slug ? fits.get(fitKey(e.candidateLabel, slug)) : null;
      const strict = fit?.slug ? readPayload(fit.slug) : null;
      // Tier 2: freshest analysis for the candidate, any JD — candidate-level
      // facts only.
      const labelSlug = byLabel.get(e.candidateLabel.trim().toLowerCase());
      const fallback = !strict && labelSlug ? readPayload(labelSlug) : null;
      const payload = strict ?? fallback;
      byEntry[e.id] = payload
        ? {
            salary: salaryFrom(payload),
            skills: strict ? verifiedSkillsFrom(strict) ?? declaredSkillsFrom(strict, requirements) : declaredSkillsFrom(fallback, requirements),
          }
        : { salary: null, skills: null };
    }
    jobs[jobId] = { salaryBand: band, byEntry };
  }
  return NextResponse.json({ jobs });
}
