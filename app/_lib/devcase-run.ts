import { writeFile } from "node:fs/promises";
import path from "node:path";
import { getDevCase, getPosting, getSubmission, saveSubmissionEvaluation } from "./db";
import { cleanupWorkdir, createWorkdir, parseStderrError, spawnPython } from "./python-runner";
import { buildRepoSnapshot, fetchCommitTrace, type RepoSnapshot } from "./repo-snapshot";

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
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      throw new Error(err.message);
    }
    const payload = JSON.parse(stdout) as { result: Record<string, unknown>; source: string };
    return { analysis: payload.result, snapshot, source: payload.source };
  } finally {
    await cleanupWorkdir(workdir);
  }
}

export type DesignArtifactsResult = {
  role: Record<string, unknown>;
  case: Record<string, unknown>;
  source: string;
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
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      throw new Error(err.message);
    }
    const payload = JSON.parse(stdout) as { result: { role: Record<string, unknown>; case: Record<string, unknown> }; source: string };
    return { role: payload.result.role, case: payload.result.case, source: payload.source };
  } finally {
    await cleanupWorkdir(workdir);
  }
}

export type CommitReflectionResult = {
  reflection: Record<string, unknown>;
  tooling: Record<string, unknown>;
  source: string;
  commitCount: number;
};

// D5 core: pull the submission repo's git trace, then reflect ("where they mentally
// went") + assess tooling against the case's covert probes.
export async function runCommitReflection(repoRef: string, caseId?: string): Promise<CommitReflectionResult> {
  const trace = (await fetchCommitTrace(repoRef)) ?? [];
  const devCase = caseId ? getDevCase(caseId) : null;
  const probes = ((devCase?.case as { coverProbes?: unknown[] } | null)?.coverProbes ?? []) as unknown[];

  const workdir = await createWorkdir();
  try {
    const commitsPath = path.join(workdir, "commits.json");
    const probesPath = path.join(workdir, "probes.json");
    await writeFile(commitsPath, JSON.stringify(trace), "utf-8");
    await writeFile(probesPath, JSON.stringify(probes), "utf-8");
    const { result } = spawnPython([
      "-m",
      "pipeline.jobfit.devcase.devcase_cli",
      "reflect-commits",
      "--commits-json",
      commitsPath,
      "--probes-json",
      probesPath,
    ]);
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      throw new Error(err.message);
    }
    const payload = JSON.parse(stdout) as { result: { reflection: Record<string, unknown>; tooling: Record<string, unknown> }; source: string };
    return { reflection: payload.result.reflection, tooling: payload.result.tooling, source: payload.source, commitCount: trace.length };
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
  const trace = (await fetchCommitTrace(sub.repoRef)) ?? [];

  const workdir = await createWorkdir();
  try {
    const write = async (name: string, data: unknown) => {
      const fp = path.join(workdir, name);
      await writeFile(fp, JSON.stringify(data), "utf-8");
      return fp;
    };
    const commitsPath = await write("commits.json", trace);
    const probesPath = await write("probes.json", probes);
    const casePath = await write("case.json", caseObj);
    const rolePath = await write("role.json", roleObj);

    const { result } = spawnPython([
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
    ]);
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      throw new Error(err.message);
    }
    const payload = JSON.parse(stdout) as {
      result: { reflection: Record<string, unknown>; tooling: Record<string, unknown>; evaluation: Record<string, unknown>; transfer: Record<string, unknown> };
      source: string;
    };
    const out = { ...payload.result, source: payload.source, commitCount: trace.length };
    const transferScore = Number((payload.result.transfer as { transferScore?: number }).transferScore ?? 0);
    saveSubmissionEvaluation(submissionId, out, transferScore);
    return out;
  } finally {
    await cleanupWorkdir(workdir);
  }
}
