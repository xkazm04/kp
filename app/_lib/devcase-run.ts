import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPipelineEntry,
  getDevCase,
  getPosting,
  getSubmission,
  listMatrixProfiles,
  recordAutomationEvent,
  saveSubmissionEvaluation,
  setApproval,
} from "./db";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, PipelineError, spawnPython } from "./python-runner";
import { buildRepoSnapshot, fetchRepoSignals, type RepoSnapshot } from "./repo-snapshot";

export type DevNeed = {
  id?: string;
  title?: string;
  stack?: string[];
  responsibilities?: string[];
  codebaseRefs?: { kind: string; ref: string; label?: string }[];
  seniorityTarget?: string;
  roleFamily?: string;
  notes?: string;
};

export type NeedAnalysisResult = {
  analysis: Record<string, unknown>;
  snapshot: RepoSnapshot | null;
  source: string;
  // Per-step provenance ({step: "llm"|"deterministic"}) from the uniform CLI
  // envelope — single-step here ({analyze}), but typed the same across the
  // pipeline so one provenance strip renders every command.
  perStepSources: Record<string, string>;
};

// D2 core: pull the real codebase, then reflect the need against it (LLM + fallback).
export async function runNeedAnalysis(need: DevNeed): Promise<NeedAnalysisResult> {
  const ghRef = (need.codebaseRefs ?? []).find((r) => r.kind === "github" || /github\.com/.test(r.ref));
  const snapshot = ghRef ? await buildRepoSnapshot(ghRef.ref) : null;

  const workdir = await createWorkdir();
  try {
    const needPath = path.join(workdir, "need.json");
    await writeFile(needPath, JSON.stringify(need), "utf-8");
    const args = ["-m", "pipeline.jobfit.devcase.devcase_cli", "analyze-need", "--need-json", needPath];
    if (snapshot) {
      const snapPath = path.join(workdir, "snapshot.json");
      await writeFile(snapPath, JSON.stringify(snapshot), "utf-8");
      args.push("--snapshot-json", snapPath);
    }
    const { result } = spawnPython(args);
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) throw new PipelineError(parseStderrError(stderr, exitCode));
    const payload = parsePythonJson<{ result: Record<string, unknown>; source: string; perStepSources?: Record<string, string> }>(stdout, stderr);
    return { analysis: payload.result, snapshot, source: payload.source, perStepSources: payload.perStepSources ?? {} };
  } finally {
    await cleanupWorkdir(workdir);
  }
}

export type DesignArtifactsResult = {
  role: Record<string, unknown>;
  case: Record<string, unknown>;
  source: string;
  perStepSources: Record<string, string>; // {role, case}
};

// D3 core: design a RoleSpec + a CaseScenario (covert tooling-probes) from the need + analysis.
export async function runDesignArtifacts(need: DevNeed, analysis: Record<string, unknown>): Promise<DesignArtifactsResult> {
  const workdir = await createWorkdir();
  try {
    const needPath = path.join(workdir, "need.json");
    const analysisPath = path.join(workdir, "analysis.json");
    await writeFile(needPath, JSON.stringify(need), "utf-8");
    await writeFile(analysisPath, JSON.stringify(analysis), "utf-8");
    const { result } = spawnPython([
      "-m",
      "pipeline.jobfit.devcase.devcase_cli",
      "design-artifacts",
      "--need-json",
      needPath,
      "--analysis-json",
      analysisPath,
    ]);
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) throw new PipelineError(parseStderrError(stderr, exitCode));
    const payload = parsePythonJson<{ result: { role: Record<string, unknown>; case: Record<string, unknown> }; source: string; perStepSources?: Record<string, string> }>(stdout, stderr);
    return { role: payload.result.role, case: payload.result.case, source: payload.source, perStepSources: payload.perStepSources ?? {} };
  } finally {
    await cleanupWorkdir(workdir);
  }
}

export type CommitReflectionResult = {
  reflection: Record<string, unknown>;
  tooling: Record<string, unknown>;
  source: string;
  perStepSources: Record<string, string>; // {reflect, tooling}
  commitCount: number;
};

// D5 core: pull the submission repo's git trace, then reflect ("where they mentally
// went") + assess tooling against the case's covert probes.
export async function runCommitReflection(repoRef: string, caseId?: string): Promise<CommitReflectionResult> {
  const signals = await fetchRepoSignals(repoRef);
  const commits = signals?.commits ?? [];
  const repo = signals ? { cadence: signals.cadence, topLevel: signals.topLevel } : null;
  const devCase = caseId ? getDevCase(caseId) : null;
  const probes = ((devCase?.case as { coverProbes?: unknown[] } | null)?.coverProbes ?? []) as unknown[];

  const workdir = await createWorkdir();
  try {
    const commitsPath = path.join(workdir, "commits.json");
    const probesPath = path.join(workdir, "probes.json");
    await writeFile(commitsPath, JSON.stringify(commits), "utf-8");
    await writeFile(probesPath, JSON.stringify(probes), "utf-8");
    const args = ["-m", "pipeline.jobfit.devcase.devcase_cli", "reflect-commits", "--commits-json", commitsPath, "--probes-json", probesPath];
    if (repo) {
      const repoPath = path.join(workdir, "repo.json");
      await writeFile(repoPath, JSON.stringify(repo), "utf-8");
      args.push("--repo-json", repoPath);
    }
    const { result } = spawnPython(args);
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) throw new PipelineError(parseStderrError(stderr, exitCode));
    const payload = parsePythonJson<{ result: { reflection: Record<string, unknown>; tooling: Record<string, unknown> }; source: string; perStepSources?: Record<string, string> }>(stdout, stderr);
    return { reflection: payload.result.reflection, tooling: payload.result.tooling, source: payload.source, perStepSources: payload.perStepSources ?? {}, commitCount: commits.length };
  } finally {
    await cleanupWorkdir(workdir);
  }
}

export type SubmissionEvaluation = {
  reflection: Record<string, unknown>;
  tooling: Record<string, unknown>;
  evaluation: Record<string, unknown>;
  transfer: Record<string, unknown>;
  source: string;
  perStepSources: Record<string, string>; // {reflect, tooling, evaluate, transfer}
  commitCount: number;
};

// D6 core: the full incoming-evaluation chain for one submission — trace -> reflect +
// tooling -> CaseEvaluation -> TransferAssessment. Persists the result on the submission.
export async function runEvaluateSubmission(submissionId: string): Promise<SubmissionEvaluation> {
  const sub = getSubmission(submissionId);
  if (!sub) throw new Error("submission not found");
  if (!sub.repoRef) throw new Error("submission has no repo");
  const posting = sub.postingId ? getPosting(sub.postingId) : null;
  const devCase = posting?.caseId ? getDevCase(posting.caseId) : null;
  const caseObj = (devCase?.case as Record<string, unknown>) ?? {};
  const roleObj = (devCase?.role as Record<string, unknown>) ?? {};
  const probes = (caseObj.coverProbes as unknown[]) ?? [];
  const signals = await fetchRepoSignals(sub.repoRef);
  const commits = signals?.commits ?? [];
  const repo = signals ? { cadence: signals.cadence, topLevel: signals.topLevel } : null;

  const workdir = await createWorkdir();
  try {
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
      "-m",
      "pipeline.jobfit.devcase.devcase_cli",
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

    const { result } = spawnPython(args);
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) throw new PipelineError(parseStderrError(stderr, exitCode));
    const payload = parsePythonJson<{
      result: { reflection: Record<string, unknown>; tooling: Record<string, unknown>; evaluation: Record<string, unknown>; transfer: Record<string, unknown> };
      source: string;
      perStepSources?: Record<string, string>;
    }>(stdout, stderr);
    const out = { ...payload.result, source: payload.source, perStepSources: payload.perStepSources ?? {}, commitCount: commits.length };
    const transferScore = Number((payload.result.transfer as { transferScore?: number } | null | undefined ?? {}).transferScore ?? 0);
    saveSubmissionEvaluation(submissionId, out, transferScore);
    return out;
  } finally {
    await cleanupWorkdir(workdir);
  }
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
export async function runSourceForRole(role: Record<string, unknown>, topN = 8, floor = 45): Promise<SourceOutcome> {
  const profiles = listMatrixProfiles();
  if (profiles.length === 0) return { candidates: [], skipped: 0, skippedReasons: [] };
  const workdir = await createWorkdir();
  try {
    const rolePath = path.join(workdir, "role.json");
    const candsPath = path.join(workdir, "cands.json");
    await writeFile(rolePath, JSON.stringify(role), "utf-8");
    await writeFile(candsPath, JSON.stringify(profiles), "utf-8");
    const { result } = spawnPython([
      "-m",
      "pipeline.jobfit.devcase.devcase_cli",
      "source",
      "--role-json",
      rolePath,
      "--candidates-json",
      candsPath,
      "--top-n",
      String(topN),
      "--floor",
      String(floor),
    ]);
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) throw new PipelineError(parseStderrError(stderr, exitCode));
    const payload = parsePythonJson<{ result: SourceOutcome }>(stdout, stderr);
    const r = payload.result;
    return { candidates: r?.candidates ?? [], skipped: r?.skipped ?? 0, skippedReasons: r?.skippedReasons ?? [] };
  } finally {
    await cleanupWorkdir(workdir);
  }
}

// Bridge an evaluated submission into the pipeline + a Decisions screening_review card.
// Shared by /api/devcase/promote and the lifecycle orchestrator. Returns the entry id, or
// null if the submission isn't evaluated yet.
export function promoteSubmission(submissionId: string): string | null {
  const sub = getSubmission(submissionId);
  if (!sub || !sub.evaluation) return null;
  const bundle = sub.evaluation as { evaluation?: Record<string, unknown>; transfer?: Record<string, unknown> };
  const evaluation = bundle.evaluation ?? {};
  const transfer = bundle.transfer ?? {};
  const score = sub.transferScore ?? Number(transfer.transferScore ?? 0);
  const posting = sub.postingId ? getPosting(sub.postingId) : null;

  const { entry } = createPipelineEntry({
    candidateId: `ds-${sub.id}`,
    candidateLabel: sub.candidateRef ?? "Candidate",
    archetype: "bau",
    roleFamily: "software_engineering",
    jobId: `dc-${posting?.caseId ?? "case"}`,
    jobTitle: posting?.roleTitle ?? "Dev case",
    matchScore: score,
    stage: "Screened",
  });
  const recommendation = score >= 70 ? "advance" : "hold";
  setApproval(
    entry.id,
    "screening_review",
    JSON.stringify({
      recommendation,
      confidence: score,
      rationale: `${String(evaluation.summary ?? "")} ${String(transfer.roleFitRationale ?? "")}`.trim() || "Dev-case evaluation.",
      strengths: (evaluation.strengths as string[]) ?? [],
      redFlags: (evaluation.concerns as string[]) ?? [],
    })
  );
  recordAutomationEvent(entry.id, "screening_hold", "promoted from dev case");
  return entry.id;
}
