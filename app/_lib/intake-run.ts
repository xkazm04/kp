import path from "node:path";
import { writeFile } from "node:fs/promises";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, spawnPython } from "./python-runner";
import { buildLlmConfigEnv } from "./llm-config";
import type { RoleBrief } from "./rolespec";
import type { IntakeAttachment, PopulationFit } from "./db/intakes";
import type { RepoDossier } from "./schemas.generated";
import type { VoiceTurn } from "./voice/types";

// Shared helper: write the attachment list beside the other inputs and push
// the CLI flag. Bodies are budget-truncated Python-side; the voice fast thread
// reads titles only.
async function pushAttachmentsArg(
  workdir: string,
  args: string[],
  attachments: IntakeAttachment[] | undefined
): Promise<void> {
  if (!attachments || attachments.length === 0) return;
  const p = path.join(workdir, "attachments.json");
  await writeFile(p, JSON.stringify(attachments), "utf-8");
  args.push("--attachments-json", p);
}

// Role-intake dialog runner (docs/concepts/role-intake-dialog.md, Phase 1):
// one spawned intake_cli exchange per requestor message, mirroring the other
// per-request Python runners. The engine (persona, extraction, deterministic
// keyless script) lives in pipeline/jobfit/intake.py; this module only moves
// JSON across the process boundary.

export type IntakeExchange = {
  reply: string;
  brief: RoleBrief;
  shape: "power_unit" | "story" | "app_master" | null;
  done: boolean;
  source: "llm" | "deterministic";
  fallbackReason?: string;
};

function coerceExchange(payload: unknown): IntakeExchange {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const reply = typeof raw.reply === "string" ? raw.reply : "";
  if (!reply) throw new Error("Intake engine returned no reply.");
  return {
    reply,
    brief: (raw.brief && typeof raw.brief === "object" ? raw.brief : {}) as RoleBrief,
    shape: raw.shape === "power_unit" || raw.shape === "story" || raw.shape === "app_master" ? raw.shape : null,
    done: raw.done === true,
    source: raw.source === "llm" ? "llm" : "deterministic",
    ...(typeof raw.fallbackReason === "string" ? { fallbackReason: raw.fallbackReason } : {}),
  };
}

// The session opener — deterministic on the Python side (identical keyless and
// keyed), so no LLM env is passed. `shape: "app_master"` selects that shape's
// own opener (the repo was already pointed at, so the generic
// context-reinstatement question would waste the turn that sets the register).
export async function runIntakeOpening(
  lang: string,
  shape?: "app_master",
  signal?: AbortSignal
): Promise<IntakeExchange> {
  const args = ["-m", "pipeline.jobfit.intake_cli", "--opening", "--lang", lang || "en"];
  if (shape) args.push("--shape", shape);
  const { result } = spawnPython(args, { signal });
  const { stdout, stderr, exitCode } = await result;
  if (exitCode !== 0) throw new Error(parseStderrError(stderr, exitCode).message);
  return coerceExchange(parsePythonJson<unknown>(stdout, stderr));
}

// App master (docs/features/app-master/README.md): fold a completed RepoDossier
// into the brief as `codebase_dossier.*` facets AND judge the population fit
// over the objectives the requestor chose — ONE spawn, because both answer the
// same screen. Deterministic merge + a (keyless-degrading) fit judgment.
export type AppMasterSync = {
  brief: RoleBrief;
  shape: "app_master";
  fit: PopulationFit;
};

export async function runIntakeAppMasterSync(
  input: { brief: RoleBrief | null; dossier: RepoDossier; lang: string },
  signal?: AbortSignal
): Promise<AppMasterSync> {
  const workdir = await createWorkdir();
  try {
    const dossierPath = path.join(workdir, "dossier.json");
    await writeFile(dossierPath, JSON.stringify(input.dossier), "utf-8");
    const args = [
      "-m",
      "pipeline.jobfit.intake_cli",
      "--app-master-sync",
      "--dossier-json",
      dossierPath,
      "--lang",
      input.lang || "en",
    ];
    if (input.brief) {
      const briefPath = path.join(workdir, "brief.json");
      await writeFile(briefPath, JSON.stringify(input.brief), "utf-8");
      args.push("--brief-json", briefPath);
    }
    const { result } = spawnPython(args, { signal, env: buildLlmConfigEnv() });
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) throw new Error(parseStderrError(stderr, exitCode).message);
    const raw = parsePythonJson<Record<string, unknown>>(stdout, stderr);
    const brief = raw.brief && typeof raw.brief === "object" ? (raw.brief as RoleBrief) : null;
    if (!brief) throw new Error("App-master sync returned no brief.");
    return { brief, shape: "app_master", fit: coercePopulationFit(raw.fit) };
  } finally {
    await cleanupWorkdir(workdir);
  }
}

// The fit crosses the process boundary like every other Python artifact: shape
// it at the boundary rather than trusting the payload. An unrecognised verdict
// becomes `unassessed` — the disclosed unknown, never a guessed decision.
const POPULATION_VERDICTS = ["human", "agent", "hybrid", "unassessed"] as const;
const COVERAGE_CLASSES = ["automatable", "assisted", "human_only"] as const;

function coercePopulationFit(raw: unknown): PopulationFit {
  const r = (raw ?? {}) as Record<string, unknown>;
  const verdict = POPULATION_VERDICTS.includes(r.verdict as (typeof POPULATION_VERDICTS)[number])
    ? (r.verdict as PopulationFit["verdict"])
    : "unassessed";
  const perObjective = (Array.isArray(r.perObjective) ? r.perObjective : [])
    .map((e) => e as Record<string, unknown>)
    .filter((e) => typeof e?.kpiKey === "string" && COVERAGE_CLASSES.includes(e.coverage as (typeof COVERAGE_CLASSES)[number]))
    .map((e) => ({
      kpiKey: String(e.kpiKey),
      coverage: e.coverage as PopulationFit["perObjective"][number]["coverage"],
      rationale: typeof e.rationale === "string" ? e.rationale : "",
    }));
  const ratio = typeof r.coverageRatio === "number" && Number.isFinite(r.coverageRatio) ? r.coverageRatio : 0;
  return {
    verdict,
    perObjective,
    coverageRatio: ratio,
    source: r.source === "llm" ? "llm" : "deterministic",
  };
}

export type IntakeVoiceTurn = {
  reply: string;
  done: boolean;
  source: "llm" | "deterministic";
  // Present only when the DETERMINISTIC fast thread answered (it extracts
  // inline for free); the LLM fast thread leaves extraction to the periodic
  // thread and omits it.
  brief?: RoleBrief;
  fallbackReason?: string;
};

// The FAST voice thread (docs/architecture/voice-conversation-plane.md): one
// spoken utterance in → the next spoken utterance out, at speech pace — the
// conversational brain stays OURS, the provider is only the speech transport.
export async function runIntakeVoiceTurn(
  input: { transcript: VoiceTurn[]; brief: RoleBrief | null; message: string; lang: string; attachments?: IntakeAttachment[] },
  signal?: AbortSignal
): Promise<IntakeVoiceTurn> {
  const workdir = await createWorkdir();
  try {
    const transcriptPath = path.join(workdir, "transcript.json");
    await writeFile(transcriptPath, JSON.stringify(input.transcript), "utf-8");
    const args = [
      "-m",
      "pipeline.jobfit.intake_cli",
      "--voice-turn",
      "--transcript-json",
      transcriptPath,
      "--message",
      input.message,
      "--lang",
      input.lang || "en",
    ];
    if (input.brief) {
      const briefPath = path.join(workdir, "brief.json");
      await writeFile(briefPath, JSON.stringify(input.brief), "utf-8");
      args.push("--brief-json", briefPath);
    }
    await pushAttachmentsArg(workdir, args, input.attachments);
    const { result } = spawnPython(args, { signal, env: buildLlmConfigEnv() });
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) throw new Error(parseStderrError(stderr, exitCode).message);
    const raw = parsePythonJson<Record<string, unknown>>(stdout, stderr);
    const reply = typeof raw.reply === "string" ? raw.reply : "";
    if (!reply) throw new Error("Voice turn returned no utterance.");
    return {
      reply,
      done: raw.done === true,
      source: raw.source === "llm" ? "llm" : "deterministic",
      ...(raw.brief && typeof raw.brief === "object" ? { brief: raw.brief as RoleBrief } : {}),
      ...(typeof raw.fallbackReason === "string" ? { fallbackReason: raw.fallbackReason } : {}),
    };
  } finally {
    await cleanupWorkdir(workdir);
  }
}

export type IntakeExtractResult = {
  brief: RoleBrief;
  shape: "power_unit" | "story" | null;
  // False on the honest keyless fallback: the transcript is stored but the
  // brief is UNCHANGED (a free voice conversation can't be slot-parsed
  // deterministically — nothing gets silently invented).
  extracted: boolean;
  source: "llm" | "deterministic";
  fallbackReason?: string;
};

// Post-hang-up batch extraction: the finished voice transcript → the updated
// RoleBrief in one completion (merge-protected like every text exchange).
export async function runIntakeTranscriptExtract(
  input: { transcript: VoiceTurn[]; brief: RoleBrief | null; lang: string; attachments?: IntakeAttachment[] },
  signal?: AbortSignal
): Promise<IntakeExtractResult> {
  const workdir = await createWorkdir();
  try {
    const transcriptPath = path.join(workdir, "transcript.json");
    await writeFile(transcriptPath, JSON.stringify(input.transcript), "utf-8");
    const args = [
      "-m",
      "pipeline.jobfit.intake_cli",
      "--extract-transcript",
      "--transcript-json",
      transcriptPath,
      "--lang",
      input.lang || "en",
    ];
    if (input.brief) {
      const briefPath = path.join(workdir, "brief.json");
      await writeFile(briefPath, JSON.stringify(input.brief), "utf-8");
      args.push("--brief-json", briefPath);
    }
    await pushAttachmentsArg(workdir, args, input.attachments);
    const { result } = spawnPython(args, { signal, env: buildLlmConfigEnv() });
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) throw new Error(parseStderrError(stderr, exitCode).message);
    const raw = parsePythonJson<Record<string, unknown>>(stdout, stderr);
    return {
      brief: (raw.brief && typeof raw.brief === "object" ? raw.brief : {}) as RoleBrief,
      shape: raw.shape === "power_unit" || raw.shape === "story" ? raw.shape : null,
      extracted: raw.extracted === true,
      source: raw.source === "llm" ? "llm" : "deterministic",
      ...(typeof raw.fallbackReason === "string" ? { fallbackReason: raw.fallbackReason } : {}),
    };
  } finally {
    await cleanupWorkdir(workdir);
  }
}

export async function runIntakeExchange(
  input: {
    transcript: VoiceTurn[];
    brief: RoleBrief | null;
    message: string;
    lang: string;
    attachments?: IntakeAttachment[];
    // App master: the completed dossier the dialog is grounded on. Its presence
    // is what makes the exchange an `app_master` one, Python-side.
    dossier?: RepoDossier | null;
  },
  signal?: AbortSignal
): Promise<IntakeExchange> {
  const workdir = await createWorkdir();
  try {
    const transcriptPath = path.join(workdir, "transcript.json");
    await writeFile(transcriptPath, JSON.stringify(input.transcript), "utf-8");
    const args = [
      "-m",
      "pipeline.jobfit.intake_cli",
      "--transcript-json",
      transcriptPath,
      "--message",
      input.message,
      "--lang",
      input.lang || "en",
    ];
    if (input.brief) {
      const briefPath = path.join(workdir, "brief.json");
      await writeFile(briefPath, JSON.stringify(input.brief), "utf-8");
      args.push("--brief-json", briefPath);
    }
    await pushAttachmentsArg(workdir, args, input.attachments);
    if (input.dossier) {
      const dossierPath = path.join(workdir, "dossier.json");
      await writeFile(dossierPath, JSON.stringify(input.dossier), "utf-8");
      args.push("--dossier-json", dossierPath);
    }
    const { result } = spawnPython(args, { signal, env: buildLlmConfigEnv() });
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) throw new Error(parseStderrError(stderr, exitCode).message);
    // parsePythonJson, not raw JSON.parse: the LLM path can print interpreter
    // shutdown chatter after the JSON line (same reason as analyze-run).
    return coerceExchange(parsePythonJson<unknown>(stdout, stderr));
  } finally {
    await cleanupWorkdir(workdir);
  }
}
