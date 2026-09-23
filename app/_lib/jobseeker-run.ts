import path from "node:path";
import { writeFile } from "node:fs/promises";
import { cleanupWorkdir, createWorkdir, isSpawnTimeout, parsePythonJson, parseStderrError, spawnPython } from "./python-runner";
import { buildLlmConfigEnv } from "./llm-config";
import { coerceIntakeChoiceSet } from "./intake-choices";
import { parsePreferencesPatch } from "./jobseeker/profile";
import {
  isDialogKind,
  type CvPolishArtifact,
  type DialogArtifact,
  type DialogKind,
  type DialogReply,
  type FitArtifact,
  type JobseekerPreferences,
  type StudioTurn,
} from "./jobseeker/types";
import type { ProfilePayload } from "@/app/features/shared/profileTypes";
import { isLocale } from "@/i18n/locales";

// Job-seeker dialog runner — one spawned jobseeker_cli exchange per message, the
// intake-run.ts shape (docs/features/jobseeker/README.md). The engine (persona,
// grounding, the deterministic twin) lives in pipeline/jobfit/jobseeker.py; this
// module only moves JSON across the process boundary and DECIDES what may cross
// back: a model-authored payload is a claim, and this is the boundary that shapes
// it before a screen or the store sees it.

// --- Per-turn budgets (intake-run.ts's reasoning, restated once) -------------
// spawnPython's default is a ten-minute hang backstop. A dialog turn gets the
// budget its own pace justifies: the opening is deterministic Python (no model),
// a typed exchange may include a reasoning model.
export const JOBSEEKER_OPENING_TIMEOUT_MS = 30_000;
export const JOBSEEKER_DIALOG_TIMEOUT_MS = 120_000;

const MAX_REPLY_CHARS = 1_600;
const MAX_CV_MARKDOWN_CHARS = 40_000;
const MAX_UNREADABLE = 50;
const MAX_SUGGESTIONS = 12;

/** The turn overran its stated budget — a DECISION (we stopped waiting), answered by
 *  the routes with JOBSEEKER_TURN_TIMEOUT rather than filed as a store fault. */
export class JobseekerTimeoutError extends Error {
  readonly budgetMs: number;
  constructor(budgetMs: number) {
    super(`Job-seeker turn exceeded its ${Math.round(budgetMs / 1000)}s budget.`);
    this.name = "JobseekerTimeoutError";
    this.budgetMs = budgetMs;
  }
}

/** The engine refused the request itself (exit code + `invalid_input` envelope):
 *  the caller's payload, not a fault — a 400, never a 500. */
export class JobseekerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobseekerInputError";
  }
}

export type JobseekerTurnInput = {
  kind: DialogKind;
  lang: string;
  profile: ProfilePayload;
  preferences: JobseekerPreferences;
  cvSourceText: string | null;
  /** The dialog's artifact so far — the engine edits it, never rebuilds it blind. */
  artifact: DialogArtifact | null;
  transcript: StudioTurn[];
  /** null = produce the opening turn (always deterministic). */
  message: string | null;
  /** fit only (WP5): the posting and its match. Passed through untouched. */
  posting?: Record<string, unknown> | null;
  match?: Record<string, unknown> | null;
  dismissals?: { reason: string; note: string | null; title: string }[];
};

function text(raw: unknown, max: number): string {
  return typeof raw === "string" ? raw.trim().slice(0, max) : "";
}

function stringList(raw: unknown, max: number, itemMax: number): string[] {
  return (Array.isArray(raw) ? raw : [])
    .map((x) => text(x, itemMax))
    .filter(Boolean)
    .slice(0, max);
}

/** The cv_polish artifact, or null when the payload is not one. `preferences` goes
 *  through the same validator PUT uses, so the store holds one vocabulary. */
export function coerceCvPolishArtifact(raw: unknown): CvPolishArtifact | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const cvMarkdown = text(r.cvMarkdown, MAX_CV_MARKDOWN_CHARS);
  if (!cvMarkdown) return null;
  const suggestions = (Array.isArray(r.suggestions) ? r.suggestions : [])
    .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : null))
    .filter((s): s is Record<string, unknown> => s !== null)
    .map((s) => ({ section: text(s.section, 60), before: text(s.before, 300), after: text(s.after, 600), why: text(s.why, 240) }))
    // A suggestion that cites no source sentence is not a suggestion (the engine's
    // grounding rule, re-asserted here because the payload is model-authored).
    .filter((s) => s.section && s.before)
    .slice(0, MAX_SUGGESTIONS);
  return {
    cvMarkdown,
    preferences: parsePreferencesPatch(r.preferences),
    unreadable: stringList(r.unreadable, MAX_UNREADABLE, 400),
    suggestions,
  };
}

const FIT_VERDICTS = ["apply", "skip", "undecided"] as const;
const GAP_SEVERITIES = ["blocking", "notable", "minor"] as const;

export function coerceFitArtifact(raw: unknown): FitArtifact | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!(FIT_VERDICTS as readonly string[]).includes(r.verdict as string)) return null;
  const gaps = (Array.isArray(r.gaps) ? r.gaps : [])
    .map((g) => (g && typeof g === "object" ? (g as Record<string, unknown>) : null))
    .filter((g): g is Record<string, unknown> => g !== null && (GAP_SEVERITIES as readonly string[]).includes(g.severity as string))
    .map((g) => ({ skill: text(g.skill, 80), severity: g.severity as FitArtifact["gaps"][number]["severity"], mitigation: text(g.mitigation, 300) }))
    .filter((g) => g.skill)
    .slice(0, 20);
  return {
    verdict: r.verdict as FitArtifact["verdict"],
    gaps,
    coverNoteMd: typeof r.coverNoteMd === "string" ? r.coverNoteMd.slice(0, MAX_CV_MARKDOWN_CHARS) : null,
    questionsToAsk: stringList(r.questionsToAsk, 10, 300),
  };
}

/** Shape the engine's reply at the boundary. A malformed card set is dropped, an
 *  artifact that does not match its kind becomes null (the dialog keeps the one it
 *  has — appendDialogTurns leaves the stored artifact alone on null), `source` is
 *  never anything but the two words the wire type allows. */
export function coerceDialogReply(payload: unknown, kind: DialogKind): DialogReply {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const reply = text(raw.reply, MAX_REPLY_CHARS);
  if (!reply) throw new Error("Job-seeker engine returned no reply.");
  const choices = coerceIntakeChoiceSet(raw.choices);
  const artifact = kind === "cv_polish" ? coerceCvPolishArtifact(raw.artifact) : coerceFitArtifact(raw.artifact);
  return {
    reply,
    done: raw.done === true,
    source: raw.source === "llm" ? "llm" : "deterministic",
    choices: choices ?? null,
    fallbackReason: typeof raw.fallbackReason === "string" && raw.fallbackReason ? raw.fallbackReason : null,
    fallbackLang: isLocale(raw.fallbackLang) ? raw.fallbackLang : null,
    artifact,
  };
}

async function runSpawn(
  input: JobseekerTurnInput,
  opts: { timeoutMs: number; signal?: AbortSignal; env?: Record<string, string | undefined> }
): Promise<DialogReply> {
  if (!isDialogKind(input.kind)) throw new JobseekerInputError("Unknown dialog kind.");
  const workdir = await createWorkdir();
  try {
    const inputPath = path.join(workdir, "input.json");
    // The engine renders only its newest 48 turns; serialising more writes bytes no
    // model reads (intake-run.ts's MAX_SPAWN_TRANSCRIPT_TURNS reasoning).
    const transcript = input.transcript.length > 49 ? input.transcript.slice(-49) : input.transcript;
    await writeFile(inputPath, JSON.stringify({ ...input, transcript }), "utf-8");
    const { result } = spawnPython(["-m", "pipeline.jobfit.jobseeker_cli", "--input-json", inputPath], {
      signal: opts.signal,
      env: opts.env,
      timeoutMs: opts.timeoutMs,
    });
    let stdout: string;
    let stderr: string;
    let exitCode: number | null;
    try {
      ({ stdout, stderr, exitCode } = await result);
    } catch (err) {
      if (isSpawnTimeout(err)) throw new JobseekerTimeoutError(opts.timeoutMs);
      throw err;
    }
    if (exitCode !== 0) {
      const parsed = parseStderrError(stderr, exitCode);
      if (parsed.code === "invalid_input") throw new JobseekerInputError(parsed.message);
      throw new Error(parsed.message);
    }
    // parsePythonJson, not raw JSON.parse: the LLM path can print interpreter
    // shutdown chatter after the JSON line (same reason as analyze-run).
    return coerceDialogReply(parsePythonJson<unknown>(stdout, stderr), input.kind);
  } finally {
    await cleanupWorkdir(workdir);
  }
}

/** The session opener — deterministic on the Python side (identical keyless and
 *  keyed), so no LLM env is passed and the budget is the short one. */
export async function runJobseekerOpening(
  input: Omit<JobseekerTurnInput, "message" | "transcript">,
  signal?: AbortSignal
): Promise<DialogReply> {
  return runSpawn({ ...input, message: null, transcript: [] }, { signal, timeoutMs: JOBSEEKER_OPENING_TIMEOUT_MS });
}

/** One exchange: the seeker's message in → the agent's reply + artifact out. The
 *  transcript is the history BEFORE this message (the engine fences the new message
 *  separately — exactly-once). */
export async function runJobseekerExchange(input: JobseekerTurnInput & { message: string }, signal?: AbortSignal): Promise<DialogReply> {
  return runSpawn(input, { signal, env: buildLlmConfigEnv(), timeoutMs: JOBSEEKER_DIALOG_TIMEOUT_MS });
}
