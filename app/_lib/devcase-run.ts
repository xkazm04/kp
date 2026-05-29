import { writeFile } from "node:fs/promises";
import path from "node:path";
import { cleanupWorkdir, createWorkdir, parseStderrError, spawnPython } from "./python-runner";
import { buildRepoSnapshot, type RepoSnapshot } from "./repo-snapshot";

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
