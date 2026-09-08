import { writeFile } from "node:fs/promises";
import path from "node:path";
import { MAX_CODEBASES } from "./devcase-constraints";
import { runDevcaseCli } from "./devcase-run-cli";
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
  // JD-first intake: the saved job description the need was built from. jdText is
  // the PRIMARY statement of the need — stack/responsibilities may be empty, the
  // analyze step extracts them from the JD body.
  jdSlug?: string;
  jdText?: string;
  // Role-intake grading (UAT L1-EVA-3): the promoted brief's graded dealbreakers
  // (kind × hardness × weight), when the need descends from an intake. Role
  // design anchors mustHaves to these (devcase/models.py::StatedRequirement).
  statedRequirements?: { skill: string; kind: string; hardness: string; weight: number }[];
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

export type DesignArtifactsResult = {
  role: Record<string, unknown>;
  case: Record<string, unknown>;
  source: string;
  perStepSources: Record<string, string>; // {role, case}
  fallbackReason: Record<string, string>; // {step: "<ExceptionType>: <message>"} for steps whose LLM call raised
};

export type InterviewScenarioResult = {
  scenario: Record<string, unknown>;
  source: string;
  perStepSources: Record<string, string>; // {scenario}
  fallbackReason: Record<string, string>; // {scenario: "<ExceptionType>: <message>"} — only when the LLM call raised
};

export type SeedMaterializeResult = {
  seed: Record<string, unknown>; // {files: [{path, contents}], note, promptVersion}
  source: string;
  perStepSources: Record<string, string>; // {seed}
  fallbackReason: Record<string, string>; // {seed: "<ExceptionType>: <message>"} — only when the LLM call raised
};

// D2 core: pull the real codebase(s), then reflect the need against them (LLM + fallback).
// `lang` (#6) writes the analysis free-text in the JD language so the downstream
// role/case design reads a language-consistent artifact; defaults to en (the
// analysis is internal, so callers that don't care can omit it).
export async function runNeedAnalysis(need: DevNeed, signal?: AbortSignal, lang?: string | null): Promise<NeedAnalysisResult> {
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
      const args = ["analyze-need", "--need-json", needPath, "--lang", lang || "en"];
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

// D3 core: design a RoleSpec + a CaseScenario (covert tooling-probes) from the need + analysis.
// `feedback` (W5-4) is the human reviewer's revision note from the approval gate — the
// redesign honors it instead of forcing a full lifecycle re-run from intake.
export async function runDesignArtifacts(
  need: DevNeed,
  analysis: Record<string, unknown>,
  signal?: AbortSignal,
  feedback?: string,
  lang?: string | null,
  // withCase=false skips the case-design LLM call (`--role-only`) and returns
  // `case: {}`. The JD builder passes false when "Case analysis" isn't ticked, so
  // a description-only build no longer pays for a case it discards. All other
  // callers (lifecycle, redesign) keep the default and always get a real case.
  withCase: boolean = true
): Promise<DesignArtifactsResult> {
  const payload = await runDevcaseCli<{ result: { role: Record<string, unknown>; case?: Record<string, unknown> }; source: string; perStepSources?: Record<string, string>; fallbackReason?: Record<string, string> }>(
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
        ...(withCase ? [] : ["--role-only"]),
        ...(feedback && feedback.trim() ? ["--feedback", feedback.trim()] : []),
      ];
    },
    signal,
  );
  return { role: payload.result.role, case: payload.result.case ?? {}, source: payload.source, perStepSources: payload.perStepSources ?? {}, fallbackReason: payload.fallbackReason ?? {} };
}

/** Case → AI-interview scenario: instantiate the six-phase early-career script
 *  from the approved case (devcase/interview_scenario.py). Generated once per
 *  ROLE and reused for every candidate, so interview ratings stay comparable. */
export async function runInterviewScenario(
  kase: Record<string, unknown>,
  role: Record<string, unknown>,
  lang?: string | null
): Promise<InterviewScenarioResult> {
  const payload = await runDevcaseCli<{ result: { scenario: Record<string, unknown> }; source: string; perStepSources?: Record<string, string>; fallbackReason?: Record<string, string> }>(
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
  return { scenario: payload.result.scenario, source: payload.source, perStepSources: payload.perStepSources ?? {}, fallbackReason: payload.fallbackReason ?? {} };
}

/** Case -> materialized seed: turn the case's prose starting materials into a
 *  concrete starter file tree (devcase/seed_materializer.py). One seed per CASE,
 *  identical for every candidate, so the take-home submission becomes a diff
 *  against shared ground truth instead of GPT-gradeable prose. */
export async function runMaterializeSeed(
  kase: Record<string, unknown>,
  role: Record<string, unknown>,
  lang?: string | null
): Promise<SeedMaterializeResult> {
  const payload = await runDevcaseCli<{ result: { seed: Record<string, unknown> }; source: string; perStepSources?: Record<string, string>; fallbackReason?: Record<string, string> }>(
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
  return { seed: payload.result.seed, source: payload.source, perStepSources: payload.perStepSources ?? {}, fallbackReason: payload.fallbackReason ?? {} };
}
