import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPipelineEntry,
  getDevCase,
  getPipelineEntry,
  getDevSessionEvents,
  getPosting,
  getProfileRecord,
  getSubmission,
  listMatrixProfiles,
  listProfileRecords,
  recordAutomationEvent,
  saveSubmissionEvaluation,
  setApproval,
  updateProfile,
  type DevSubmission,
} from "./db";
import { MAX_CODEBASES } from "./devcase-constraints";
import { scoreAuthenticity, type Authenticity } from "./devcase-authenticity";
import { seedDiffEvidence, type SeedDiff } from "./devcase-seed-diff";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, PipelineError, spawnPython } from "./python-runner";
import { buildRepoSnapshot, fetchRepoSignals, type RepoSnapshot } from "./repo-snapshot";
import { isEarlyCareer } from "./archetypes";
import { devCaseIdFromJobId } from "./student-interview";

// The devcase CLI envelope every run* function below shares: make a temp workdir,
// write the per-call JSON arg files into it + build the argv, spawn
// `python -m pipeline.jobfit.devcase.devcase_cli <verb> …`, fail on a non-zero
// exit (mapping stderr → PipelineError), parse the single JSON line, then always
// clean the workdir up. `build` receives the workdir, writes whatever arg files
// it needs, and returns the FULL argv (verb + flags + the paths it just wrote) —
// so each call keeps its exact subcommand/flags/input. `signal` is forwarded to
// spawnPython uniformly (the kp SIGKILL-on-abort convention); pass ctx.signal
// where a caller can be cancelled.
async function runDevcaseCli<T>(
  build: (workdir: string) => string[] | Promise<string[]>,
  signal?: AbortSignal,
): Promise<T> {
  const workdir = await createWorkdir();
  try {
    const args = await build(workdir);
    const { result } = spawnPython(["-m", "pipeline.jobfit.devcase.devcase_cli", ...args], { signal });
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) throw new PipelineError(parseStderrError(stderr, exitCode));
    return parsePythonJson<T>(stdout, stderr);
  } finally {
    await cleanupWorkdir(workdir);
  }
}

export type DevNeed = {
  id?: string;
  title?: string;
  stack?: string[];
  responsibilities?: string[];
  codebaseRefs?: { kind: string; ref: string; label?: string }[];
  seniorityTarget?: string;
  roleFamily?: string;
  notes?: string;
  // JD-first intake: the saved job description the need was built from. jdText is
  // the PRIMARY statement of the need — stack/responsibilities may be empty, the
  // analyze step extracts them from the JD body.
  jdSlug?: string;
  jdText?: string;
};

export type NeedAnalysisResult = {
  analysis: Record<string, unknown>;
  // All grounded codebases (multi-repo). `snapshot` stays as the first one so older
  // consumers (jd-build, saved bundles) keep working; `snapshots` is what the UI reads.
  snapshot: RepoSnapshot | null;
  snapshots: RepoSnapshot[];
  source: string;
  // Per-step provenance ({step: "llm"|"deterministic"}) from the uniform CLI
  // envelope — single-step here ({analyze}), but typed the same across the
  // pipeline so one provenance strip renders every command.
  perStepSources: Record<string, string>;
  // Why a step fell back ({step: "<ExceptionType>: <message>"}) — present only for steps
  // whose LLM call raised, so the UI can tell a timeout from a JSON parse error from a
  // misconfigured provider instead of a silent deterministic run. Empty when nothing failed.
  fallbackReason: Record<string, string>;
};

// D2 core: pull the real codebase(s), then reflect the need against them (LLM + fallback).
export async function runNeedAnalysis(need: DevNeed, signal?: AbortSignal): Promise<NeedAnalysisResult> {
  const ghRefs = (need.codebaseRefs ?? [])
    .filter((r) => r.kind === "github" || /github\.com/.test(r.ref))
    .slice(0, MAX_CODEBASES);
  const snapshots = (await Promise.all(ghRefs.map((r) => buildRepoSnapshot(r.ref)))).filter(
    (s): s is RepoSnapshot => s !== null,
  );

  const payload = await runDevcaseCli<{ result: Record<string, unknown>; source: string; perStepSources?: Record<string, string>; fallbackReason?: Record<string, string> }>(
    async (workdir) => {
      const needPath = path.join(workdir, "need.json");
      await writeFile(needPath, JSON.stringify(need), "utf-8");
      const args = ["analyze-need", "--need-json", needPath];
      if (snapshots.length > 0) {
        const snapPath = path.join(workdir, "snapshots.json");
        await writeFile(snapPath, JSON.stringify(snapshots), "utf-8");
        args.push("--snapshots-json", snapPath);
      }
      return args;
    },
    signal,
  );
  return { analysis: payload.result, snapshot: snapshots[0] ?? null, snapshots, source: payload.source, perStepSources: payload.perStepSources ?? {}, fallbackReason: payload.fallbackReason ?? {} };
}

export type DesignArtifactsResult = {
  role: Record<string, unknown>;
  case: Record<string, unknown>;
  source: string;
  perStepSources: Record<string, string>; // {role, case}
  fallbackReason: Record<string, string>; // {step: "<ExceptionType>: <message>"} for steps whose LLM call raised
};

// D3 core: design a RoleSpec + a CaseScenario (covert tooling-probes) from the need + analysis.
// `feedback` (W5-4) is the human reviewer's revision note from the approval gate — the
// redesign honors it instead of forcing a full lifecycle re-run from intake.
export async function runDesignArtifacts(
  need: DevNeed,
  analysis: Record<string, unknown>,
  signal?: AbortSignal,
  feedback?: string,
  lang?: string | null
): Promise<DesignArtifactsResult> {
  const payload = await runDevcaseCli<{ result: { role: Record<string, unknown>; case: Record<string, unknown> }; source: string; perStepSources?: Record<string, string>; fallbackReason?: Record<string, string> }>(
    async (workdir) => {
      const needPath = path.join(workdir, "need.json");
      const analysisPath = path.join(workdir, "analysis.json");
      await writeFile(needPath, JSON.stringify(need), "utf-8");
      await writeFile(analysisPath, JSON.stringify(analysis), "utf-8");
      return [
        "design-artifacts",
        "--need-json",
        needPath,
        "--analysis-json",
        analysisPath,
        // DEVP5 — the case brief/tasks the candidate reads render in this language.
        "--lang",
        lang || "en",
        ...(feedback && feedback.trim() ? ["--feedback", feedback.trim()] : []),
      ];
    },
    signal,
  );
  return { role: payload.result.role, case: payload.result.case, source: payload.source, perStepSources: payload.perStepSources ?? {}, fallbackReason: payload.fallbackReason ?? {} };
}

export type InterviewScenarioResult = {
  scenario: Record<string, unknown>;
  source: string;
  perStepSources: Record<string, string>; // {scenario}
};

/** Case → AI-interview scenario: instantiate the six-phase early-career script
 *  from the approved case (devcase/interview_scenario.py). Generated once per
 *  ROLE and reused for every candidate, so interview ratings stay comparable. */
export async function runInterviewScenario(
  kase: Record<string, unknown>,
  role: Record<string, unknown>,
  lang?: string | null
): Promise<InterviewScenarioResult> {
  const payload = await runDevcaseCli<{ result: { scenario: Record<string, unknown> }; source: string; perStepSources?: Record<string, string> }>(
    async (workdir) => {
      const casePath = path.join(workdir, "case.json");
      const rolePath = path.join(workdir, "role.json");
      await writeFile(casePath, JSON.stringify(kase), "utf-8");
      await writeFile(rolePath, JSON.stringify(role), "utf-8");
      return [
        "interview-scenario",
        "--case-json",
        casePath,
        "--role-json",
        rolePath,
        // DEVP5 — the spoken interview narration is delivered in this language.
        "--lang",
        lang || "en",
      ];
    },
  );
  return { scenario: payload.result.scenario, source: payload.source, perStepSources: payload.perStepSources ?? {} };
}

export type SeedMaterializeResult = {
  seed: Record<string, unknown>; // {files: [{path, contents}], note, promptVersion}
  source: string;
  perStepSources: Record<string, string>; // {seed}
};

/** Case -> materialized seed: turn the case's prose starting materials into a
 *  concrete starter file tree (devcase/seed_materializer.py). One seed per CASE,
 *  identical for every candidate, so the take-home submission becomes a diff
 *  against shared ground truth instead of GPT-gradeable prose. */
export async function runMaterializeSeed(
  kase: Record<string, unknown>,
  role: Record<string, unknown>,
  lang?: string | null
): Promise<SeedMaterializeResult> {
  const payload = await runDevcaseCli<{ result: { seed: Record<string, unknown> }; source: string; perStepSources?: Record<string, string> }>(
    async (workdir) => {
      const casePath = path.join(workdir, "case.json");
      const rolePath = path.join(workdir, "role.json");
      await writeFile(casePath, JSON.stringify(kase), "utf-8");
      await writeFile(rolePath, JSON.stringify(role), "utf-8");
      return [
        "materialize-seed",
        "--case-json",
        casePath,
        "--role-json",
        rolePath,
        // DEVP5 — the seed README + DECISIONS.md the candidate reads render here.
        "--lang",
        lang || "en",
      ];
    },
  );
  return { seed: payload.result.seed, source: payload.source, perStepSources: payload.perStepSources ?? {} };
}

export type ObservedMintResult = { credited: string[]; applied: boolean };

/** After a CASE-GROUNDED interview completes, run the deterministic observed gate
 *  (live_case.apply_interview_case) over the scorecard and — when earned — persist
 *  the enriched profile, so the candidate's next match credits the observed skills
 *  and narrows their early-career confidence band.
 *
 *  Quietly returns {applied: false} unless EVERY precondition holds: an
 *  early-career entry with a saved profile, on a dev-case role whose case carries
 *  a generated interview scenario (i.e. the conversation really was case-grounded).
 *  The honest gates themselves (all case constructs rated on quoted evidence, mean
 *  ≥ "Above bar", never from a wide-confidence transcript) live in Python with the
 *  rest of the scoring contract. */
export async function mintObservedFromCaseInterview(
  entryId: string,
  scorecard: Record<string, unknown>
): Promise<ObservedMintResult> {
  const entry = getPipelineEntry(entryId);
  if (!entry || !entry.candidateId || !isEarlyCareer(entry.archetype)) return { credited: [], applied: false };
  const caseId = devCaseIdFromJobId(entry.jobId);
  const devCase = caseId ? getDevCase(caseId) : null;
  if (!devCase?.scenario || !devCase.case || !devCase.role) return { credited: [], applied: false };
  const rec = getProfileRecord(entry.candidateId);
  if (!rec) return { credited: [], applied: false };

  const payload = await runDevcaseCli<{ result: { creditedSkills?: string[]; profile?: Record<string, unknown> } }>(
    async (workdir) => {
      const casePath = path.join(workdir, "case.json");
      const rolePath = path.join(workdir, "role.json");
      const scorecardPath = path.join(workdir, "scorecard.json");
      const profilePath = path.join(workdir, "profile.json");
      await writeFile(casePath, JSON.stringify(devCase.case), "utf-8");
      await writeFile(rolePath, JSON.stringify(devCase.role), "utf-8");
      await writeFile(scorecardPath, JSON.stringify(scorecard), "utf-8");
      await writeFile(profilePath, JSON.stringify(rec.payload), "utf-8");
      return [
        "observed-interview",
        "--case-json",
        casePath,
        "--role-json",
        rolePath,
        "--scorecard-json",
        scorecardPath,
        "--profile-json",
        profilePath,
      ];
    },
  );
  const credited = payload.result.creditedSkills ?? [];
  const profile = payload.result.profile;
  if (credited.length === 0 || !profile) return { credited: [], applied: false };
  updateProfile(rec.row.id, {
    label: (profile.displayName as string) || rec.row.label,
    archetype: (profile.archetype as string) ?? rec.row.archetype,
    roleFamily: (profile.roleFamily as string) ?? rec.row.role_family,
    completeness: typeof profile.completeness === "number" ? profile.completeness : rec.row.completeness,
    payload: profile,
  });
  recordAutomationEvent(entryId, "observed_minted", credited.join(", "));
  return { credited, applied: true };
}

/** A submission carries only a free-text candidateRef — resolve it to a saved
 *  profile honestly: an exact profile-record id wins; otherwise a UNIQUE
 *  case-insensitive label match. Ambiguous or unknown refs resolve to null (mint
 *  nothing) — observed evidence must never land on the wrong person's profile. */
function profileForSubmission(sub: DevSubmission): NonNullable<ReturnType<typeof getProfileRecord>> | null {
  const ref = (sub.candidateRef ?? "").trim();
  if (!ref) return null;
  const byId = getProfileRecord(ref);
  if (byId) return byId;
  const needle = ref.toLowerCase();
  const matches = listProfileRecords().filter((p) => (p.row.label ?? "").trim().toLowerCase() === needle);
  return matches.length === 1 ? matches[0] : null;
}

/** The take-home twin of mintObservedFromCaseInterview: after a submission is
 *  PROMOTED, run the deterministic transfer gate (live_case.apply_live_case via
 *  `devcase_cli observed-skills`) and — when earned — persist the enriched
 *  profile, so the candidate's next match credits the demonstrated skills at
 *  observed provenance (confidence capped 0.95, the deepest read we have).
 *
 *  Quietly returns {applied: false} unless every precondition holds: an evaluated
 *  submission on a posting whose dev case carries its role + case, AND a
 *  candidateRef that resolves unambiguously to a saved profile. The competence
 *  bar itself (transfer_score >= 65) lives in Python with the scoring contract. */
export async function mintObservedFromSubmission(
  submissionId: string,
  entryId?: string | null
): Promise<ObservedMintResult> {
  const sub = getSubmission(submissionId);
  const bundle = (sub?.evaluation ?? null) as { evaluation?: Record<string, unknown>; transfer?: Record<string, unknown> } | null;
  if (!sub || !bundle?.evaluation || !bundle?.transfer) return { credited: [], applied: false };
  const posting = sub.postingId ? getPosting(sub.postingId) : null;
  const devCase = posting?.caseId ? getDevCase(posting.caseId) : null;
  if (!devCase?.case || !devCase.role) return { credited: [], applied: false };
  const rec = profileForSubmission(sub);
  if (!rec) return { credited: [], applied: false };

  const payload = await runDevcaseCli<{ result: { creditedSkills?: string[]; profile?: Record<string, unknown> } }>(
    async (workdir) => {
      const write = async (name: string, data: unknown) => {
        const fp = path.join(workdir, name);
        await writeFile(fp, JSON.stringify(data), "utf-8");
        return fp;
      };
      return [
        "observed-skills",
        "--case-json",
        await write("case.json", devCase.case),
        "--role-json",
        await write("role.json", devCase.role),
        "--evaluation-json",
        await write("evaluation.json", bundle.evaluation),
        "--transfer-json",
        await write("transfer.json", bundle.transfer),
        "--profile-json",
        await write("profile.json", rec.payload),
      ];
    },
  );
  const credited = payload.result.creditedSkills ?? [];
  const profile = payload.result.profile;
  if (credited.length === 0 || !profile) return { credited: [], applied: false };
  updateProfile(rec.row.id, {
    label: (profile.displayName as string) || rec.row.label,
    archetype: (profile.archetype as string) ?? rec.row.archetype,
    roleFamily: (profile.roleFamily as string) ?? rec.row.role_family,
    completeness: typeof profile.completeness === "number" ? profile.completeness : rec.row.completeness,
    payload: profile,
  });
  if (entryId) recordAutomationEvent(entryId, "observed_minted", credited.join(", "));
  return { credited, applied: true };
}

export type CommitReflectionResult = {
  reflection: Record<string, unknown>;
  tooling: Record<string, unknown>;
  source: string;
  perStepSources: Record<string, string>; // {reflect, tooling}
  fallbackReason: Record<string, string>; // {step: "<ExceptionType>: <message>"} for steps whose LLM call raised
  commitCount: number;
};

// D5 core: pull the submission repo's git trace, then reflect ("where they mentally
// went") + assess tooling against the case's covert probes.
export async function runCommitReflection(repoRef: string, caseId?: string, signal?: AbortSignal): Promise<CommitReflectionResult> {
  const signals = await fetchRepoSignals(repoRef);
  const commits = signals?.commits ?? [];
  const repo = signals ? { cadence: signals.cadence, topLevel: signals.topLevel } : null;
  const devCase = caseId ? getDevCase(caseId) : null;
  const probes = ((devCase?.case as { coverProbes?: unknown[] } | null)?.coverProbes ?? []) as unknown[];

  const payload = await runDevcaseCli<{ result: { reflection: Record<string, unknown>; tooling: Record<string, unknown> }; source: string; perStepSources?: Record<string, string>; fallbackReason?: Record<string, string> }>(
    async (workdir) => {
      const commitsPath = path.join(workdir, "commits.json");
      const probesPath = path.join(workdir, "probes.json");
      await writeFile(commitsPath, JSON.stringify(commits), "utf-8");
      await writeFile(probesPath, JSON.stringify(probes), "utf-8");
      const args = ["reflect-commits", "--commits-json", commitsPath, "--probes-json", probesPath];
      if (repo) {
        const repoPath = path.join(workdir, "repo.json");
        await writeFile(repoPath, JSON.stringify(repo), "utf-8");
        args.push("--repo-json", repoPath);
      }
      return args;
    },
    signal,
  );
  return { reflection: payload.result.reflection, tooling: payload.result.tooling, source: payload.source, perStepSources: payload.perStepSources ?? {}, fallbackReason: payload.fallbackReason ?? {}, commitCount: commits.length };
}

export type SubmissionEvaluation = {
  reflection: Record<string, unknown>;
  tooling: Record<string, unknown>;
  evaluation: Record<string, unknown>;
  transfer: Record<string, unknown>;
  // Candidate-specific interview questions minted from THIS submission's observed
  // decisions ({questions: FollowupQuestion[]}). The artifact alone can be wholly
  // LLM-produced, so the scores are hypotheses — the followups are what the live
  // interview uses to verify the candidate OWNS the decisions.
  followups: Record<string, unknown>;
  // Deterministic process-trace telemetry persisted with the bundle (the
  // submission-side twin of the interview's scorecard telemetry): raw signals
  // for later outcome-validation, beside the LLM reflection that interprets them.
  processTrace: {
    commitCount: number;
    cadence: { count: number; spanHours: number | null; bursty: boolean | null } | null;
    decisionsLogPresent: boolean;
  };
  // ce28da40 — process-authenticity (is this genuine incremental work or a
  // paste-from-LLM?), derived from the processTrace + reflection. Persisted so the
  // promote gate and the studio can read it without recomputing.
  authenticity: Authenticity;
  // c364a44d — which planted seed files the submission touched (grounded
  // engagement evidence). null when the case has no materialized seed or the repo
  // gave no changed paths.
  seedDiff: SeedDiff | null;
  source: string;
  perStepSources: Record<string, string>; // {reflect, tooling, evaluate, transfer, followups}
  fallbackReason: Record<string, string>; // {step: "<ExceptionType>: <message>"} for steps whose LLM call raised
  commitCount: number;
};

// D6 core: the full incoming-evaluation chain for one submission — trace -> reflect +
// tooling -> CaseEvaluation -> TransferAssessment. Persists the result on the submission.
export async function runEvaluateSubmission(submissionId: string, signal?: AbortSignal): Promise<SubmissionEvaluation> {
  const sub = getSubmission(submissionId);
  if (!sub) throw new Error("submission not found");
  if (!sub.repoRef) throw new Error("submission has no repo");
  const posting = sub.postingId ? getPosting(sub.postingId) : null;
  const devCase = posting?.caseId ? getDevCase(posting.caseId) : null;
  const caseObj = (devCase?.case as Record<string, unknown>) ?? {};
  const roleObj = (devCase?.role as Record<string, unknown>) ?? {};
  const probes = (caseObj.coverProbes as unknown[]) ?? [];
  // Live Work Surface (moonshot E): a "session:<id>" repoRef is an in-product work
  // session — there is no git log. Use the OBSERVED event stream for tooling;
  // commits stay empty (the commit-derived reflection degrades gracefully — the
  // candidate produced no commit history by design). A normal repoRef keeps the
  // existing fetch-and-infer path unchanged.
  let signals: RepoSnapshot | null = null;
  let events: { t: number; kind: string; path?: string | null }[] | null = null;
  if (sub.repoRef.startsWith("session:")) {
    events = getDevSessionEvents(sub.repoRef.slice("session:".length));
  } else {
    signals = await fetchRepoSignals(sub.repoRef);
  }
  const commits = signals?.commits ?? [];
  const repo = signals ? { cadence: signals.cadence, topLevel: signals.topLevel } : null;

  const payload = await runDevcaseCli<{
    result: {
      reflection: Record<string, unknown>;
      tooling: Record<string, unknown>;
      evaluation: Record<string, unknown>;
      transfer: Record<string, unknown>;
      followups?: Record<string, unknown>;
    };
    source: string;
    perStepSources?: Record<string, string>;
    fallbackReason?: Record<string, string>;
  }>(
    async (workdir) => {
      const write = async (name: string, data: unknown) => {
        const fp = path.join(workdir, name);
        await writeFile(fp, JSON.stringify(data), "utf-8");
        return fp;
      };
      const commitsPath = await write("commits.json", commits);
      const probesPath = await write("probes.json", probes);
      const casePath = await write("case.json", caseObj);
      const rolePath = await write("role.json", roleObj);

      const args = [
        "evaluate-submission",
        "--commits-json",
        commitsPath,
        "--probes-json",
        probesPath,
        "--case-json",
        casePath,
        "--role-json",
        rolePath,
      ];
      if (repo) args.push("--repo-json", await write("repo.json", repo));
      if (events) args.push("--events-json", await write("events.json", events));
      return args;
    },
    signal,
  );
  // Raw process signals, not interpretation: did they actually keep the forced
  // DECISIONS log (case-design v4's authorship contract), how many commits, what
  // cadence. Persisted so the decisions-log contract is checkable later instead
  // of taken on faith from the narrative.
  const processTrace = {
    commitCount: commits.length,
    cadence: signals?.cadence ?? null,
    decisionsLogPresent: (signals?.topLevel ?? []).some((f) => /decision/i.test(f.name)),
  };
  // ce28da40 — fold the trace + reflection into one authenticity verdict.
  const reflection = (payload.result.reflection ?? {}) as { readBeforeWrite?: number; iterationPattern?: string };
  const authenticity = scoreAuthenticity({
    commitCount: processTrace.commitCount,
    bursty: processTrace.cadence?.bursty ?? null,
    spanHours: processTrace.cadence?.spanHours ?? null,
    decisionsLogPresent: processTrace.decisionsLogPresent,
    readBeforeWrite: reflection.readBeforeWrite ?? null,
    iterationPattern: reflection.iterationPattern ?? null,
  });
  // c364a44d — anchor the evaluation into the shared seed: which planted seam
  // files did the submission actually touch? Grounded, mechanically comparable
  // engagement evidence beside the LLM's probe read.
  const seedFiles = ((devCase?.seed as { files?: { path?: string }[] } | null)?.files) ?? [];
  const seedDiff =
    seedFiles.length > 0 && (signals?.changedPaths?.length ?? 0) > 0
      ? seedDiffEvidence(seedFiles, signals!.changedPaths)
      : null;
  const out = {
    ...payload.result,
    followups: payload.result.followups ?? {},
    processTrace,
    authenticity,
    seedDiff,
    source: payload.source,
    perStepSources: payload.perStepSources ?? {},
    fallbackReason: payload.fallbackReason ?? {},
    commitCount: commits.length,
  };
  const transferScore = Number((payload.result.transfer as { transferScore?: number } | null | undefined ?? {}).transferScore ?? 0);
  saveSubmissionEvaluation(submissionId, out, transferScore);
  return out;
}

export type Sourced = { candidateId: string; label: string; archetype: string | null; score: number; matchedSkills: string[] };
// One record per candidate dropped because its payload failed CandidateProfileV2 validation
// (reason = the validation error type). Surfaced so an empty shortlist can be told apart from
// a pool that failed to load — see source.py / idea-19e24fe9.
export type SourceSkip = { candidateId: string | null; reason: string };
export type SourceOutcome = { candidates: Sourced[]; skipped: number; skippedReasons: SourceSkip[] };

// Phase C — proactive sourcing: rank the existing candidate DB against a designed role
// (deterministic matching). The role becomes a Job the core matcher scores. Returns the ranked
// `candidates` plus a `skipped` count (candidates whose payload failed to parse) so callers can
// distinguish "nobody qualified" from "the whole pool failed to load".
//
// `signal` lets a caller (e.g. the publish route) abort the sourcing child when its
// request is abandoned, so it's SIGKILLed instead of running to the backstop.
export async function runSourceForRole(
  role: Record<string, unknown>,
  { topN = 8, floor = 45, signal }: { topN?: number; floor?: number; signal?: AbortSignal } = {},
): Promise<SourceOutcome> {
  const profiles = listMatrixProfiles();
  if (profiles.length === 0) return { candidates: [], skipped: 0, skippedReasons: [] };
  const payload = await runDevcaseCli<{ result: SourceOutcome }>(
    async (workdir) => {
      const rolePath = path.join(workdir, "role.json");
      const candsPath = path.join(workdir, "cands.json");
      await writeFile(rolePath, JSON.stringify(role), "utf-8");
      await writeFile(candsPath, JSON.stringify(profiles), "utf-8");
      return [
        "source",
        "--role-json",
        rolePath,
        "--candidates-json",
        candsPath,
        "--top-n",
        String(topN),
        "--floor",
        String(floor),
      ];
    },
    signal,
  );
  const r = payload.result;
  return { candidates: r?.candidates ?? [], skipped: r?.skipped ?? 0, skippedReasons: r?.skippedReasons ?? [] };
}

// Bridge an evaluated submission into the pipeline + a Decisions screening_review card.
// Shared by /api/devcase/promote and the lifecycle orchestrator. Returns the entry id, or
// null if the submission isn't evaluated yet.
export function promoteSubmission(submissionId: string): string | null {
  const sub = getSubmission(submissionId);
  if (!sub || !sub.evaluation) return null;
  const bundle = sub.evaluation as {
    evaluation?: Record<string, unknown>;
    transfer?: Record<string, unknown>;
    authenticity?: { band?: string; score?: number };
  };
  const evaluation = bundle.evaluation ?? {};
  const transfer = bundle.transfer ?? {};
  const score = sub.transferScore ?? Number(transfer.transferScore ?? 0);
  const posting = sub.postingId ? getPosting(sub.postingId) : null;
  // ce28da40 — a suspect-authenticity submission may be a paste-from-LLM, so it's
  // never auto-advanced on transfer score alone: it's held for the live interview
  // that verifies ownership of the decisions (the minted followups), with the
  // authenticity concern surfaced to the reviewer.
  const suspectAuth = bundle.authenticity?.band === "suspect";

  const { entry } = createPipelineEntry({
    candidateId: `ds-${sub.id}`,
    candidateLabel: sub.candidateRef ?? "Candidate",
    archetype: "bau",
    roleFamily: "software_engineering",
    jobId: `dc-${posting?.caseId ?? "case"}`,
    jobTitle: posting?.roleTitle ?? "Dev case",
    matchScore: score,
    stage: "Screened",
    // d95fed6d — origin marker: the drawer says "via dev case" and links back.
    sourceChannel: "devcase",
  });
  // Suspect authenticity overrides a strong score down to "hold" — verify
  // authorship live before advancing.
  const recommendation = score >= 70 && !suspectAuth ? "advance" : "hold";
  const redFlags = [...((evaluation.concerns as string[]) ?? [])];
  if (suspectAuth) {
    redFlags.unshift(
      `Process-authenticity is suspect (${bundle.authenticity?.score ?? 0}/100) — verify the candidate authored this before advancing.`
    );
  }
  setApproval(
    entry.id,
    "screening_review",
    JSON.stringify({
      recommendation,
      confidence: score,
      rationale: `${String(evaluation.summary ?? "")} ${String(transfer.roleFitRationale ?? "")}`.trim() || "Dev-case evaluation.",
      strengths: (evaluation.strengths as string[]) ?? [],
      redFlags,
    })
  );
  recordAutomationEvent(entry.id, "screening_hold", "promoted from dev case");
  return entry.id;
}
