import path from "node:path";
import { writeFile } from "node:fs/promises";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, spawnPython } from "./python-runner";
import { buildLlmConfigEnv } from "./llm-config";
import { withLlmRequestId } from "./llm-request-context";
import { attentionCounts } from "./attention";
// Import the SLICE, not the `./db` barrel — the barrel `export *`s 17 store
// modules and `next dev` compiles a route's whole module graph with no
// tree-shaking (see the same note at the top of attention.ts).
import { listPipeline } from "./db/pipeline";
import { pipelineSummary, transcriptWindow, type CompanionWireTurn } from "./companion-turn";
import { coerceChatBlocks, type ChatBlock } from "./companion-blocks";

// Operator-companion turn runner (docs/features/companion/README.md, WP2).
// One spawned `companion_cli` exchange per operator message, mirroring the other
// per-request Python runners. The companion's brain — constitution, identity,
// episodic recall, the degraded keyless reply — lives in
// pipeline/jobfit/companion_cli.py; this module only decides WHAT THE COMPANION
// MAY SEE and moves JSON across the process boundary.

export type CompanionRecall = { path: string; excerpt: string };

export type CompanionTurnResult = {
  reply: string;
  /** The rendered half of the answer: a table or a small chart the companion
   *  composed instead of enumerating three or more comparable things in prose. */
  blocks: ChatBlock[];
  /** Blocks the model emitted that did not match their schema and were dropped
   *  by companion_blocks.py. Counted, never guessed at, never raised. */
  blockErrors: number;
  recallUsed: CompanionRecall[];
  episodePaths: string[];
  source: "llm" | "deterministic";
  indexSkipped: string[];
  fallbackReason?: string;
};

/** What the studio looks like right now — the only facts the companion may state
 *  as facts. Assembled HERE, in one place, so the CLI never queries kp and the
 *  blast radius of "what the companion can see" is one function. */
export function companionGrounding(workspaceId: string): Record<string, unknown> {
  return {
    attention: attentionCounts(workspaceId),
    pipeline: pipelineSummary(listPipeline(workspaceId)),
  };
}

function coerceRecall(raw: unknown): CompanionRecall[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .filter((e) => typeof e.path === "string" && typeof e.excerpt === "string")
    .map((e) => ({ path: String(e.path), excerpt: String(e.excerpt) }));
}

function coerceStrings(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
}

/** Shape the payload at the boundary rather than trusting it — same contract as
 *  every other Python artifact in this tree. A reply is the one field that cannot
 *  be defaulted: without it there is nothing to show, so it throws. */
function coerceTurn(payload: unknown): CompanionTurnResult {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const reply = typeof raw.reply === "string" ? raw.reply.trim() : "";
  if (!reply) throw new Error("Companion turn returned no reply.");
  return {
    reply,
    blocks: coerceChatBlocks(raw.blocks),
    blockErrors: typeof raw.blockErrors === "number" && raw.blockErrors > 0 ? Math.floor(raw.blockErrors) : 0,
    recallUsed: coerceRecall(raw.recallUsed),
    episodePaths: coerceStrings(raw.episodePaths),
    source: raw.source === "llm" ? "llm" : "deterministic",
    indexSkipped: coerceStrings(raw.indexSkipped),
    ...(typeof raw.fallbackReason === "string" ? { fallbackReason: raw.fallbackReason } : {}),
  };
}

/**
 * One turn. `threadId` doubles as the ambient LLM request id, so every metered
 * call this spawn makes lands in the usage ledger tagged with the conversation
 * it belonged to (llm-request-context.ts) — otherwise companion spend is an
 * anonymous row nobody can attribute.
 */
export async function runCompanionTurn(
  input: {
    workspaceId: string;
    threadId: string;
    message: string;
    transcript: readonly CompanionWireTurn[];
    locale: string;
  },
  signal?: AbortSignal
): Promise<CompanionTurnResult> {
  return withLlmRequestId(input.threadId, async () => {
    const workdir = await createWorkdir();
    try {
      // The CLI reads ONE file from the workdir — the whole turn, including the
      // grounding blob, so nothing about the studio travels on argv where it
      // would land in a process listing.
      await writeFile(
        path.join(workdir, "turn.json"),
        JSON.stringify({
          workspace_id: input.workspaceId,
          session_id: input.threadId,
          message: input.message,
          transcript: transcriptWindow(input.transcript),
          grounding: companionGrounding(input.workspaceId),
          locale: input.locale,
        }),
        "utf-8"
      );
      const args = ["-m", "pipeline.jobfit.companion_cli", "--workdir", workdir];
      const { result } = spawnPython(args, { signal, env: buildLlmConfigEnv() });
      const { stdout, stderr, exitCode } = await result;
      if (exitCode !== 0) throw new Error(parseStderrError(stderr, exitCode).message);
      return coerceTurn(parsePythonJson<unknown>(stdout, stderr));
    } finally {
      await cleanupWorkdir(workdir);
    }
  });
}
