import { writeFile } from "node:fs/promises";
import path from "node:path";
import { loadAnalysis } from "./db/analyses";
import type { JobRecord } from "./db/core";
import { getJob } from "./db/jobs";
import { recordAutomationEvent } from "./db/pipeline";
import { getProfileRecord } from "./db/profiles";
import { DEFAULT_WORKSPACE_ID, getWorkspaceDefaultLocale } from "./db/workspaces";
import { runReasoning } from "./reasoning-run";
import { getGroupEval, saveGroupEval } from "./group-eval";
import { isEarlyCareer } from "./archetypes";
import { APP_CURRENCY } from "./format";
import { isSameCurrency } from "./salary-band";
import { FIT_PROMISING_FLOOR } from "./fit-thresholds";
import { poolEntryFromAnalysis, type CandidatePoolEntry } from "./candidate-pool";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, spawnPython } from "./python-runner";
import { buildLlmConfigEnv } from "./llm-config";
import { rankPoolForJob } from "./recruiter-run";
import { computeDifferentiators } from "./group-eval-differentiators";
import { eligibleRunnerUp, leadSeparation, separationNote } from "./group-eval-separation";
import { fairnessCoversCohort, hasComparableCohort, partitionCohortByConsent, GROUP_EVAL_CAP, GROUP_EVAL_MIN_COHORT } from "./group-eval-cohort";
import { suppressedCandidateIds } from "./rediscovery-alert-store";
import { compareByMatchScoreDesc, compareScoreDesc } from "./match-score";
import { sealDecisionSafe } from "./decision-record-store";
import { buildEligibilityList, governanceNote, normalizeGovernanceMode, resolveGovernanceMode, sealsLead } from "./group-eval-governance";
import type { MatchResultView, ScoreDimension, Confidence, Reasoning as CanonicalReasoning } from "@/app/features/shared/matchTypes";
import type { Comparison, Fairness, FairnessScheme, RiskFact, RobustnessStatus, SummaryFacts } from "@/app/features/shared/groupEvalTypes";
import { selectionCacheKey } from "@/app/features/hiring/decisions/groupEval/cache-key";
import { assessRobustness } from "@/app/features/shared/groupEvalTypes";

// Cap on how many candidates one comparative evaluation covers (GROUP_EVAL_CAP,
// single-sourced from group-eval-cohort so the client selection UI shares it). The
// strongest are selected by fit BEFORE the cap (see below), and the modal surfaces
// "top N of M" so a bounded comparison never reads as full coverage.

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
  // recruiter.fairness_track — "early_career" | "experienced".
  track?: string | null;
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
  // The fit number the comparison ranks and displays: the fresh recruiter total
  // when the ranker ran, else the stored entry matchScore, else null — an
  // UNSCORED candidate stays null (REC-03: never a fabricated 0 that ranks,
  // displays, and seals as a genuine measurement).
  score: number | null;
  seniority: string | null;
  archetype: string | null;
  // FAIRNESS TRACK (recruiter.fairness_track). An early-career candidate's `career`
  // dimension scores POTENTIAL (readiness); an experienced candidate's scores
  // work-history fit — "two incomparable 0-100 scales … they must never be ranked
  // against each other on one total" (pipeline/jobfit/recruiter.py). The ranker
  // computes the track on every row precisely so a consumer can GROUP by it; it used
  // to be dropped here, leaving the persisted eval with no way to express the contract
  // at all. Carried per candidate so the modal (and any CSV/API reader) can split the
  // field or disclose that it is mixed. null = no archetype was ever detected, so the
  // track is unknown — never silently asserted as "experienced".
  track: "early_career" | "experienced" | null;
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

function resolveCandidates(input: GroupEvalCandidate[], workspaceId: string): Map<string, ResolvedCandidate> {
  const resolved = new Map<string, ResolvedCandidate>();
  for (const c of input) {
    if (!c.candidateId || resolved.has(c.candidateId)) continue;
    // The analysis doubles as the pool fallback AND the salary source, so it is
    // loaded for everyone; profile-only candidates simply carry null. Both reads
    // are scoped to the caller's team so the eval never composes from another
    // tenant's profile/analysis rows.
    resolved.set(c.candidateId, { profile: getProfileRecord(c.candidateId, workspaceId), analysis: loadAnalysis(c.candidateId, workspaceId) });
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

/** The candidate's fairness track for the persisted eval (see PerCandidate.track).
 *  Prefers the value the ranker stamped on the row; falls back to the SAME rule
 *  recruiter.fairness_track applies (archetype ∈ early-career set) when no ranker row
 *  exists — a job-less role, or a candidate the pool could not resolve — so the field
 *  is populated for the whole compared field, not only the ranked part. An unroutable
 *  candidate (no archetype at all) stays null rather than defaulting into a track. */
export function fairnessTrackOf(
  rowTrack: string | null | undefined,
  archetype: string | null | undefined
): "early_career" | "experienced" | null {
  if (rowTrack === "early_career" || rowTrack === "experienced") return rowTrack;
  if (!archetype) return null;
  return isEarlyCareer(archetype) ? "early_career" : "experienced";
}

// ---- Per-stage deadlines ----------------------------------------------------
//
// One group evaluation fans out to up to EIGHT Python processes: the recruiter
// ranker (with --weights-llm and --embeddings, so two provider round-trips inside
// one child), the `group_compare_cli` narrative, and up to GROUP_EVAL_CAP=6
// concurrent per-candidate reasoning runs. Not one of them carried a deadline, so
// every stage inherited python-runner's DEFAULT_TIMEOUT_MS — a 10-minute HANG
// BACKSTOP, explicitly "not a deadline". A provider stalling mid-stream therefore
// parked the modal's spinner (and a background task slot) for ten minutes before
// falling back to the deterministic result it could have produced in seconds.
//
// These are the deadlines, stated per stage and sized to what the stage actually
// does. Every one of them fails SOFT into the deterministic twin the stage already
// has — that is the property that makes a deadline safe here: passing it costs
// fidelity, never the result. `KP_GROUP_EVAL_STAGE_TIMEOUT_MS` overrides all three
// (an operator knob for a slow self-hosted provider, and how the tests drive the
// timeout path).
const STAGE_TIMEOUT_OVERRIDE_MS = Number(process.env.KP_GROUP_EVAL_STAGE_TIMEOUT_MS);
function stageTimeoutMs(fallback: number): number {
  return Number.isFinite(STAGE_TIMEOUT_OVERRIDE_MS) && STAGE_TIMEOUT_OVERRIDE_MS > 0
    ? STAGE_TIMEOUT_OVERRIDE_MS
    : fallback;
}
/** Ranking: one child, but TWO enrichments inside it (LLM weight proposal +
 *  embeddings) over a field of up to six. The most expensive stage, so the
 *  longest deadline. */
export const GROUP_EVAL_RANK_TIMEOUT_MS = 240_000;
/** The comparison narrative: one prompt over an already-scored field. */
export const GROUP_EVAL_COMPARE_TIMEOUT_MS = 150_000;
/** Per-candidate reasoning: six of these run concurrently, each one prompt. The
 *  deadline is PER CANDIDATE — a single stalled provider call degrades that
 *  candidate to the deterministic rationale without holding the other five. */
export const GROUP_EVAL_REASONING_TIMEOUT_MS = 150_000;

/**
 * The abort signal for one stage: the caller's cancellation OR this stage's own
 * deadline, whichever fires first. Returned alongside the deadline signal itself so
 * the caller can tell a TIMEOUT from an ordinary failure and disclose it honestly —
 * `AbortSignal.any` reports only that it aborted, not which input did it.
 */
export function stageSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; deadline: AbortSignal } {
  const deadline = AbortSignal.timeout(timeoutMs);
  return { signal: signal ? AbortSignal.any([signal, deadline]) : deadline, deadline };
}

/** A stage that did not produce its AI result, and why. Persisted on the payload so
 *  a degraded evaluation is legible as degraded rather than passing itself off as a
 *  full one — the same rule the comms layer follows with sent/queued/failed. */
type DegradedStage = { stage: "ranking" | "comparison" | "reasoning"; reason: "timeout" | "failed" };

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
): Promise<{ comparison: Comparison; source: string; narrativeLang: string } | null> {
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

    // The comparison narrative (headline, keyPoints, recommendation) is a shared,
    // saved eval — render it in the org's configured language. The workspace
    // default is the org language authority available in every context (this runs
    // on-demand and in the background eval pass, which has no request cookie).
    const { result } = spawnPython(
      ["-m", "pipeline.jobfit.group_compare_cli", "--input-json", inputPath, "--lang", getWorkspaceDefaultLocale()],
      // buildLlmConfigEnv: the CLI resolves the group_compare use case — without
      // this env the configured BYOM provider/key re-route is silently dead.
      // timeoutMs: this is the ONE spawn of the three this module owns directly, so
      // the deadline is enforced by python-runner itself (a SIGKILL, not just an
      // abort) rather than only through the composed signal.
      { signal, timeoutMs: stageTimeoutMs(GROUP_EVAL_COMPARE_TIMEOUT_MS), env: buildLlmConfigEnv() }
    );
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      throw new Error(err.message);
    }
    const parsed = parsePythonJson<{ comparison?: Comparison; source?: string; narrativeLang?: string }>(
      stdout,
      stderr,
    );
    if (!parsed.comparison?.headline) return null;
    // `narrativeLang` is what the ENGINE says the text is written in, not what we asked
    // for: the deterministic synthesis is English-only, so a workspace on cs/de/fr that
    // fell back gets English prose. This payload is SHARED and PERSISTED, so re-deriving
    // the language at render time from `source` (the mistake the per-match path already
    // fixed) would tell every later reader the wrong thing. Legacy CLIs that predate the
    // field say nothing, and "en" is what they in fact produced.
    return {
      comparison: parsed.comparison,
      source: parsed.source ?? "deterministic",
      narrativeLang: parsed.narrativeLang ?? "en",
    };
  } catch (error) {
    console.warn(`[group-eval] compare summary failed for "${roleTitle}":`, error instanceof Error ? error.message : error);
    return null;
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}

export async function runGroupEval(
  params: Record<string, unknown>,
  signal?: AbortSignal,
  // Tenant (P1): the workspace whose cohort this eval runs on. Threaded from the
  // task's workspaceId (tasks.ts group_eval handler), so the persisted governance
  // read, the profile/analysis reads, the per-candidate reasoning, and the saved
  // eval all resolve on the CALLER's team — never composed from default-workspace
  // data. Defaults to the single default workspace so scripts keep today's behavior.
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Promise<Record<string, unknown>> {
  const roleKey = String(params.roleKey ?? "");
  const roleTitle = (params.roleTitle as string) ?? "the role";
  const jobId = params.jobId ? String(params.jobId) : null;
  // group-eval-cohort-choice — the candidates to actually compare.
  //   • Default (no explicit selection): `params.candidates` IS the whole role
  //     cohort; the top GROUP_EVAL_CAP by fit are compared (today's behaviour,
  //     byte-identical) and `params.cohort` is absent.
  //   • Explicit selection ("compare these four"): `params.candidates` carries the
  //     recruiter's chosen subset and `params.cohort` carries the FULL role cohort.
  //     The eval runs over the selection, but every coverage / drift bookkeeping stays
  //     anchored to the full cohort so a narrowed comparison never reads as a shrunk pool.
  const rawRequested = (params.candidates as GroupEvalCandidate[]) ?? [];
  const cohortParam = params.cohort as GroupEvalCandidate[] | undefined;
  const hasSelectionParam = Array.isArray(cohortParam);
  const rawCohort = hasSelectionParam ? cohortParam! : rawRequested;
  // Consent / anonymization gate — BEFORE anything else touches the cohort.
  //
  // This is the app's most PII-dense operation: every compared member's label,
  // archetype, salary expectation and CV-derived verdict is serialized into a prompt,
  // sent to a provider, narrated, persisted into a shared row and (under
  // `recommendation` governance) sealed into a decision record. Selection consulted
  // NO consent state, so a candidate anonymized under a GDPR erasure, or one whose
  // consent to be processed had lapsed, was compared and sealed like anyone else —
  // while the very same suppression is enforced for outreach.
  //
  // suppressedCandidateIds is that shared predicate: workspace-GLOBAL (erasure is a
  // property of the person, not the team), most-restrictive across every entry an
  // identity owns, and fail-CLOSED — a broken consent read suppresses everyone, which
  // degrades this run to "insufficient sample" rather than re-materializing an erased
  // person into a model prompt. Applied to the FULL cohort and to an explicit
  // selection alike: a recruiter cannot opt a suppressed candidate back in by picking
  // them.
  const suppressed = suppressedCandidateIds(rawCohort.map((c) => c.candidateId));
  const { compared: cohort, excluded: consentExclusions } = partitionCohortByConsent(rawCohort, suppressed);
  const requested = hasSelectionParam
    ? rawRequested.filter((c) => !(c.candidateId && suppressed.has(c.candidateId.trim())))
    : cohort;
  const totalCandidates = cohort.length;
  const idOf = (c: GroupEvalCandidate) => c.candidateId || c.entryId;
  // Server-validated membership + cap: a passed selection is filtered to members that
  // actually belong to the role cohort (a client can't smuggle in a cross-role or
  // stale candidate), and the GROUP_EVAL_CAP slice below enforces the bound regardless
  // of how many ids were sent. A selection that validates to nothing (all stale /
  // cross-role) falls back to the default top-N rather than evaluating an empty field.
  const cohortIds = new Set(cohort.map(idOf));
  const validatedSelection = hasSelectionParam ? requested.filter((c) => cohortIds.has(idOf(c))) : requested;
  // selection-memory-rerun — a selection is honored only when it validates to at least a
  // head-to-head pair (GROUP_EVAL_MIN_COHORT). This matters on a Re-run that REPLAYS a
  // saved selection whose members have since left the cohort: with ≥2 survivors the eval
  // proceeds over the survivors (coverage discloses "your selection of {survivors} of
  // {total}"); with fewer than 2 it falls back to the default top-N over the full cohort
  // rather than an "insufficient sample" single-candidate selection — the more useful,
  // still-honest result, and the coverage disclosure then reads as the top-N that ran.
  // (Fresh selections are UI-gated to ≥2 — RoleDecisionRow.canCompare — so this only
  // changes the degenerate replay/bypass case, never a normal first-run selection.)
  const useSelection = hasSelectionParam && validatedSelection.length >= GROUP_EVAL_MIN_COHORT;
  const preCap = useSelection ? validatedSelection : cohort;
  // selection-rerun-cache — WHERE this run is persisted. A default top-N run keeps
  // the bare roleKey (byte-identical to before, so legacy rows and the "evaluated"
  // chip are untouched); a selection run is stored under a key that also carries a
  // deterministic hash of its sorted member ids, so reopening the IDENTICAL
  // comparison serves the cache instead of re-spawning the whole ≤8-process
  // pipeline. The client computes the same key from the same ids before it spawns
  // (DecisionsTab.openGroupEval) — see group-eval/cache-key.ts for why the key is
  // layered onto role_key rather than migrated into a new column. The ids hashed are
  // the ones the CLIENT sent (pre-cap/dedupe), because that is what the client can
  // key on at lookup time; a fallback-to-top-N run (`useSelection` false) is stored
  // under the plain roleKey exactly as it is today.
  const cacheKey = useSelection ? selectionCacheKey(roleKey, validatedSelection.map((c) => c.entryId)) : roleKey;
  // Governance mode (P1-3): "recommendation" (default — AI synthesizes + seals a
  // single lead) vs "committee" / "eligibility_list" (the AI is ADVISORY only — it
  // never seals a winner; the committee / eligibility certification is the human's).
  //
  // Resolved SERVER-SIDE from the role's PERSISTED governance, not trusted solely from
  // the per-request param (bug-ui-scan-2026-07-09 #1). The request param comes from an
  // unpersisted per-mount segmented control that resets to "recommendation" on any fresh
  // mount / different user / rerun; the role's stored eval carries the governance it was
  // last run under. resolveGovernanceMode keeps a committee/eligibility role governed so a
  // rerun whose client state reset can never silently downgrade it and auto-seal an AI lead.
  const requestedGovernanceMode = normalizeGovernanceMode(params.governanceMode);
  // Governance is a property of the ROLE, so the stickiness read stays anchored to the
  // role-level row; a selection run falls back to its own prior selection row when the
  // role has never been evaluated as a top-N (before selection-rerun-cache a selection
  // run wrote the role-level row, so this keeps governance exactly as sticky as it was).
  const priorEval = getGroupEval(roleKey, workspaceId) ?? (cacheKey !== roleKey ? getGroupEval(cacheKey, workspaceId) : null);
  const storedGovernanceMode = priorEval
    ? normalizeGovernanceMode((priorEval.payload as { governanceMode?: unknown }).governanceMode)
    : null;
  const governanceMode = resolveGovernanceMode(storedGovernanceMode, requestedGovernanceMode);
  const advisory = !sealsLead(governanceMode);
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
  // The cap-eviction sort uses the shared null-safe comparator: an UNSCORED
  // candidate sorts after every scored one (it can't claim a cap slot over a
  // measured candidate) but is never fabricated into a "score 0" — past the cap
  // it is dropped as "unranked", not as a fake bottom scorer.
  const seenIdentity = new Set<string>();
  const input = [...preCap]
    .sort(compareByMatchScoreDesc)
    .filter((c) => {
      const identity = c.candidateId || c.entryId;
      if (seenIdentity.has(identity)) return false;
      seenIdentity.add(identity);
      return true;
    })
    .slice(0, GROUP_EVAL_CAP);

  // Resolve every candidate's stored rows ONCE; rankCandidates, the payload
  // read and the salary expectation below all share this snapshot (idea-c7c2d014).
  const resolved = resolveCandidates(input, workspaceId);

  // Min-cohort floor (bug-ui-scan-2026-07-09 #4): a comparative verdict — a lead "over
  // the field", "unique" differentiators, a robust cross-scheme ranking — is meaningless
  // below GROUP_EVAL_MIN_COHORT (a single candidate). Every candidate produces exactly
  // one row below, so the compared-field size IS input.length. When too small, we crown
  // NO lead (so nothing auto-seals), claim NO robustness, and report "insufficient
  // sample" — the same defect class adverse-impact.ts guards with its own min-cohort.
  const comparable = hasComparableCohort(input.length);

  // Full deterministic breakdown per candidate (best-effort; needs the role's job).
  const job = jobId ? getJob(jobId) : null;
  // Which AI stages did not produce their result (see DegradedStage). Collected as
  // the run goes and persisted on the payload, so "the deterministic fallback" is a
  // stated fact rather than something the reader has to infer from missing prose.
  const degraded: DegradedStage[] = [];
  const rankStage = stageSignal(signal, stageTimeoutMs(GROUP_EVAL_RANK_TIMEOUT_MS));
  let rows = new Map<string, RecruiterRow>();
  let fairness: Fairness | null = null;
  if (job) {
    try {
      const pool = input
        .map((c) => (c.candidateId ? poolEntryOf(c.candidateId, c.label, resolved.get(c.candidateId)) : null))
        .filter((e): e is CandidatePoolEntry => e !== null);
      const ranked = await rankCandidates(job, pool, rankStage.signal);
      rows = ranked.rows;
      fairness = ranked.fairness;
    } catch (error) {
      // A ranker failure was already soft (the eval degrades to the score-only view
      // and robustness reports "unavailable"). What was missing is the DISCLOSURE:
      // the payload said nothing about which stage did not run, so a degraded
      // evaluation was indistinguishable from a full one. `rankStage.deadline` is
      // how we tell our own timeout from any other failure — AbortSignal.any reports
      // only that it aborted, never which input aborted it.
      degraded.push({ stage: "ranking", reason: rankStage.deadline.aborted ? "timeout" : "failed" });
      console.warn(`[group-eval] recruiter ranking failed for "${roleKey}":`, error instanceof Error ? error.message : error);
    }
  }

  // Robustness truth (bug-ui-scan-2026-07-09 A): the cross-scheme weighting check only
  // proves something when the ranker ran AND the weights actually vary. Resolve the honest
  // status ONCE from the same facts — a job (so a ranker ran) + whether it produced a
  // varying fairness matrix — so the panel and the sealed record can never imply a check
  // that did not run (a no-op, a ranker failure, or a job-less role). Below the
  // min-cohort floor there is no field to re-rank, so robustness is "insufficient_sample"
  // — never a trivial length-1 "pass" (bug-ui-scan-2026-07-09 #4).
  //
  // COVERAGE (this sweep): "assessed" also has to mean the check saw THIS comparison's
  // field. The pool handed to the ranker drops every candidate it cannot resolve — no
  // candidateId, or a candidateId whose profile AND analysis are both gone — and
  // recruiter_cli skips malformed rows, so the matrix can be perfectly ALIGNED
  // (isFairnessAligned) and still cover a strict subset of the compared field. Those
  // candidates are still compared and still ranked (on their stored matchScore), so an
  // unranked candidate with the highest stored score is crowned LEAD without ever
  // appearing in the matrix — and the sealed record then asserted "assessed" about an
  // order the check never re-scored. Partial coverage is "could not assess", the same
  // honest value a ranker failure gets (the panel still renders the matrix it does have;
  // its order verdict already declines on this mismatch — robustOrderVerdict).
  const fairnessCoversField = fairnessCoversCohort(input.map((c) => c.candidateId), fairness);
  const robustness: RobustnessStatus = !comparable
    ? "insufficient_sample"
    : job && !fairnessCoversField
      ? "unavailable"
      : assessRobustness(!!job, fairness);

  // Per-candidate AI reasoning, CONCURRENTLY (idea-bce9547b): this used to be a
  // sequential `await runReasoning(...)` per candidate — on cache misses, up to
  // GROUP_EVAL_CAP=6 cold Python spawns run strictly serially behind the modal
  // spinner, making group eval ~6x one reasoning round-trip in wall time. The
  // calls are independent (own workdir, own process, per-candidate cache slot),
  // so they run in parallel; the field is already capped at 6, which is the
  // concurrency bound. Per-candidate failures degrade to the deterministic
  // source exactly as before.
  //
  // The deadline is PER CANDIDATE (its own stageSignal below), so one stalled
  // provider call degrades that candidate to the deterministic rationale instead of
  // holding the other five behind it.
  const reasonings = await Promise.all(
    input.map(async (c): Promise<{ reasoning: Reasoning; source: string | null; promptVersion: string | null; failed: DegradedStage["reason"] | null }> => {
      if (!jobId || !c.candidateId) return { reasoning: {}, source: null, promptVersion: null, failed: null };
      const stage = stageSignal(signal, stageTimeoutMs(GROUP_EVAL_REASONING_TIMEOUT_MS));
      try {
        const out = await runReasoning({ jobId, profileId: c.candidateId }, stage.signal, workspaceId);
        return {
          reasoning: (out.reasoning as Reasoning) ?? {},
          source: String(out.source ?? "deterministic"),
          // W0.3 — reasoning_cli stamps the prompt version that produced this verdict.
          // It used to be dropped here, which is why the sealed lead could not say WHICH
          // prompt generated the reasoning behind it (EU AI Act Art. 12 traceability).
          promptVersion: typeof out.promptVersion === "string" ? out.promptVersion : null,
          failed: null,
        };
      } catch {
        // Best-effort by design: a candidate whose reasoning run fails or passes its
        // deadline keeps the deterministic rationale. Recorded (not swallowed) so the
        // payload can say the cohort's reasoning was partly deterministic.
        return { reasoning: {}, source: "deterministic", promptVersion: null, failed: stage.deadline.aborted ? "timeout" : "failed" };
      }
    })
  );
  // Reasoning is per candidate but disclosed once for the cohort: "some of this
  // field's rationales are deterministic" is the fact a reader needs, and a timeout
  // is reported over a plain failure when either occurred (the stricter claim).
  const reasoningFailures = reasonings.map((r) => r.failed).filter((f): f is DegradedStage["reason"] => f !== null);
  if (reasoningFailures.length > 0) {
    degraded.push({ stage: "reasoning", reason: reasoningFailures.includes("timeout") ? "timeout" : "failed" });
  }

  // The distinct prompt versions behind this cohort's reasoning. Normally one; a mixed
  // set (a cache straddling a prompt bump) is recorded as-is rather than collapsed to
  // the first — the record must not imply one prompt when two produced the ranking.
  const promptVersions = [...new Set(reasonings.map((r) => r.promptVersion).filter((v): v is string => !!v))].sort();

  const sources: string[] = [];
  const candidates: PerCandidate[] = [];
  for (const [idx, c] of input.entries()) {
    const rec = c.candidateId ? resolved.get(c.candidateId)?.profile ?? null : null;
    const payload = rec?.payload as { seniority?: string; archetype?: string } | null;
    const row = c.candidateId ? rows.get(c.candidateId) ?? null : null;
    const result = row?.result;
    const { reasoning, source } = reasonings[idx];
    if (source !== null) sources.push(source);
    const archetype = row?.archetype ?? payload?.archetype ?? null;
    candidates.push({
      entryId: c.entryId,
      label: c.label,
      // Prefer the fresh recruiter total (matches the breakdown shown) over the
      // stored matchScore, falling back to it when the role has no job. A
      // candidate with NEITHER stays null (unscored) — the old `?? 0` fabricated
      // a genuine-looking 0 that ranked, displayed, and sealed (REC-03).
      score: result?.total ?? c.matchScore ?? null,
      seniority: row?.seniority ?? payload?.seniority ?? null,
      archetype,
      track: fairnessTrackOf(row?.track, archetype),
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

  candidates.sort((a, b) => {
    // A knockout-failed candidate (fails the role's must-haves) must never outrank
    // one who passed (or wasn't gated) — crowning them "recommended lead" and
    // sealing it into the decision record is wrong. koPassed is undefined when the
    // role has no job/ranker (ungated): treat that as not-failed. Within each group,
    // higher fit wins.
    const aFailed = a.koPassed === false;
    const bFailed = b.koPassed === false;
    if (aFailed !== bFailed) return aFailed ? 1 : -1;
    // Null-safe within each group: an unscored candidate ranks below every
    // measured one (never tied with a genuine 0 via fabrication).
    return compareScoreDesc(a.score, b.score);
  });
  const top = candidates[0] ?? null;
  // The recommended LEAD must pass knockout AND the field must clear the min-cohort
  // floor. With the ko-aware sort above, top is the best ko-passing candidate when one
  // exists; if the whole field failed KO — or there is only ONE candidate, so there is
  // no field to lead over (bug-ui-scan-2026-07-09 #4) — there is no lead to crown or
  // seal. A null lead means no `group_eval_lead`/`group_eval_advisory` is sealed below.
  const lead = comparable && top && top.koPassed !== false ? top : null;

  // Canonical role requirements (must-have first): the role's declared
  // requirements, so the skills matrix is ordered and complete even for a skill no
  // candidate matched, AND the anchor the lead's differentiators are filtered to.
  // The modal falls back to the union of matched∪missing when this is absent.
  const requirements = (job?.requirements ?? []).map((r) => ({ skill: r.skill, kind: r.kind }));

  // Differentiators: the lead's *role-relevant* edge — requirement skills the lead
  // matched that every rival missed (NOT raw self-declared claims, which could be
  // off-topic). See computeDifferentiators for the full definition and rationale.
  // Anchored on the ko-passing lead (none when the whole field failed KO).
  const differentiators = lead
    ? computeDifferentiators(lead, candidates.filter((c) => c.entryId !== lead.entryId), requirements)
    : [];

  // Watch-outs as STRUCTURED FACTS (eval-speaks-your-language), not baked English
  // sentences: the eval is persisted once and re-opened by whoever is on the team,
  // so a frozen English string would render untranslated forever in a Czech/German/
  // French workspace. The client composes the sentence from the fact through the
  // `decisions.groupEval.risk.*` catalog (group-eval/localize.ts).
  const risks: RiskFact[] = [];
  for (const c of candidates) {
    // Lower-fit watch-out. `score != null` ALREADY means measured (REC-03: an unscored
    // candidate carries null, never a fabricated 0), so the old `> 0` clause exempted
    // exactly the worst measured candidate in the field — a genuine 0 — from the flag.
    // The floor is the shared FIT_PROMISING_FLOOR, not a re-hardcoded 55.
    if (c.score != null && c.score < FIT_PROMISING_FLOOR) risks.push({ kind: "low_fit", label: c.label, score: c.score });
    if (isEarlyCareer(c.archetype)) risks.push({ kind: "early_career", label: c.label });
    if (c.gaps.length) risks.push({ kind: "gaps", label: c.label, gaps: c.gaps.slice(0, 3) });
  }

  const uniqueSources = new Set(sources.filter(Boolean));
  const source = uniqueSources.size === 0 ? "deterministic" : uniqueSources.size === 1 && uniqueSources.has("llm") ? "llm" : uniqueSources.has("llm") ? "partial" : "deterministic";

  // AI head-to-head narrative (best-effort; deterministic one-liner is the fallback).
  //
  // Gated on the MIN-COHORT FLOOR, not merely on a non-empty field. group_compare's
  // contract is "who leads and the single clearest reason" and its deterministic twin
  // has an explicit n==1 branch ("**Ada** leads 1 candidate … on overall fit (**90**)",
  // "Advance **Ada** — the only candidate in this role"). The modal's AiVerdict renders
  // the narrative INSTEAD of `summary` whenever one exists, so on a single-candidate
  // field the crown the floor refused to award reappeared as the headline and the
  // "insufficient sample — no lead is crowned" disclosure was never shown anywhere.
  // It also spent a paid LLM round-trip (plus a Python spawn) to compare one candidate
  // against nobody. Below the floor there is nothing to compare: emit no narrative, and
  // AiVerdict falls back to the honest insufficient-sample summary.
  const compareStage = stageSignal(signal, stageTimeoutMs(GROUP_EVAL_COMPARE_TIMEOUT_MS));
  const compare = comparable ? await runGroupCompare(roleTitle, candidates, job?.salaryBand ?? [], compareStage.signal) : null;
  // A null compare over a comparable field means the narrative did not arrive — the
  // spawn failed, passed its deadline, or returned a headline-less body. Either way
  // the modal falls back to `summary`, and the payload now says so rather than
  // letting a deterministic one-liner read as the AI's considered comparison. (Below
  // the min-cohort floor the narrative is deliberately not attempted, which is a
  // policy decision already disclosed as "insufficient sample" — not a degradation.)
  if (comparable && !compare) {
    degraded.push({ stage: "comparison", reason: compareStage.deadline.aborted ? "timeout" : "failed" });
  }

  // Summary is governance-aware: in committee/eligibility modes it must NOT read as
  // an AI verdict ("Recommended lead") — that's the very thing those modes reject.
  // An all-unscored field can surface a null-scored lead: the summary then says
  // "unscored" instead of asserting a fit number that was never computed.
  const leadDesc = lead ? `${lead.label} (${lead.score != null ? `fit ${lead.score}` : "unscored"})` : null;
  // Lead separation (UAT L1-TOM-GEF-01): the crown ranks on the bare point estimate
  // while every candidate already carries an honest confidence band. Ask whether the
  // gap to the runner-up actually survives that uncertainty, so the summary and the
  // sealed record can say "not separated" instead of implying a decisive win. The
  // runner-up is the next candidate in the SAME honest order — nothing is reordered.
  // …and against a rival that could actually TAKE the crown: a knockout-failed candidate
  // is refused the lead above and dropped from the eligibility list, so hedging the crown
  // against one sealed "treat the top two as a tie on the evidence available" about a
  // candidate who failed the role's must-haves — precisely when the lead is the SOLE
  // eligible candidate. eligibleRunnerUp skips them; no one is reordered.
  const runnerUp = eligibleRunnerUp(candidates, lead);
  const separation = leadSeparation(lead, runnerUp);
  const separationCaveat = lead && runnerUp ? separationNote(separation, lead.label, runnerUp.label) : "";
  // The summary is produced TWICE, on purpose:
  //   • `deterministicSummary` — English prose. It is the SEALED decision rationale
  //     below (English by convention — see the seal site) and the only thing a
  //     pre-facts reader has.
  //   • `summaryFacts` — the same branch as a discriminator + params, which the
  //     modal renders through the catalog in the reader's language
  //     (eval-speaks-your-language). The two must stay in lockstep: each branch
  //     sets both.
  let summaryKind: SummaryFacts["kind"];
  let deterministicSummary: string;
  if (!candidates.length) {
    summaryKind = "empty";
    deterministicSummary = `No candidates to evaluate for ${roleTitle}.`;
  } else if (!comparable) {
    // Single-candidate field (bug-ui-scan-2026-07-09 #4): nothing to compare against, so
    // no lead is crowned/sealed and the weighting-robustness check does not apply.
    summaryKind = "insufficient";
    deterministicSummary = `Only ${candidates.length} candidate for ${roleTitle} — a single candidate can't be ranked against a field, so no lead is crowned and the weighting-robustness check does not apply (insufficient sample). Add more candidates to compare.`;
  } else if (!lead) {
    summaryKind = "no_lead";
    deterministicSummary = `${candidates.length} candidate(s) for ${roleTitle}, but none pass the role's must-haves (knockout) — no lead. Review the field below.`;
  } else if (governanceMode === "eligibility_list") {
    summaryKind = "eligibility";
    deterministicSummary = `${candidates.length} candidate(s) for ${roleTitle}, ranked into an ordinal eligibility list (top by fit: ${leadDesc}). Apply any statutory preferences before certifying — nothing is auto-sealed.`;
  } else if (governanceMode === "committee") {
    summaryKind = "committee";
    deterministicSummary = `${candidates.length} candidate(s) for ${roleTitle}. Top by fit (advisory): ${leadDesc}. The search committee decides — the AI does not pick or seal a hire.${risks.length ? ` ${risks.length} watch-out(s) below.` : ""}`;
  } else {
    summaryKind = "recommendation";
    deterministicSummary = `${candidates.length} candidate(s) for ${roleTitle}. Recommended lead: ${leadDesc}. ${
      differentiators.length ? `Unique strengths: ${differentiators.join(", ")}. ` : ""
    }${risks.length ? `${risks.length} watch-out(s) flagged below.` : "No blocking risks flagged."}`;
  }
  // Append the separation caveat to EVERY governance mode that names a lead — the
  // hedge belongs wherever the crown is stated, and it rides into the sealed
  // rationale below (which is this same string), so the audit record carries it too.
  if (separationCaveat) deterministicSummary = `${deterministicSummary} ${separationCaveat}`;
  // The structured twin of the branch just taken. Only the fields that branch
  // actually renders are populated; the client's composer ignores the rest.
  const summaryFacts: SummaryFacts = {
    kind: summaryKind,
    roleTitle,
    count: candidates.length,
    leadLabel: lead?.label ?? null,
    leadScore: lead?.score ?? null,
    differentiators,
    riskCount: risks.length,
    separation: lead && runnerUp ? { verdict: separation, leadLabel: lead.label, runnerUpLabel: runnerUp.label } : null,
  };

  // SEALED RATIONALE LANGUAGE — CONVENTION (eval-speaks-your-language).
  // Everything the MODAL shows is composed in the reader's language from persisted
  // facts. The sealed `rationale` below is deliberately the opposite: it stays the
  // ENGLISH `deterministicSummary`, in every workspace, forever. A decision record
  // is an immutable audit artifact — it is read by auditors, exported, and compared
  // across tenants and across time, so its wording must not depend on whichever org
  // locale happened to be configured when the eval ran (and must not change if that
  // setting is later flipped). Same rule as `separationNote` (group-eval-separation.ts)
  // and the reasonCode/kind enums: the RECORD is canonical English, the UI localizes.
  // Do NOT "fix" this by feeding a localized string into sealDecisionSafe.
  //
  // Decision SoR (moonshot D backfill): seal the AI's recommended lead — the
  // group-eval recommendation a recruiter acts on, with the eval source as the
  // policy version. Best-effort; this is the real (non-sim) eval path — the sim has
  // its own client-side runGroupEval. Only sealed when there IS a ko-passing lead —
  // a knockout-failed field must not seal a "lead" into the decision record.
  // W0.3 — AI Act Art. 12 traceability for the sealed record. `rationale` is and stays
  // the DETERMINISTIC summary (a localized or model-authored string must never become the
  // record's own account of itself). But a record that says only "the AI led with X" is
  // not reconstructible: an auditor cannot see WHICH prompt produced the ranking, nor what
  // the model actually SAID about the candidate it crowned. Both were computed and then
  // dropped on the floor. They ride in `inputs` alongside the other machine facts:
  //   promptVersion  — the reasoning prompt(s) behind this cohort ([] when no LLM ran)
  //   leadReasoning  — the model's own verdict/strengths/gaps for the crowned lead,
  //                    VERBATIM and clipped, never re-narrated by us.
  // Clipped because a decision record is an audit artifact, not a transcript store.
  const MAX_REASON_ITEMS = 6;
  const MAX_REASON_CHARS = 400;
  const clip = (s: unknown) => String(s ?? "").slice(0, MAX_REASON_CHARS);
  const clipList = (xs: unknown) => (Array.isArray(xs) ? xs.slice(0, MAX_REASON_ITEMS).map(clip) : []);
  const traceability = {
    promptVersion: promptVersions,
    leadReasoning: lead
      ? { verdict: clip(lead.verdict), strengths: clipList(lead.strengths), gaps: clipList(lead.gaps) }
      : null,
  };

  if (lead && sealsLead(governanceMode)) {
    sealDecisionSafe({
      kind: "group_eval_lead",
      actor: "auto:group-eval",
      policyVersion: source,
      candidateRef: lead.entryId,
      rationale: deterministicSummary,
      reasonCode: "lead",
      // score: null when the lead was never measured — the sealed record states
      // the absence rather than fabricating a 0 (REC-03). robustness states whether the
      // weighting-robustness check was actually assessed, so the sealed lead never reads
      // as robustness-verified when it wasn't (bug-ui-scan-2026-07-09 A).
      // cohortSource records whether the compared field was the recruiter's explicit
      // selection or the default top-N — so the sealed record is honest about cohort
      // provenance (a lead crowned over a chosen four ≠ over the whole fit-ranked field).
      // confidence/separation (UAT L1-TOM-GEF-01): the sealed record used to assert a
      // lead on a bare point estimate. It now carries the lead's honest band and
      // whether that lead actually clears the runner-up's band — so a record can never
      // read as a decisive crown when the two top candidates were a tie on the
      // evidence. "unknown" is recorded as such, never silently as separation.
      inputs: { score: lead.score, confidence: lead.confidence ?? null, separation, candidates: candidates.length, roleTitle, robustness, cohortSource: useSelection ? "selection" : "top", cohortSize: totalCandidates, ...traceability },
    });
  } else if (lead) {
    // Governance mode (P1-3): the AI is advisory and must NOT seal a winner. Record
    // its ranking as an ADVISORY input so the audit shows it informed — not made —
    // the decision; the committee / eligibility certification is the human's to seal.
    sealDecisionSafe({
      kind: "group_eval_advisory",
      actor: "auto:group-eval",
      policyVersion: `${source}/${governanceMode}`,
      candidateRef: lead.entryId,
      rationale: deterministicSummary,
      reasonCode: "advisory",
      // Same confidence/separation honesty as the recommendation branch above — an
      // advisory ranking is still a ranking someone will read as a shortlist.
      inputs: { score: lead.score, confidence: lead.confidence ?? null, separation, candidates: candidates.length, roleTitle, governanceMode, robustness, cohortSource: useSelection ? "selection" : "top", cohortSize: totalCandidates, ...traceability },
    });
  }

  // group-eval-event-anchor — write a `group_eval` pipeline event at seal time on BOTH
  // branches (recommendation lead + advisory), keyed on the lead's entry. This is the
  // DIRECT provenance anchor for the decision log (decision-attribution.GROUP_EVAL_EVENT_KIND):
  // it gives an advisory/committee run — which never advances a candidate — a visible,
  // provenance-bearing log row, and anchors the cohort chip at the eval's own moment even
  // when the crowned lead is advanced hours later or by someone else (the two blind spots the
  // advance-only 6h window join could not cover). The detail is an honest machine summary —
  // cohortSource + compared/field sizes, NO candidate id (safe for the public feed's
  // pass-through). Gated on `lead` so it mirrors the seal exactly: no lead sealed ⇒ no event.
  if (lead) {
    recordAutomationEvent(
      lead.entryId,
      "group_eval",
      `${useSelection ? "selection" : "top"} · ${candidates.length}/${totalCandidates}`,
      workspaceId
    );
  }

  const payload: Record<string, unknown> = {
    roleTitle,
    jobId,
    source,
    // Governance (P1-3): the mode, its human-facing note, whether the AI output is
    // advisory (no auto-sealed lead), and the ordinal eligibility list when relevant.
    governanceMode,
    // The English note is still persisted for readers that predate the mode enum,
    // but the modal composes the banner from `governanceMode` through the catalog
    // (eval-speaks-your-language): this banner is compliance guidance and must not
    // be the one English paragraph in a Czech workspace's modal.
    governanceNote: governanceNote(governanceMode),
    advisory,
    eligibilityList: governanceMode === "eligibility_list" && lead ? buildEligibilityList(candidates) : null,
    candidateCount: candidates.length,
    // Coverage bookkeeping so the modal can show "top N of M" instead of letting a
    // capped comparison read as full coverage, and diff the pool for staleness.
    totalCandidates,
    cap: GROUP_EVAL_CAP,
    // "capped" (top-N of a larger pool) and "selection" (the recruiter chose the
    // field) are mutually exclusive coverage stories — an explicit selection did NOT
    // silently drop the rest by fit, so it never reads as a capped top-N.
    capped: !useSelection && totalCandidates > GROUP_EVAL_CAP,
    // group-eval-cohort-choice — provenance of the compared field: present only when
    // the recruiter picked an explicit subset, so the modal can disclose "comparing
    // your selection of {count} of {total}" honestly instead of the top-N wording.
    selection: useSelection ? { count: input.length, total: totalCandidates } : null,
    // Consent/anonymization exclusions — the honest half of the gate above. A field
    // that shrank because two people were erased or their consent lapsed must not
    // read as a field that simply had fewer applicants, so the count and the REASONS
    // are carried on the payload (an erasure and a lapsed consent are different
    // facts). COUNTS ONLY, deliberately: this row is shared, persisted and readable
    // by the whole team, so the gate must not write the excluded people's ids back
    // into it — that is the thing the erasure removed. Null when nothing was
    // excluded, so legacy payloads and clean cohorts are indistinguishable.
    consentExcluded:
      consentExclusions.length > 0
        ? {
            count: consentExclusions.length,
            anonymized: consentExclusions.filter((e) => e.reason === "anonymized").length,
            consentExpired: consentExclusions.filter((e) => e.reason === "consent_expired").length,
          }
        : null,
    // Every candidate label in the FULL role cohort at eval time — the modal diffs
    // this against the role's current pending entries to warn about pool drift
    // (anchored to the whole cohort, not just a narrowed selection).
    evaluatedLabels: cohort.map((c) => c.label),
    // selection-memory-rerun — stable ids alongside the labels. evaluatedIds mirrors
    // evaluatedLabels (the FULL cohort) for id-based drift; comparedIds is the field
    // actually compared (post validation/cap/dedupe), replayed as the selection on a
    // selection-launched eval's Re-run. Both additive — legacy payloads simply omit them.
    evaluatedIds: cohort.map((c) => c.entryId),
    comparedIds: input.map((c) => c.entryId),
    topPick: lead
      ? {
          label: lead.label,
          // The lead's stable identity — the modal keys the "Unique strengths" chips on
          // it (candIdentity), so a duplicate display name can't decorate the rival's tab.
          entryId: lead.entryId,
          // null = unscored (the modal's ScoreBadge renders a dash) — sealed and
          // displayed as "not measured", never as 0.
          score: lead.score,
          why:
            lead.verdict ||
            (lead.score != null ? `Highest fit (${lead.score}) in this role.` : "Top of the field, but no fit score has been computed yet."),
          // eval-speaks-your-language — which of the two canned fallbacks was used,
          // so the modal can render it in the reader's language. Absent when the AI
          // VERDICT supplied the text (that is already produced in the org locale
          // and is candidate-specific, so it is rendered verbatim).
          whyKind: lead.verdict ? undefined : lead.score != null ? ("highest_fit" as const) : ("unscored" as const),
        }
      : null,
    // Does the crown survive both top candidates' confidence bands? Carried so the
    // modal can hedge the lead visually the same way the summary and the sealed
    // record now do (UAT L1-TOM-GEF-01). "unknown" = not assessable, not "fine".
    leadSeparation: separation,
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
    // Whether that robustness check was actually assessed (see RobustnessStatus) — the
    // panel renders this state and the sealed lead records it, so neither can imply a
    // check that did not run.
    robustness,
    summary: deterministicSummary,
    // eval-speaks-your-language — the structured twin of `summary`. `summary` stays
    // (it is the sealed English rationale and the legacy reader's only copy); the
    // modal prefers these facts and composes the sentence in the reader's language.
    summaryFacts,
    // Structured, bold-formatted AI comparison (the modal prefers it).
    comparison: compare?.comparison ?? null,
    comparisonSource: compare?.source ?? null,
    // The language the comparison prose is actually IN — the modal renders an honest
    // "shown in <language>" note when it differs from the reader's locale, the same way
    // MatchReasoningPanel does for the per-match rationale.
    comparisonLang: compare?.narrativeLang ?? null,
    // Which AI stages did not produce their result, and whether they timed out or
    // failed. Up to eight Python processes back one evaluation and EVERY one of them
    // degrades to a deterministic twin, so a saved eval could be almost entirely
    // deterministic and read exactly like a full AI comparison. Null when every stage
    // delivered — so a clean run and a legacy payload are indistinguishable, and the
    // presence of this field always means something actually degraded.
    degradedStages: degraded.length > 0 ? degraded : null,
  };

  // Persist under the run's cache key (roleKey for a top-N run, the selection key for
  // a selection run — selection-rerun-cache). Same workspace scoping either way.
  saveGroupEval(cacheKey, roleTitle, payload, workspaceId);
  return payload;
}
