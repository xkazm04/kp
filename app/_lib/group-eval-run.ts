import { writeFile } from "node:fs/promises";
import path from "node:path";
import { getJob, getProfileRecord, loadAnalysis, type JobRecord } from "./db";
import { runReasoning } from "./reasoning-run";
import { saveGroupEval } from "./group-eval";
import { isEarlyCareer } from "./archetypes";
import { resolveCandidatePoolEntry, type CandidatePoolEntry } from "./candidate-pool";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, spawnPython } from "./python-runner";

// Cap on how many candidates one comparative evaluation covers. The strongest
// are selected by fit BEFORE the cap (see below), and the modal surfaces
// "top N of M" so a bounded comparison never reads as full coverage.
const GROUP_EVAL_CAP = 6;

// Decisions "group evaluation": a comparative read of every candidate competing
// for one role. For each candidate it pulls the gathered profile data, the FULL
// deterministic match breakdown (recruiter_cli — per-dimension scores, confidence
// band, matched/missing skills with provenance & strength, fit tier), and a
// best-effort AI fit reasoning (cached). It then synthesizes a ranking, a top
// pick, differentiators, risks, and an AI "compare all" narrative — LLM-enriched
// where available, deterministic otherwise — and persists the lot so the modal
// can re-open it without re-running.

export type GroupEvalCandidate = { entryId: string; candidateId: string | null; label: string; matchScore: number | null };
type Reasoning = { verdict?: string; strengths?: string[]; gaps?: string[]; interviewProbes?: string[] };
// Structured, bold-formatted head-to-head narrative (group_compare_cli). Bold
// spans are marked with **double asterisks** for the UI to render as <strong>.
type Comparison = { headline: string; keyPoints: string[]; recommendation?: string };

// Cross-scheme fairness matrix (recruiter.fairness_check): each candidate carries
// a bounded dynamic weight vector, and every candidate is re-scored under EVERY
// scheme so a pool with different weightings ranks honestly (by the mean) instead
// of on one scalar from incomparable yardsticks. labels/candidateIds/schemes/own/
// mean are aligned by index; weightNotes is keyed by candidateId.
type FairnessScheme = { skills: number; career: number; personal: number };
type Fairness = {
  labels: string[];
  candidateIds: string[];
  schemes: FairnessScheme[];
  matrix: number[][];
  own: number[];
  mean: number[];
  ranking: string[];
  weightNotes: Record<string, string[]>;
  // Whether the per-candidate weights were proposed by the LLM ("llm") or the
  // deterministic relevance rule ("deterministic").
  weightSource?: string;
};

// One row of the weight-aware breakdown (matching.build_score_breakdown), all on
// a single 0-100 scale — mirrors app/features/sub_match/MatchTypes.ScoreDimension.
type ScoreDimension = { key: string; label: string; percent: number; weight: number; contribution: number };
type Confidence = { low: number; high: number; level: string; drivers: string[] };
// A candidate's own salary expectation, lifted from their saved CV analysis
// (analysis.salary). Best-effort: absent for v2 profiles / candidates with no
// analysis, in which case the modal just shows the role band for them.
type SalaryExpectation = { minimum: number; maximum: number; midpoint: number; currency: string; confidence: string };
// Full per-candidate MatchResult as emitted by recruiter_cli (model_dump by alias).
type CandResult = {
  total: number;
  fitTier?: "strong" | "promising" | "partial";
  confidence?: Confidence;
  scoreBreakdown?: ScoreDimension[];
  matchedSkills?: string[];
  matchedSkillProvenance?: Record<string, string>;
  matchedSkillStrength?: Record<string, number>;
  missingSkills?: string[];
  skillsScore?: number;
  careerScore?: number;
  personalScore?: number;
};
type RecruiterRow = {
  candidateId: string;
  label: string;
  archetype: string;
  seniority: string;
  potentialScore?: number | null;
  koPassed: boolean;
  koReasons: string[];
  assumptions: string[];
  result: CandResult;
};

type PerCandidate = {
  label: string;
  score: number;
  seniority: string | null;
  archetype: string | null;
  topSkills: string[];
  verdict: string;
  strengths: string[];
  gaps: string[];
  interviewProbes: string[];
  // Enriched scoring (present when the role has a job and recruiter_cli ran).
  fitTier?: "strong" | "promising" | "partial";
  confidence?: Confidence;
  scoreBreakdown?: ScoreDimension[];
  matchedSkills?: string[];
  matchedSkillProvenance?: Record<string, string>;
  matchedSkillStrength?: Record<string, number>;
  missingSkills?: string[];
  potentialScore?: number | null;
  koPassed?: boolean;
  assumptions?: string[];
  salaryExpectation?: SalaryExpectation | null;
};

// Best-effort salary expectation from a candidate's saved CV analysis. Returns
// null for profile-only candidates or analyses with no salary section, so the
// salary comparison degrades to "role band only" rather than breaking.
function salaryExpectationOf(candidateId: string | null): SalaryExpectation | null {
  if (!candidateId) return null;
  const loaded = loadAnalysis(candidateId);
  const s = (loaded?.payload as { salary?: Partial<SalaryExpectation> } | null)?.salary;
  if (!s || !((s.minimum ?? 0) > 0 || (s.maximum ?? 0) > 0)) return null;
  return {
    minimum: s.minimum ?? 0,
    maximum: s.maximum ?? 0,
    midpoint: s.midpoint ?? Math.round(((s.minimum ?? 0) + (s.maximum ?? 0)) / 2),
    currency: s.currency ?? "CZK",
    confidence: s.confidence ?? "medium",
  };
}

function topSkillsOf(payload: unknown): string[] {
  const claims = (payload as { skillClaims?: { skill?: string; level?: string }[] } | null)?.skillClaims ?? [];
  return claims
    .slice()
    .sort((a, b) => (a.level === "strong" ? -1 : 0) - (b.level === "strong" ? -1 : 0))
    .map((c) => c.skill)
    .filter((s): s is string => Boolean(s))
    .slice(0, 6);
}

const dimPercent = (c: PerCandidate, key: string): number | null =>
  c.scoreBreakdown?.find((d) => d.key === key)?.percent ?? null;

// Flatten the structured comparison to a plain (bold-stripped) string, kept as a
// legacy `comparisonSummary` field for any consumer that reads the one-liner.
const flattenComparison = (c: Comparison): string =>
  [c.headline, ...c.keyPoints, c.recommendation ?? ""].filter(Boolean).join(" ").replace(/\*\*/g, "");

// Rank the role's candidates against the role's job via the recruiter ranker
// (ONE Python process for the whole field) to get the full MatchResult breakdown
// per candidate. Best-effort: any failure returns an empty map and the eval
// degrades to the score-only view, so a broken ranker never blocks a decision.
async function rankCandidates(
  job: JobRecord,
  candidates: GroupEvalCandidate[]
): Promise<{ rows: Map<string, RecruiterRow>; fairness: Fairness | null }> {
  const pool = candidates
    .map((c) => (c.candidateId ? resolveCandidatePoolEntry(c.candidateId, c.label) : null))
    .filter((e): e is CandidatePoolEntry => e !== null);
  if (pool.length === 0) return { rows: new Map(), fairness: null };

  let workdir: string | null = null;
  try {
    workdir = await createWorkdir();
    const inputPath = path.join(workdir, "recruiter.json");
    await writeFile(inputPath, JSON.stringify({ jobId: job.id, candidates: pool }), "utf-8");
    const jobPath = path.join(workdir, "job.json");
    await writeFile(jobPath, JSON.stringify(job), "utf-8");

    // --weights-llm: the group eval opts into the LLM weight proposer for the
    // fairness matrix (the candidate-list endpoint omits it and stays deterministic).
    const { result } = spawnPython(["-m", "pipeline.jobfit.recruiter_cli", "--input-json", inputPath, "--job-json", jobPath, "--weights-llm"]);
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      throw new Error(err.message);
    }
    const parsed = parsePythonJson<{ candidates?: RecruiterRow[]; fairness?: Fairness | null }>(stdout, stderr);
    const map = new Map<string, RecruiterRow>();
    for (const row of parsed.candidates ?? []) map.set(row.candidateId, row);
    return { rows: map, fairness: parsed.fairness ?? null };
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}

// AI "compare all" narrative across the ranked field (ONE Python process), with a
// deterministic synthesis as the fallback. Returns null on failure so the caller
// keeps the deterministic one-line `summary`.
async function runGroupCompare(
  roleTitle: string,
  candidates: PerCandidate[],
  roleSalaryBand: number[],
): Promise<{ comparison: Comparison; source: string } | null> {
  let workdir: string | null = null;
  try {
    workdir = await createWorkdir();
    const context = {
      roleTitle,
      // The role's recommended band so the AI can weigh budget fit per candidate.
      roleSalaryBand: roleSalaryBand.length >= 2 ? roleSalaryBand.slice(0, 2) : null,
      candidates: candidates.map((c) => ({
        label: c.label,
        archetype: c.archetype,
        seniority: c.seniority,
        total: c.score,
        skills: dimPercent(c, "skills"),
        career: dimPercent(c, "career"),
        personal: dimPercent(c, "personal"),
        matchedSkills: c.matchedSkills ?? [],
        missingSkills: c.missingSkills ?? [],
        verdict: c.verdict,
        potentialScore: c.potentialScore ?? null,
        // Candidate's own salary expectation (midpoint) so the narrative can flag
        // an over/under-budget candidate alongside fit.
        salaryExpectation: c.salaryExpectation ? c.salaryExpectation.midpoint : null,
      })),
    };
    const inputPath = path.join(workdir, "compare.json");
    await writeFile(inputPath, JSON.stringify(context), "utf-8");

    const { result } = spawnPython(["-m", "pipeline.jobfit.group_compare_cli", "--input-json", inputPath]);
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      throw new Error(err.message);
    }
    const parsed = parsePythonJson<{ comparison?: Comparison; source?: string }>(stdout, stderr);
    if (!parsed.comparison?.headline) return null;
    return { comparison: parsed.comparison, source: parsed.source ?? "deterministic" };
  } catch (error) {
    console.warn(`[group-eval] compare summary failed for "${roleTitle}":`, error instanceof Error ? error.message : error);
    return null;
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}

export async function runGroupEval(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const roleKey = String(params.roleKey ?? "");
  const roleTitle = (params.roleTitle as string) ?? "the role";
  const jobId = params.jobId ? String(params.jobId) : null;
  const allCandidates = (params.candidates as GroupEvalCandidate[]) ?? [];
  const totalCandidates = allCandidates.length;
  // Sort by fit BEFORE applying the cap so the strongest candidates are always
  // the ones compared — never an arbitrary insertion-order subset. The recommended
  // lead/ranking is presented as authoritative, so dropping the best candidate by
  // list order would be a correctness + trust bug.
  const input = [...allCandidates]
    .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))
    .slice(0, GROUP_EVAL_CAP);

  // Full deterministic breakdown per candidate (best-effort; needs the role's job).
  const job = jobId ? getJob(jobId) : null;
  let rows = new Map<string, RecruiterRow>();
  let fairness: Fairness | null = null;
  if (job) {
    try {
      const ranked = await rankCandidates(job, input);
      rows = ranked.rows;
      fairness = ranked.fairness;
    } catch (error) {
      console.warn(`[group-eval] recruiter ranking failed for "${roleKey}":`, error instanceof Error ? error.message : error);
    }
  }

  const sources: string[] = [];
  const candidates: PerCandidate[] = [];
  for (const c of input) {
    const rec = c.candidateId ? getProfileRecord(c.candidateId) : null;
    const payload = rec?.payload as { seniority?: string; archetype?: string } | null;
    const row = c.candidateId ? rows.get(c.candidateId) ?? null : null;
    const result = row?.result;
    let reasoning: Reasoning = {};
    if (jobId && c.candidateId) {
      try {
        const out = await runReasoning({ jobId, profileId: c.candidateId });
        reasoning = (out.reasoning as Reasoning) ?? {};
        sources.push(String(out.source ?? "deterministic"));
      } catch {
        sources.push("deterministic");
      }
    }
    candidates.push({
      label: c.label,
      // Prefer the fresh recruiter total (matches the breakdown shown) over the
      // stored matchScore, falling back to it when the role has no job.
      score: result?.total ?? c.matchScore ?? 0,
      seniority: row?.seniority ?? payload?.seniority ?? null,
      archetype: row?.archetype ?? payload?.archetype ?? null,
      topSkills: topSkillsOf(rec?.payload),
      verdict: reasoning.verdict ?? "",
      strengths: reasoning.strengths ?? [],
      gaps: reasoning.gaps ?? [],
      interviewProbes: reasoning.interviewProbes ?? [],
      fitTier: result?.fitTier,
      confidence: result?.confidence,
      scoreBreakdown: result?.scoreBreakdown,
      matchedSkills: result?.matchedSkills,
      matchedSkillProvenance: result?.matchedSkillProvenance,
      matchedSkillStrength: result?.matchedSkillStrength,
      missingSkills: result?.missingSkills,
      potentialScore: row?.potentialScore ?? null,
      koPassed: row?.koPassed,
      assumptions: row?.assumptions ?? [],
      salaryExpectation: salaryExpectationOf(c.candidateId),
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0] ?? null;

  // Differentiators: skills the top pick has that no one else in the group does.
  const othersSkills = new Set(candidates.slice(1).flatMap((c) => c.topSkills));
  const differentiators = top ? top.topSkills.filter((s) => !othersSkills.has(s)).slice(0, 5) : [];

  const risks: string[] = [];
  for (const c of candidates) {
    if (c.score > 0 && c.score < 55) risks.push(`${c.label}: lower fit (${c.score}) — confirm must-haves at interview.`);
    if (isEarlyCareer(c.archetype)) risks.push(`${c.label}: early-career — assess potential and trajectory, not only current skills.`);
    if (c.gaps.length) risks.push(`${c.label}: gaps in ${c.gaps.slice(0, 3).join(", ")}.`);
  }

  const uniqueSources = new Set(sources.filter(Boolean));
  const source = uniqueSources.size === 0 ? "deterministic" : uniqueSources.size === 1 && uniqueSources.has("llm") ? "llm" : uniqueSources.has("llm") ? "partial" : "deterministic";

  // Canonical skill-matrix rows: the role's declared requirements (must-have
  // first), so the matrix is ordered and complete even for a skill no candidate
  // matched. The modal falls back to the union of matched∪missing when absent.
  const requirements = (job?.requirements ?? []).map((r) => ({ skill: r.skill, kind: r.kind }));

  // AI head-to-head narrative (best-effort; deterministic one-liner is the fallback).
  const compare = candidates.length ? await runGroupCompare(roleTitle, candidates, job?.salaryBand ?? []) : null;

  const deterministicSummary = top
    ? `${candidates.length} candidate(s) for ${roleTitle}. Recommended lead: ${top.label} (fit ${top.score}). ${
        differentiators.length ? `Unique strengths: ${differentiators.join(", ")}. ` : ""
      }${risks.length ? `${risks.length} watch-out(s) flagged below.` : "No blocking risks flagged."}`
    : `No candidates to evaluate for ${roleTitle}.`;

  const payload: Record<string, unknown> = {
    roleTitle,
    jobId,
    source,
    candidateCount: candidates.length,
    // Coverage bookkeeping so the modal can show "top N of M" instead of letting a
    // capped comparison read as full coverage, and diff the pool for staleness.
    totalCandidates,
    cap: GROUP_EVAL_CAP,
    capped: totalCandidates > GROUP_EVAL_CAP,
    // Every candidate label considered at eval time (pre-cap) — the modal diffs
    // this against the role's current pending entries to warn about pool drift.
    evaluatedLabels: allCandidates.map((c) => c.label),
    topPick: top ? { label: top.label, score: top.score, why: top.verdict || `Highest fit (${top.score}) in this role.` } : null,
    recommendedOrder: candidates.map((c) => c.label),
    candidates,
    differentiators,
    risks,
    // Canonical role requirements for the skills matrix (may be empty for a
    // job-less role).
    requirements,
    // The role's recommended salary band [min, max] (job.salaryBand) — the
    // reference each candidate's expectation is compared against. Empty for a
    // job-less role, in which case the salary section just shows expectations.
    roleSalaryBand: job?.salaryBand ?? [],
    // Cross-scheme fairness matrix: each candidate re-scored under every
    // candidate's bounded dynamic weighting, so a pool weighted differently per
    // candidate ranks honestly. Null for a job-less role or if the ranker failed.
    fairness,
    summary: deterministicSummary,
    // Structured, bold-formatted AI comparison (the modal prefers it); the flat
    // `comparisonSummary` stays for legacy/plain-text consumers.
    comparison: compare?.comparison ?? null,
    comparisonSummary: compare ? flattenComparison(compare.comparison) : null,
    comparisonSource: compare?.source ?? null,
  };

  saveGroupEval(roleKey, roleTitle, payload);
  return payload;
}
