import path from "node:path";
import { writeFile } from "node:fs/promises";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, spawnPython } from "./python-runner";
import { buildLlmConfigEnv } from "./llm-config";
import type { RoleBrief } from "./rolespec";
import type { IntakeAttachment, PopulationFit } from "./db/intakes";
import { MAX_STORED_TURNS } from "./intake-transcript";
import type { RepoDossier } from "./schemas.generated";
import { isLocale, type Locale } from "@/i18n/locales";
import type { VoiceTurn } from "./voice/types";

// --- Per-turn budgets -------------------------------------------------------
//
// spawnPython's default is a TEN-MINUTE hang backstop - the right bound for a
// repo scan and the wrong one for a conversation. A dialog turn inherited it
// whole: a provider that stalled left the requestor watching a spinner for the
// remaining nine minutes with no way to tell a slow answer from a dead one, and
// the paid completion kept running behind it. Each thread now gets the budget
// its OWN pace justifies, and overrunning one is answered by name.
export const INTAKE_OPENING_TIMEOUT_MS = 30_000; // deterministic Python, no model call
export const INTAKE_DIALOG_TIMEOUT_MS = 120_000; // one typed exchange, incl. a reasoning model
export const INTAKE_VOICE_TURN_TIMEOUT_MS = 45_000; // speech pace: a fast model or nothing
export const INTAKE_EXTRACT_TIMEOUT_MS = 180_000; // one batch pass over a whole transcript
export const INTAKE_APP_MASTER_TIMEOUT_MS = 180_000; // dossier merge + population-fit judgment

/** The turn overran its stated budget. A DECISION (we stopped waiting), not a
 *  store fault - so the routes answer it with its own refusal code instead of
 *  filing it as a 500 whose generic message the reader could not have acted on. */
export class IntakeTimeoutError extends Error {
  readonly budgetMs: number;
  constructor(budgetMs: number) {
    super(`Intake turn exceeded its ${Math.round(budgetMs / 1000)}s budget.`);
    this.name = "IntakeTimeoutError";
    this.budgetMs = budgetMs;
  }
}

/** python-runner reports its deadline as a message, not a typed error. Matching
 *  it here (ONE place) is what lets every intake thread turn "the child was
 *  killed at the deadline" into the one fact the reader is owed. */
export function isSpawnTimeoutMessage(message: string): boolean {
  return /^Python process timed out after \d+s/.test(message);
}

// The engine renders only its newest MAX_TRANSCRIPT_TURNS (= 48,
// pipeline/jobfit/intake.py) turns into any prompt, so serialising more than
// that into the workdir writes bytes no model will ever read. The store caps at
// the same window (MAX_STORED_TURNS) plus at most ONE leading compaction marker,
// so this slice is a no-op for a capped row and the real bound for a legacy row
// written before the cap existed. Keeping the two equal is also what keeps
// `sourceTurn` citations aligned: render_transcript numbers from
// `len(turns) - len(window)`, so a file that IS the window numbers its turns
// exactly as the stored transcript does.
export const MAX_SPAWN_TRANSCRIPT_TURNS = MAX_STORED_TURNS + 1;

export function transcriptWindow(turns: VoiceTurn[]): VoiceTurn[] {
  return turns.length > MAX_SPAWN_TRANSCRIPT_TURNS ? turns.slice(-MAX_SPAWN_TRANSCRIPT_TURNS) : turns;
}

/** One spawn + its budget + its error vocabulary. Every intake thread goes
 *  through here so a new one cannot silently inherit the 10-minute default. */
async function runIntakeSpawn(
  args: string[],
  opts: { timeoutMs: number; signal?: AbortSignal; env?: Record<string, string | undefined> }
): Promise<{ stdout: string; stderr: string }> {
  const { result } = spawnPython(args, { signal: opts.signal, env: opts.env, timeoutMs: opts.timeoutMs });
  let stdout: string;
  let stderr: string;
  let exitCode: number | null;
  try {
    ({ stdout, stderr, exitCode } = await result);
  } catch (err) {
    if (err instanceof Error && isSpawnTimeoutMessage(err.message)) throw new IntakeTimeoutError(opts.timeoutMs);
    throw err;
  }
  if (exitCode !== 0) throw new Error(parseStderrError(stderr, exitCode).message);
  return { stdout, stderr };
}

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
  // The keyless scripted path is written in all four locales; when a session
  // asks for one it does NOT carry, the engine names the language it served
  // instead of silently substituting English. Present = the operator is
  // reading a stand-in language, and a surface may say so.
  fallbackLang?: Locale;
};

// Only a locale the app actually knows may cross the boundary as `fallbackLang`
// — an unrecognised value is dropped rather than handed on as a language tag no
// catalog can resolve.
function coerceFallbackLang(raw: unknown): { fallbackLang?: Locale } {
  return isLocale(raw) ? { fallbackLang: raw } : {};
}

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
    ...coerceFallbackLang(raw.fallbackLang),
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
  const { stdout, stderr } = await runIntakeSpawn(args, { signal, timeoutMs: INTAKE_OPENING_TIMEOUT_MS });
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
    const { stdout, stderr } = await runIntakeSpawn(args, {
      signal,
      env: buildLlmConfigEnv(),
      timeoutMs: INTAKE_APP_MASTER_TIMEOUT_MS,
    });
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
  fallbackLang?: Locale;
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
    await writeFile(transcriptPath, JSON.stringify(transcriptWindow(input.transcript)), "utf-8");
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
    const { stdout, stderr } = await runIntakeSpawn(args, {
      signal,
      env: buildLlmConfigEnv(),
      timeoutMs: INTAKE_VOICE_TURN_TIMEOUT_MS,
    });
    const raw = parsePythonJson<Record<string, unknown>>(stdout, stderr);
    const reply = typeof raw.reply === "string" ? raw.reply : "";
    if (!reply) throw new Error("Voice turn returned no utterance.");
    return {
      reply,
      done: raw.done === true,
      source: raw.source === "llm" ? "llm" : "deterministic",
      ...(raw.brief && typeof raw.brief === "object" ? { brief: raw.brief as RoleBrief } : {}),
      ...(typeof raw.fallbackReason === "string" ? { fallbackReason: raw.fallbackReason } : {}),
      ...coerceFallbackLang(raw.fallbackLang),
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
    await writeFile(transcriptPath, JSON.stringify(transcriptWindow(input.transcript)), "utf-8");
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
    const { stdout, stderr } = await runIntakeSpawn(args, {
      signal,
      env: buildLlmConfigEnv(),
      timeoutMs: INTAKE_EXTRACT_TIMEOUT_MS,
    });
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
    await writeFile(transcriptPath, JSON.stringify(transcriptWindow(input.transcript)), "utf-8");
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
    const { stdout, stderr } = await runIntakeSpawn(args, {
      signal,
      env: buildLlmConfigEnv(),
      timeoutMs: INTAKE_DIALOG_TIMEOUT_MS,
    });
    // parsePythonJson, not raw JSON.parse: the LLM path can print interpreter
    // shutdown chatter after the JSON line (same reason as analyze-run).
    return coerceExchange(parsePythonJson<unknown>(stdout, stderr));
  } finally {
    await cleanupWorkdir(workdir);
  }
}
