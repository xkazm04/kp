import path from "node:path";
import { writeFile } from "node:fs/promises";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, spawnPython } from "./python-runner";
import { buildLlmConfigEnv } from "./llm-config";
import type { RoleBrief } from "./rolespec";
import type { VoiceTurn } from "./voice/types";

// Role-intake dialog runner (docs/concepts/role-intake-dialog.md, Phase 1):
// one spawned intake_cli exchange per requestor message, mirroring the other
// per-request Python runners. The engine (persona, extraction, deterministic
// keyless script) lives in pipeline/jobfit/intake.py; this module only moves
// JSON across the process boundary.

export type IntakeExchange = {
  reply: string;
  brief: RoleBrief;
  shape: "power_unit" | "story" | null;
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
    shape: raw.shape === "power_unit" || raw.shape === "story" ? raw.shape : null,
    done: raw.done === true,
    source: raw.source === "llm" ? "llm" : "deterministic",
    ...(typeof raw.fallbackReason === "string" ? { fallbackReason: raw.fallbackReason } : {}),
  };
}

// The session opener — deterministic on the Python side (identical keyless and
// keyed), so no LLM env is passed.
export async function runIntakeOpening(lang: string, signal?: AbortSignal): Promise<IntakeExchange> {
  const { result } = spawnPython(["-m", "pipeline.jobfit.intake_cli", "--opening", "--lang", lang || "en"], { signal });
  const { stdout, stderr, exitCode } = await result;
  if (exitCode !== 0) throw new Error(parseStderrError(stderr, exitCode).message);
  return coerceExchange(parsePythonJson<unknown>(stdout, stderr));
}

// The realtime-voice system brief (persona + technique + spoken preamble —
// pipeline/jobfit/intake.py::intake_voice_brief). Static per language, so one
// spawn per process per lang: the voice-connect route must not pay a Python
// spawn on every credential mint.
const voiceBriefCache = new Map<string, string>();

export async function intakeVoiceBrief(lang: string, signal?: AbortSignal): Promise<string> {
  const key = lang === "cs" ? "cs" : "en";
  const cached = voiceBriefCache.get(key);
  if (cached) return cached;
  const { result } = spawnPython(["-m", "pipeline.jobfit.intake_cli", "--voice-brief", "--lang", key], { signal });
  const { stdout, stderr, exitCode } = await result;
  if (exitCode !== 0) throw new Error(parseStderrError(stderr, exitCode).message);
  const payload = parsePythonJson<{ brief?: unknown }>(stdout, stderr);
  if (typeof payload.brief !== "string" || !payload.brief) throw new Error("Voice brief unavailable.");
  voiceBriefCache.set(key, payload.brief);
  return payload.brief;
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
  input: { transcript: VoiceTurn[]; brief: RoleBrief | null; lang: string },
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
  input: { transcript: VoiceTurn[]; brief: RoleBrief | null; message: string; lang: string },
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
