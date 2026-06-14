import { writeFile } from "node:fs/promises";
import path from "node:path";
import { getJob, getProfileRecord, loadAnalysis, type JobRecord } from "./db";
import { runReasoning } from "./reasoning-run";
import { saveGroupEval } from "./group-eval";
import { isEarlyCareer } from "./archetypes";
import { APP_CURRENCY } from "./format";
import { isSameCurrency } from "./salary-band";
import { poolEntryFromAnalysis, type CandidatePoolEntry } from "./candidate-pool";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, spawnPython } from "./python-runner";
import { rankPoolForJob } from "./recruiter-run";
import { computeDifferentiators } from "./group-eval-differentiators";
import { sealDecisionSafe } from "./decision-record-store";
import type { MatchResultView, ScoreDimension, Confidence, Reasoning as CanonicalReasoning } from "@/app/features/sub_match/MatchTypes";
import type { Comparison, Fairness, FairnessScheme } from "@/app/features/sub_decisions/group-eval/types";

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
// The all-optional adapter for runReasoning's loosely-typed output, parsed before
// the per-field defaulting below. Single-sourced as Partial<> of the canonical
// MatchTypes.Reasoning so its field set provably tracks that type (minus
// optionality) instead of being a hand-copied union that can silently drift.
type Reasoning = Partial<CanonicalReasoning>;
// Comparison / FairnessScheme / Fairness are the persisted group-eval wire
// contract — single-sourced from the client modal's group-eval/types.ts (imported
// above) so the server producer and the client consumer can never drift.
// ScoreDimension / Confidence are single-sourced from MatchTypes (imported above).
// A candidate's own salary expectation, lifted from their saved CV analysis
// (analysis.salary). Best-effort: absent for v2 profiles / candidates with no
// analysis, in which case the modal just shows the role band for them.
type SalaryExpectation = { minimum: number; maximum: number; midpoint: number; currency: string; confidence: string };
// Full per-candidate MatchResult as emitted by recruiter_cli (model_dump by alias):
// the shared 8-field recruiter view (MatchResultView, single-sourced from MatchTypes)
// plus the three raw dimension scores recruiter_cli also emits.
type CandResult = MatchResultView & {
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
  // SCOR3 — the why behind potentialScore (recruiter.py rows).
  learningSignals?: string[] | null;
  transferableSkills?: string[] | null;
  domainDistance?: string | null;
  koPassed: boolean;
  koReasons: string[];
  assumptions: string[];
  result: CandResult;
};

type PerCandidate = {
  // Stable pipeline-entry id, so the Decisions modal can resolve an inline advance/reject
  // back to the exact live entry by id (not by the non-unique display label).
  entryId: string;
  label: string;
  score: number;
  seniority: string | null;
  archetype: string | null;
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
  // SCOR3 — passthrough of the potential explanation, so the modal's pill can
  // explain the score. Absent on evals persisted before the fields existed.
  learningSignals?: string[] | null;
  transferableSkills?: string[] | null;
  domainDistance?: string | null;
  koPassed?: boolean;
  assumptions?: string[];
  salaryExpectation?: SalaryExpectation | null;
};

// One up-front resolution of a candidate's stored rows (idea-c7c2d014): the
// pool entry for rankCandidates, the archetype/seniority payload read, and the
// salary expectation each used to re-read the same rows through separate helper
// paths (resolveCandidatePoolEntry + getProfileRecord + loadAnalysis-per-call) —
// ~3x duplicated single-row reads AND payload JSON.parse work per candidate.
// Resolving once also means all three consumers provably see the SAME snapshot.
type ResolvedCandidate = {
  profile: ReturnType<typeof getProfileRecord>;
  analysis: ReturnType<typeof loadAnalysis>;
};

function resolveCandidates(input: GroupEvalCandidate[]): Map<string, ResolvedCandidate> {
  const resolved = new Map<string, ResolvedCandidate>();
  for (const c of input) {
    if (!c.candidateId || resolved.has(c.candidateId)) continue;
    // The analysis doubles as the pool fallback AND the salary source, so it is
    // loaded for everyone; profile-only candidates simply carry null.
    resolved.set(c.candidateId, { profile: getProfileRecord(c.candidateId), analysis: loadAnalysis(c.candidateId) });
  }
  return resolved;
}

/** The recruiter-pool entry for one resolved candidate (profile first, analysis
 *  fallback) — mirrors candidate-pool.resolveCandidatePoolEntry over the shared
 *  snapshot instead of re-reading the DB. */
function poolEntryOf(candidateId: string, label: string, r: ResolvedCandidate | undefined): CandidatePoolEntry | null {
  if (!r) return null;
  if (r.profile) return { id: candidateId, label, profile: r.profile.payload };
  if (r.analysis) return poolEntryFromAnalysis(candidateId, label, r.analysis.payload);
  return null;
}

// Best-effort salary expectation from a candidate's saved CV analysis. Returns
// null for profile-only candidates or analyses with no salary section, so the
// salary comparison degrades to "role band only" rather than breaking.
function salaryExpectationFrom(loaded: ReturnType<typeof loadAnalysis>): SalaryExpectation | null {
  const s = (loaded?.payload as { salary?: Partial<SalaryExpectation> } | null)?.salary;
  if (!s || !((s.minimum ?? 0) > 0 || (s.maximum ?? 0) > 0)) return null;
  return {
    minimum: s.minimum ?? 0,
    maximum: s.maximum ?? 0,
    midpoint: s.midpoint ?? Math.round(((s.minimum ?? 0) + (s.maximum ?? 0)) / 2),
    // An absent currency is assumed to be the app currency (the band's denomination),
    // so a currency-less expectation still compares against the role band.
    currency: s.currency ?? APP_CURRENCY,
    confidence: s.confidence ?? "medium",
  };
}

const dimPercent = (c: PerCandidate, key: string): number | null =>
  c.scoreBreakdown?.find((d) => d.key === key)?.percent ?? null;

// Rank the role's candidates against the role's job via the recruiter ranker
// (ONE Python process for the whole field) to get the full MatchResult breakdown
// per candidate. Best-effort: any failure returns an empty map and the eval
// degrades to the score-only view, so a broken ranker never blocks a decision.
async function rankCandidates(
  job: JobRecord,
  pool: CandidatePoolEntry[],
  signal?: AbortSignal
): Promise<{ rows: Map<string, RecruiterRow>; fairness: Fairness | null }> {
  if (pool.length === 0) return { rows: new Map(), fairness: null };

  // --weights-llm + --embeddings: the group eval is the deep read, so it opts
  // into BOTH enrichments — the LLM weight proposer for the fairness matrix and
  // the embedding bridge for the personal/motivation dimension. Each fails open
  // to its deterministic twin (no key/provider → unchanged scores), and the
  // cheap candidate-list endpoint omits both and stays fully deterministic.
  const parsed = await rankPoolForJob<{ candidates?: RecruiterRow[]; fairness?: Fairness | null }>(
    job.id,
    pool,
    job,
    { signal, weightsLlm: true, embeddings: true },
  );
  const map = new Map<string, RecruiterRow>();
  for (const row of parsed.candidates ?? []) map.set(row.candidateId, row);
  return { rows: map, fairness: parsed.fairness ?? null };
}

// AI "compare all" narrative across the ranked field (ONE Python process), with a
// deterministic synthesis as the fallback. Returns null on failure so the caller
// keeps the deterministic one-line `summary`.
async function runGroupCompare(
  roleTitle: string,
  candidates: PerCandidate[],
  roleSalaryBand: number[],
  signal?: AbortSignal,
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
        // an over/under-budget candidate alongside fit — but ONLY when it shares the
        // band's currency. roleSalaryBand is in APP_CURRENCY and the app does no FX,
        // so handing the LLM a cross-currency number (a EUR expectation against a CZK
        // band) would let it assert a false "over/under budget" claim; on a mismatch
        // we withhold the number so it can't compare incomparable figures.
        salaryExpectation:
          c.salaryExpectation && isSameCurrency(c.salaryExpectation.currency, APP_CURRENCY)
            ? c.salaryExpectation.midpoint
            : null,
      })),
    };
    const inputPath = path.join(workdir, "compare.json");
    await writeFile(inputPath, JSON.stringify(context), "utf-8");

    const { result } = spawnPython(["-m", "pipeline.jobfit.group_compare_cli", "--input-json", inputPath], { signal });
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

export async function runGroupEval(params: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const roleKey = String(params.roleKey ?? "");
  const roleTitle = (params.roleTitle as string) ?? "the role";
  const jobId = params.jobId ? String(params.jobId) : null;
  const allCandidates = (params.candidates as GroupEvalCandidate[]) ?? [];
  const totalCandidates = allCandidates.length;
  // Sort by fit BEFORE applying the cap so the strongest candidates are always
  // the ones compared — never an arbitrary insertion-order subset. The recommended
  // lead/ranking is presented as authoritative, so dropping the best candidate by
  // list order would be a correctness + trust bug.
  // Dedupe by stable identity BEFORE the cap. Two pipeline entries for the SAME person
  // (same candidateId — re-added/duplicated into one role) would otherwise each consume a
  // GROUP_EVAL_CAP slot, emit duplicate comparison columns, double-count in the lead/order
  // and risks, and evict a genuine candidate past the cap — while resolveCandidates and
  // rankCandidates (keyed by candidateId) silently collapse the pair downstream. Identity
  // is candidateId when present, else the always-unique entryId. Label stays display-only.
  const seenIdentity = new Set<string>();
  const input = [...allCandidates]
    .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))
    .filter((c) => {
      const identity = c.candidateId || c.entryId;
      if (seenIdentity.has(identity)) return false;
      seenIdentity.add(identity);
      return true;
    })
    .slice(0, GROUP_EVAL_CAP);

  // Resolve every candidate's stored rows ONCE; rankCandidates, the payload
  // read and the salary expectation below all share this snapshot (idea-c7c2d014).
  const resolved = resolveCandidates(input);

  // Full deterministic breakdown per candidate (best-effort; needs the role's job).
  const job = jobId ? getJob(jobId) : null;
  let rows = new Map<string, RecruiterRow>();
  let fairness: Fairness | null = null;
  if (job) {
    try {
      const pool = input
        .map((c) => (c.candidateId ? poolEntryOf(c.candidateId, c.label, resolved.get(c.candidateId)) : null))
        .filter((e): e is CandidatePoolEntry => e !== null);
      const ranked = await rankCandidates(job, pool, signal);
      rows = ranked.rows;
      fairness = ranked.fairness;
    } catch (error) {
      console.warn(`[group-eval] recruiter ranking failed for "${roleKey}":`, error instanceof Error ? error.message : error);
    }
  }

  // Per-candidate AI reasoning, CONCURRENTLY (idea-bce9547b): this used to be a
  // sequential `await runReasoning(...)` per candidate — on cache misses, up to
  // GROUP_EVAL_CAP=6 cold Python spawns run strictly serially behind the modal
  // spinner, making group eval ~6x one reasoning round-trip in wall time. The
  // calls are independent (own workdir, own process, per-candidate cache slot),
  // so they run in parallel; the field is already capped at 6, which is the
  // concurrency bound. Per-candidate failures degrade to the deterministic
  // source exactly as before.
  const reasonings = await Promise.all(
    input.map(async (c): Promise<{ reasoning: Reasoning; source: string | null }> => {
      if (!jobId || !c.candidateId) return { reasoning: {}, source: null };
      try {
        const out = await runReasoning({ jobId, profileId: c.candidateId }, signal);
        return { reasoning: (out.reasoning as Reasoning) ?? {}, source: String(out.source ?? "deterministic") };
      } catch {
        return { reasoning: {}, source: "deterministic" };
      }
    })
  );

  const sources: string[] = [];
  const candidates: PerCandidate[] = [];
  for (const [idx, c] of input.entries()) {
    const rec = c.candidateId ? resolved.get(c.candidateId)?.profile ?? null : null;
    const payload = rec?.payload as { seniority?: string; archetype?: string } | null;
    const row = c.candidateId ? rows.get(c.candidateId) ?? null : null;
    const result = row?.result;
    const { reasoning, source } = reasonings[idx];
    if (source !== null) sources.push(source);
    candidates.push({
      entryId: c.entryId,
      label: c.label,
      // Prefer the fresh recruiter total (matches the breakdown shown) over the
      // stored matchScore, falling back to it when the role has no job.
      score: result?.total ?? c.matchScore ?? 0,
      seniority: row?.seniority ?? payload?.seniority ?? null,
      archetype: row?.archetype ?? payload?.archetype ?? null,
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
      learningSignals: row?.learningSignals ?? null,
      transferableSkills: row?.transferableSkills ?? null,
      domainDistance: row?.domainDistance ?? null,
      koPassed: row?.koPassed,
      assumptions: row?.assumptions ?? [],
      salaryExpectation: c.candidateId ? salaryExpectationFrom(resolved.get(c.candidateId)?.analysis ?? null) : null,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0] ?? null;

  // Canonical role requirements (must-have first): the role's declared
  // requirements, so the skills matrix is ordered and complete even for a skill no
  // candidate matched, AND the anchor the lead's differentiators are filtered to.
  // The modal falls back to the union of matched∪missing when this is absent.
  const requirements = (job?.requirements ?? []).map((r) => ({ skill: r.skill, kind: r.kind }));

  // Differentiators: the lead's *role-relevant* edge — requirement skills the lead
  // matched that every rival missed (NOT raw self-declared claims, which could be
  // off-topic). See computeDifferentiators for the full definition and rationale.
  const differentiators = computeDifferentiators(top, candidates.slice(1), requirements);

  const risks: string[] = [];
  for (const c of candidates) {
    if (c.score > 0 && c.score < 55) risks.push(`${c.label}: lower fit (${c.score}) — confirm must-haves at interview.`);
    if (isEarlyCareer(c.archetype)) risks.push(`${c.label}: early-career — assess potential and trajectory, not only current skills.`);
    if (c.gaps.length) risks.push(`${c.label}: gaps in ${c.gaps.slice(0, 3).join(", ")}.`);
  }

  const uniqueSources = new Set(sources.filter(Boolean));
  const source = uniqueSources.size === 0 ? "deterministic" : uniqueSources.size === 1 && uniqueSources.has("llm") ? "llm" : uniqueSources.has("llm") ? "partial" : "deterministic";

  // AI head-to-head narrative (best-effort; deterministic one-liner is the fallback).
  const compare = candidates.length ? await runGroupCompare(roleTitle, candidates, job?.salaryBand ?? [], signal) : null;

  const deterministicSummary = top
    ? `${candidates.length} candidate(s) for ${roleTitle}. Recommended lead: ${top.label} (fit ${top.score}). ${
        differentiators.length ? `Unique strengths: ${differentiators.join(", ")}. ` : ""
      }${risks.length ? `${risks.length} watch-out(s) flagged below.` : "No blocking risks flagged."}`
    : `No candidates to evaluate for ${roleTitle}.`;

  // Decision SoR (moonshot D backfill): seal the AI's recommended lead — the
  // group-eval recommendation a recruiter acts on, with the eval source as the
  // policy version. Best-effort; this is the real (non-sim) eval path — the sim has
  // its own client-side runGroupEval. Skipped when there's no candidate.
  if (top) {
    sealDecisionSafe({
      kind: "group_eval_lead",
      actor: "auto:group-eval",
      policyVersion: source,
      candidateRef: top.entryId,
      rationale: deterministicSummary,
      reasonCode: "lead",
      inputs: { score: top.score, candidates: candidates.length, roleTitle },
    });
  }

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
    // The role's recommended salary band [min, max] (job.salaryBand), denominated
    // in APP_CURRENCY by contract — the reference each candidate's expectation is
    // compared against, but ONLY when the expectation shares that currency (the
    // modal gates the over/under verdict on a match; the app does no FX). Empty for
    // a job-less role, in which case the salary section just shows expectations.
    roleSalaryBand: job?.salaryBand ?? [],
    // Cross-scheme fairness matrix: each candidate re-scored under every
    // candidate's bounded dynamic weighting, so a pool weighted differently per
    // candidate ranks honestly. Null for a job-less role or if the ranker failed.
    fairness,
    summary: deterministicSummary,
    // Structured, bold-formatted AI comparison (the modal prefers it).
    comparison: compare?.comparison ?? null,
    comparisonSource: compare?.source ?? null,
  };

  saveGroupEval(roleKey, roleTitle, payload);
  return payload;
}
