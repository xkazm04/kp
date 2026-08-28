import { writeFile } from "node:fs/promises";
import path from "node:path";
import { getDevCase, getDevCaseBaseline, getDevSession, getDevSessionChat, getDevSessionEvents, getDevSessionIntegrity, getPosting, getSubmission, lifecycleByPosting, saveSubmissionEvaluation, type DevSubmission, type SessionIntegrity } from "./db/devcase";
import { createPipelineEntry, getPipelineEntry, recordAutomationEvent, setApproval } from "./db/pipeline";
import { getProfileRecord, listMatrixProfiles, listProfileRecords, updateProfile } from "./db/profiles";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { inferProfileLocale } from "./comms-locale";
import { MAX_CODEBASES } from "./devcase-constraints";
import { scoreAuthenticity, PASTE_BULK_CHARS, type Authenticity } from "./devcase-authenticity";
import { changedPathsFromFiles, seedDiffEvidence, type SeedDiff } from "./devcase-seed-diff";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, PipelineError, spawnPython } from "./python-runner";
import { buildLlmConfigEnv } from "./llm-config";
import { buildRepoSnapshot, fetchRepoSignals, type RepoSnapshot } from "./repo-snapshot";
import { isEarlyCareer } from "./archetypes";
import { devCaseIdForEntry } from "./devcase-identity";

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
    // Route the devcase LLM steps (analyze-need, design-artifacts) through the
    // workspace Models config so model/max-tokens/timeout are configurable — same
    // wiring automation-run/reasoning-run use. `{}` when nothing is configured
    // (Python then defaults to the Claude CLI, unchanged).
    const { result } = spawnPython(["-m", "pipeline.jobfit.devcase.devcase_cli", ...args], { signal, env: buildLlmConfigEnv() });
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

export type InterviewScenarioResult = {
  scenario: Record<string, unknown>;
  source: string;
  perStepSources: Record<string, string>; // {scenario}
  fallbackReason: Record<string, string>; // {scenario: "<ExceptionType>: <message>"} — only when the LLM call raised
};

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

export type SeedMaterializeResult = {
  seed: Record<string, unknown>; // {files: [{path, contents}], note, promptVersion}
  source: string;
  perStepSources: Record<string, string>; // {seed}
  fallbackReason: Record<string, string>; // {seed: "<ExceptionType>: <message>"} — only when the LLM call raised
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

export type SessionChatResult = {
  reply: string;
  source: string;
};

/** One in-session assistant/stakeholder reply (LLM-era controls #2/#5). The
 *  transcript + message flow through the platform so the candidate's prompts are
 *  captured evidence; the reply persona lives in devcase/chat.py. */
export async function runSessionChat(
  channel: "assistant" | "stakeholder",
  kase: Record<string, unknown>,
  role: Record<string, unknown>,
  transcript: { channel: string; role: string; text: string }[],
  message: string,
  currentFile?: { path: string; contents: string } | null,
  lang?: string | null,
  signal?: AbortSignal
): Promise<SessionChatResult> {
  const payload = await runDevcaseCli<{ result: { reply?: { reply?: string } }; source: string }>(
    async (workdir) => {
      const write = async (name: string, data: unknown) => {
        const fp = path.join(workdir, name);
        await writeFile(fp, JSON.stringify(data), "utf-8");
        return fp;
      };
      const args = [
        "session-chat",
        "--case-json",
        await write("case.json", kase),
        "--role-json",
        await write("role.json", role),
        "--channel",
        channel,
        "--message",
        message,
        "--lang",
        lang || "en",
      ];
      if (transcript.length > 0) args.push("--chat-json", await write("chat.json", transcript));
      if (currentFile) args.push("--current-file-json", await write("current.json", currentFile));
      return args;
    },
    signal,
  );
  return { reply: String(payload.result.reply?.reply ?? ""), source: payload.source };
}

export type BaselineSolveResult = {
  baseline: Record<string, unknown>; // {solutions: [{files, note}], promptVersion}
  source: string;
};

/** One-shot naive-LLM baseline solve (LLM-era controls #6) — run at freeze time
 *  beside the seed, persisted per case as the comparison target for every
 *  submission's "what did the human add beyond the bare model?". */
export async function runBaselineSolve(
  kase: Record<string, unknown>,
  role: Record<string, unknown>,
  seed: Record<string, unknown> | null
): Promise<BaselineSolveResult> {
  const payload = await runDevcaseCli<{ result: { baseline: Record<string, unknown> }; source: string }>(
    async (workdir) => {
      const write = async (name: string, data: unknown) => {
        const fp = path.join(workdir, name);
        await writeFile(fp, JSON.stringify(data), "utf-8");
        return fp;
      };
      const args = ["baseline-solve", "--case-json", await write("case.json", kase), "--role-json", await write("role.json", role)];
      if (seed) args.push("--seed-json", await write("seed.json", seed));
      return args;
    },
  );
  return { baseline: payload.result.baseline, source: payload.source };
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
  scorecard: Record<string, unknown>,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Promise<ObservedMintResult> {
  const entry = getPipelineEntry(entryId, workspaceId);
  if (!entry || !entry.candidateId || !isEarlyCareer(entry.archetype)) return { credited: [], applied: false };
  const caseId = devCaseIdForEntry(entry);
  const devCase = caseId ? getDevCase(caseId) : null;
  if (!devCase?.scenario || !devCase.case || !devCase.role) return { credited: [], applied: false };
  const rec = getProfileRecord(entry.candidateId, workspaceId);
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
  }, workspaceId);
  recordAutomationEvent(entryId, "observed_minted", credited.join(", "), workspaceId);
  return { credited, applied: true };
}

/** A submission carries only a free-text candidateRef — resolve it to a saved
 *  profile honestly: an exact profile-record id wins; otherwise a UNIQUE
 *  case-insensitive label match. Ambiguous or unknown refs resolve to null (mint
 *  nothing) — observed evidence must never land on the wrong person's profile. */
// Both lookups run in the SUBMISSION's own team. Unscoped they searched the
// default tenant, so on any other workspace the by-id read missed and the
// by-label fallback scanned another team's roster — either failing to find a real
// profile, or (worse) resolving to a same-named person in a different company and
// then writing observed skills onto THAT profile.
function profileForSubmission(sub: DevSubmission): NonNullable<ReturnType<typeof getProfileRecord>> | null {
  const ref = (sub.candidateRef ?? "").trim();
  if (!ref) return null;
  const byId = getProfileRecord(ref, sub.workspaceId);
  if (byId) return byId;
  const needle = ref.toLowerCase();
  const matches = listProfileRecords(undefined, sub.workspaceId).filter(
    (p) => (p.row.label ?? "").trim().toLowerCase() === needle
  );
  return matches.length === 1 ? matches[0] : null;
}

/** The take-home twin of mintObservedFromCaseInterview: after a submission is
 *  PROMOTED, run the deterministic transfer gate (live_case.apply_live_case via
 *  `devcase_cli observed-skills`) and — when earned — persist the enriched
 *  profile, so the candidate's next match credits the demonstrated skills at
 *  observed provenance (confidence capped 0.95, the deepest read we have).
 *
 *  Quietly returns {applied: false} unless every precondition holds: an evaluated
 *  submission whose process-authenticity is not SUSPECT (the same doubt that makes
 *  promoteSubmission hold it), on a posting whose dev case carries its role + case,
 *  AND a candidateRef that resolves unambiguously to a saved profile. The
 *  competence bar itself (transfer_score >= 65) and the evidence-confidence floor
 *  live in Python with the rest of the scoring contract. */
export async function mintObservedFromSubmission(
  submissionId: string,
  entryId?: string | null
): Promise<ObservedMintResult> {
  const sub = getSubmission(submissionId);
  const bundle = (sub?.evaluation ?? null) as {
    evaluation?: Record<string, unknown>;
    transfer?: Record<string, unknown>;
    authenticity?: { band?: string };
  } | null;
  if (!sub || !bundle?.evaluation || !bundle?.transfer) return { credited: [], applied: false };
  // ce28da40 — PROMOTE PARITY. promoteSubmission HOLDS a suspect-authenticity
  // submission because we cannot tell the candidate authored it (a bulk paste into
  // the watched editor, or an event log whose hash chain provably broke). The same
  // doubt has to block this write, and it is the more consequential of the two: a
  // hold is a decision about THIS posting that a human resolves, while observed
  // provenance is permanent and global — taxonomy weight 1.0, confidence up to
  // 0.95, plus an early-career routing lift — so every FUTURE match for this person
  // would be scored on evidence the promote gate just refused to act on. Both
  // callers (the orchestrator's ranked stage and /api/devcase/promote) mint
  // unconditionally after promoting, so the gate belongs here rather than at either
  // door. Python cannot make this call: authenticity is computed on this side
  // (devcase-authenticity.ts) and apply_live_case only ever sees the transfer score
  // and its propagated confidence. Held, not lost — re-promoting mints normally
  // once a human has verified authorship and cleared the band.
  if (bundle.authenticity?.band === "suspect") return { credited: [], applied: false };
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
  // The profile was resolved in the submission's team (profileForSubmission), so
  // the write must target the same one — otherwise the update silently matches no
  // row and the demonstrated skills are never credited.
  updateProfile(
    rec.row.id,
    {
      label: (profile.displayName as string) || rec.row.label,
      archetype: (profile.archetype as string) ?? rec.row.archetype,
      roleFamily: (profile.roleFamily as string) ?? rec.row.role_family,
      completeness: typeof profile.completeness === "number" ? profile.completeness : rec.row.completeness,
      payload: profile,
    },
    sub.workspaceId
  );
  if (entryId) recordAutomationEvent(entryId, "observed_minted", credited.join(", "), sub.workspaceId);
  return { credited, applied: true };
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
  // LLM-era controls #1 — tamper-evidence verdict on the observed event log (hash
  // chain + client-clock consistency + watermark). null for repo submissions.
  integrity: SessionIntegrity | null;
  // LLM-era controls #2/#3/#6 — the mechanical observed-check verdicts persisted
  // beside the LLM interpretation ({} when the submission had no observed inputs).
  observedChecks?: Record<string, unknown>;
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
  let signals: Awaited<ReturnType<typeof fetchRepoSignals>> = null;
  let events: { t: number; kind: string; path?: string | null; size?: number | null }[] | null = null;
  // LLM-era controls #1 — tamper-evidence verdict on the observed log itself,
  // computed server-side (hash chain + client-clock consistency + watermark scan)
  // before anything downstream trusts the events.
  let integrity: SessionIntegrity | null = null;
  // LLM-era controls #2/#3/#6 — observed-evidence inputs available only for live
  // sessions: the submitted file tree, the captured chat transcript, and the frozen
  // internal seed (canaries) + one-shot baseline to check them against.
  let sessionFiles: { path: string; contents: string }[] | null = null;
  let chatTranscript: { channel: string; role: string; text: string }[] | null = null;
  if (sub.repoRef.startsWith("session:")) {
    const sessionId = sub.repoRef.slice("session:".length);
    events = getDevSessionEvents(sessionId);
    integrity = getDevSessionIntegrity(sessionId);
    sessionFiles = getDevSession(sessionId)?.files ?? null;
    const chat = getDevSessionChat(sessionId);
    chatTranscript = chat.length > 0 ? chat.map((m) => ({ channel: m.channel, role: m.role, text: m.text })) : null;
  } else {
    signals = await fetchRepoSignals(sub.repoRef);
  }
  const caseBaseline = devCase ? getDevCaseBaseline(devCase.id) : null;
  const commits = signals?.commits ?? [];
  const repo = signals ? { cadence: signals.cadence, topLevel: signals.topLevel } : null;

  const payload = await runDevcaseCli<{
    result: {
      reflection: Record<string, unknown>;
      tooling: Record<string, unknown>;
      evaluation: Record<string, unknown>;
      transfer: Record<string, unknown>;
      followups?: Record<string, unknown>;
      // Mechanical observed-check verdicts (canaries, prompt signals, baseline
      // distance) — {} when no observed inputs were available.
      observedChecks?: Record<string, unknown>;
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
      // Observed-evidence inputs (LLM-era controls): each optional and independent —
      // the Python side quietly no-ops on whatever is absent.
      if (chatTranscript) args.push("--chat-json", await write("chat.json", chatTranscript));
      if (sessionFiles && sessionFiles.length > 0) args.push("--files-json", await write("files.json", sessionFiles));
      if (devCase?.seed) args.push("--seed-json", await write("seed.json", devCase.seed));
      if (caseBaseline) args.push("--baseline-json", await write("baseline.json", caseBaseline));
      return args;
    },
    signal,
  );
  // Raw process signals, not interpretation: did they actually keep the forced
  // DECISIONS log (case-design v4's authorship contract), how many commits, what
  // cadence. Persisted so the decisions-log contract is checkable later instead
  // of taken on faith from the narrative.
  // Moonshot E — a live-session submission has no git history, so derive its trace
  // from the OBSERVED event stream instead of the (null) git signals: the DECISIONS
  // log is present if any decision_log event fired or a DECISIONS-named file was
  // touched. Previously decisionsLogPresent read only signals.topLevel (always empty
  // for a session) → it always read false and, with commitCount 0, the authenticity
  // score docked the watched submission to "mixed". `observed` waives the
  // no-commit-history penalty downstream.
  const observed = events !== null;
  const processTrace = {
    commitCount: commits.length,
    cadence: signals?.cadence ?? null,
    decisionsLogPresent: observed
      ? events!.some((e) => e.kind === "decision_log" || (e.path != null && /decision/i.test(e.path)))
      : (signals?.topLevel ?? []).some((f) => /decision/i.test(f.name)),
  };
  // ce28da40 — fold the trace + reflection into one authenticity verdict.
  const reflection = (payload.result.reflection ?? {}) as { readBeforeWrite?: number; iterationPattern?: string };
  // Paste-from-LLM tell for observed sessions: a single bulk paste at/over the
  // threshold landed in the watched editor (the live surface waives commit penalties,
  // so without this a pasted solution scored "authentic").
  const observedBulkPaste = observed && events!.some((e) => e.kind === "paste" && (e.size ?? 0) >= PASTE_BULK_CHARS);
  // Integrity is compromised when the hash chain provably broke (valid === false —
  // null means "legacy/unverifiable", which is not evidence of tampering), any
  // client timestamp contradicted its server receive window, or a FOREIGN session's
  // watermark surfaced in the submitted tree (a circulated/relayed solution). A
  // merely-missing own watermark is deliberately NOT here — deleting a line is not
  // proof of anything.
  const integrityCompromised =
    integrity != null &&
    (integrity.chain.valid === false || integrity.backdatedEvents > 0 || integrity.watermark.foreign.length > 0);
  const authenticity = scoreAuthenticity({
    commitCount: processTrace.commitCount,
    bursty: processTrace.cadence?.bursty ?? null,
    spanHours: processTrace.cadence?.spanHours ?? null,
    decisionsLogPresent: processTrace.decisionsLogPresent,
    readBeforeWrite: reflection.readBeforeWrite ?? null,
    iterationPattern: reflection.iterationPattern ?? null,
    observed,
    observedBulkPaste,
    integrityCompromised,
  });
  // c364a44d — anchor the evaluation into the shared seed: which planted seam
  // files did the submission actually touch? Grounded, mechanically comparable
  // engagement evidence beside the LLM's probe read.
  const seedFiles = ((devCase?.seed as { files?: { path?: string; contents?: string }[] } | null)?.files) ?? [];
  // Both submission paths now produce seed engagement, from the change set each one
  // actually has: the repo path from the commits API's changed paths, the Live Work
  // Surface from a CONTENT diff of the submitted tree against the seed. Previously
  // only `signals.changedPaths` was consulted, and `signals` is null for a session —
  // so the strip never rendered for the path with the strongest evidence, and an
  // absent strip reads as "they engaged nothing".
  const changedPaths =
    signals?.changedPaths?.length
      ? signals.changedPaths
      : sessionFiles && sessionFiles.length > 0
        ? changedPathsFromFiles(seedFiles, sessionFiles)
        : [];
  const seedDiff = seedFiles.length > 0 && changedPaths.length > 0 ? seedDiffEvidence(seedFiles, changedPaths) : null;
  const out = {
    ...payload.result,
    followups: payload.result.followups ?? {},
    processTrace,
    authenticity,
    seedDiff,
    integrity,
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
  // `workspaceId` is the team whose candidate pool is ranked. It is REQUIRED in
  // practice: an omitted one ranked the DEFAULT team's profiles, and the caller
  // then filed those matches under its own workspace — copying another tenant's
  // real people (name, id, archetype, score) onto this team's board. Optional only
  // so the signature stays compatible with the store default everywhere else.
  { topN = 8, floor = 45, signal, workspaceId }: { topN?: number; floor?: number; signal?: AbortSignal; workspaceId?: string } = {},
): Promise<SourceOutcome> {
  const profiles = listMatrixProfiles(undefined, workspaceId);
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

// Seed the pipeline from a sourcing run's ranked matches — the SINGLE owner of the
// "case-sourced candidate → Accepted pipeline entry" write contract, INCLUDING the
// `sourceChannel: "devcase"` origin marker (d95fed6d). Used by both the lifecycle
// orchestrator's publish step and the manual /api/devcase/source route, so a
// candidate gets the same origin tag regardless of which path sourced them — the
// route previously omitted the marker, so "Source DB" candidates silently lost
// their "via dev case" attribution in the pipeline drawer. Skips matches without a
// candidateId; returns the number of pipeline entries created.
export function seedPipelineFromMatches(
  matches: readonly Sourced[],
  // `workspaceId` must be the SAME team runSourceForRole ranked. Passing one here
  // while omitting it there is the dangerous half-fix: the entries land correctly
  // but the people in them belong to another tenant.
  opts: { caseId: string | null; roleTitle: string; workspaceId?: string },
): { added: number } {
  let added = 0;
  for (const m of matches) {
    if (!m.candidateId) continue;
    createPipelineEntry({
      candidateId: m.candidateId,
      candidateLabel: m.label,
      archetype: m.archetype,
      roleFamily: "software_engineering",
      jobId: `dc-${opts.caseId}`,
      jobTitle: opts.roleTitle,
      matchScore: m.score,
      stage: "Accepted",
      // d95fed6d — origin marker for case-sourced candidates.
      sourceChannel: "devcase",
      // Case-sourced candidates come from saved profiles — infer their comms
      // language from the CV languages (backlog #34); NULL resolves to the
      // workspace default at dispatch. Scoped, or the profile read misses on any
      // other team and every entry is stamped locale:null.
      locale: inferProfileLocale(m.candidateId, opts.workspaceId),
      workspaceId: opts.workspaceId,
    });
    added += 1;
  }
  return { added };
}

// The evidence-confidence floor for auto-advance advice — mirrors the Python
// confidence scale's LOW_CONFIDENCE (pipeline/jobfit/devcase/models.py): at or
// below this the evaluation rests on thin/deterministic-fallback evidence.
const LOW_EVAL_CONFIDENCE = 0.4;

export type PromoteResult = {
  entryId: string;
  // The SAME advance/hold verdict written onto the screening_review card, surfaced
  // to every caller so nothing downstream (a candidate-facing comm, an audit row)
  // re-derives a threshold in a second place and drifts from this one. "hold"
  // means a human must verify before this reads as an advance to ANYONE, including
  // the candidate — the orchestrator's ranked stage gates its comm on it.
  recommendation: "advance" | "hold";
  // Explainability (case-sim round 2 / compliance): the concrete reasons behind
  // the verdict, persisted on the automation trail so a reviewer can answer
  // "why did this advance / hold?" later.
  reasons: string[];
};

// Bridge an evaluated submission into the pipeline + a Decisions screening_review card.
// Shared by /api/devcase/promote and the lifecycle orchestrator; BOTH must pass the
// calibrated floor (activePromoteFloor()) so advice and behavior share one threshold —
// the old hardcoded `score >= 70` here diverged from the calibration-adjustable floor
// the orchestrator actually promoted on (case-sim round 2 canary c1). Returns null if
// the submission isn't evaluated yet.
export function promoteSubmission(submissionId: string, floor: number): PromoteResult | null {
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
  // The case's candidate-facing language (DEVP5) rides the lifecycle — promote
  // carries it onto the entry so post-promotion comms render in the candidate's
  // language, and the captured contact so they're deliverable at all (without
  // these, every interview/offer/rejection addressed a free-text name, in English).
  const lifecycle = sub.postingId ? lifecycleByPosting(sub.postingId) : null;
  // ce28da40 — a suspect-authenticity submission may be a paste-from-LLM, so it's
  // never auto-advanced on transfer score alone: it's held for the live interview
  // that verifies ownership of the decisions (the minted followups), with the
  // authenticity concern surfaced to the reviewer.
  const suspectAuth = bundle.authenticity?.band === "suspect";
  // Case-sim round 2 canary c2: the evaluation's PROPAGATED evidence-confidence
  // (min of its upstream signals — see models.py's confidence scale) was silently
  // dropped here, so a deterministic-fallback evaluation advised "advance" as
  // confidently as a fully-grounded one. Low evidence never auto-advances.
  const evalConfidence =
    typeof (evaluation as { confidence?: unknown }).confidence === "number"
      ? ((evaluation as { confidence: number }).confidence)
      : null;
  const lowConfidence = evalConfidence != null && evalConfidence <= LOW_EVAL_CONFIDENCE;

  // TENANT: the SUBMISSION's own team owns everything this function writes — the
  // pipeline entry, the screening card and the audit event. There is no session
  // here (the orchestrator calls this off-request), so the submission row is the
  // authority. All three writes previously omitted it, so a non-default team's
  // "Promote to pipeline" reported success while the candidate's name and contact
  // landed on the DEFAULT team's board and never appeared on the promoting team's.
  const workspaceId = sub.workspaceId;
  const { entry } = createPipelineEntry({
    candidateId: `ds-${sub.id}`,
    candidateLabel: sub.candidateRef ?? "Candidate",
    archetype: "bau",
    roleFamily: "software_engineering",
    jobId: `dc-${posting?.caseId ?? "case"}`,
    jobTitle: posting?.roleTitle ?? "Dev case",
    matchScore: score,
    stage: "Screened",
    contact: sub.contact ?? null,
    locale: lifecycle?.lang ?? null,
    // d95fed6d — origin marker: the drawer says "via dev case" and links back.
    sourceChannel: "devcase",
    workspaceId,
  });
  const recommendation: PromoteResult["recommendation"] =
    score >= floor && !suspectAuth && !lowConfidence ? "advance" : "hold";
  const reasons = [
    `transfer score ${score} vs calibrated floor ${floor}`,
    ...(suspectAuth ? [`process authenticity is suspect (${bundle.authenticity?.score ?? 0}/100)`] : []),
    ...(lowConfidence ? [`evaluation evidence-confidence is low (${evalConfidence})`] : []),
  ];
  const redFlags = [...((evaluation.concerns as string[]) ?? [])];
  if (suspectAuth) {
    redFlags.unshift(
      `Process-authenticity is suspect (${bundle.authenticity?.score ?? 0}/100) — verify the candidate authored this before advancing.`
    );
  }
  if (lowConfidence) {
    redFlags.unshift(
      `Evaluation evidence-confidence is low (${evalConfidence}) — the scores rest on thin/fallback evidence; verify live before advancing.`
    );
  }
  setApproval(
    entry.id,
    "screening_review",
    JSON.stringify({
      recommendation,
      // NOTE: this field carries the transfer SCORE (the card UI's existing
      // contract), not the 0..1 evidence-confidence — which now gates the
      // recommendation above instead of being silently dropped.
      confidence: score,
      rationale: `${String(evaluation.summary ?? "")} ${String(transfer.roleFitRationale ?? "")}`.trim() || "Dev-case evaluation.",
      strengths: (evaluation.strengths as string[]) ?? [],
      redFlags,
    }),
    workspaceId
  );
  recordAutomationEvent(entry.id, "screening_hold", `promoted from dev case — ${recommendation}: ${reasons.join("; ")}`, workspaceId);
  return { entryId: entry.id, recommendation, reasons };
}
