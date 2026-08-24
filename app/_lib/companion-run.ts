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
import {
  coerceCompanionAction,
  companionActionWire,
  MAX_ACTIONS_PER_REPLY,
  type CompanionActionParams,
  type CompanionActionSummary,
} from "./companion-actions";

// Operator-companion turn runner (docs/features/companion/README.md, WP2).
// One spawned `companion_cli` exchange per operator message, mirroring the other
// per-request Python runners. The companion's brain — constitution, identity,
// episodic recall, the degraded keyless reply — lives in
// pipeline/jobfit/companion_cli.py; this module only decides WHAT THE COMPANION
// MAY SEE and moves JSON across the process boundary.

export type CompanionRecall = { path: string; excerpt: string };

/** One action the companion PROPOSED this turn. Already validated against the
 *  catalog (companion-actions.ts) on both sides of the process boundary; the
 *  caller turns it into a `companion_proposals` row and nothing more. Nothing
 *  here has run — a proposal is a question. */
export type CompanionProposedAction = {
  actionId: string;
  params: CompanionActionParams;
  summary: CompanionActionSummary;
};

export type CompanionTurnResult = {
  reply: string;
  /** The rendered half of the answer: a table or a small chart the companion
   *  composed instead of enumerating three or more comparable things in prose. */
  blocks: ChatBlock[];
  /** Blocks the model emitted that did not match their schema and were dropped
   *  by companion_blocks.py. Counted, never guessed at, never raised. */
  blockErrors: number;
  /** What she offered to DO. Never more than MAX_ACTIONS_PER_REPLY. */
  actions: CompanionProposedAction[];
  /** `kp:action` fences that did not survive validation on either side. Counted
   *  the same way blocks are, and for the same reason: "she proposed nothing" and
   *  "she proposed something unrunnable" are different facts. */
  actionErrors: number;
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

/** Re-validate every proposed action against the catalog on THIS side of the
 *  boundary. companion_blocks.py already checked them against the catalog it was
 *  shipped, which is the same array — this is the same belt-and-braces reasoning
 *  `coerceChatBlocks` documents: the value crossed a spawned process's stdout,
 *  and a payload from an older build is untrusted input. Anything that fails
 *  here is counted, never raised. */
function coerceActions(raw: unknown): { actions: CompanionProposedAction[]; dropped: number } {
  if (!Array.isArray(raw)) return { actions: [], dropped: 0 };
  const actions: CompanionProposedAction[] = [];
  let dropped = 0;
  for (const entry of raw) {
    if (actions.length >= MAX_ACTIONS_PER_REPLY) {
      dropped += 1;
      continue;
    }
    const coerced = coerceCompanionAction(entry);
    if (!coerced.ok) {
      dropped += 1;
      continue;
    }
    actions.push({ actionId: coerced.id, params: coerced.params, summary: coerced.summary });
  }
  return { actions, dropped };
}

/** Shape the payload at the boundary rather than trusting it — same contract as
 *  every other Python artifact in this tree. A reply is the one field that cannot
 *  be defaulted: without it there is nothing to show, so it throws. */
function coerceTurn(payload: unknown): CompanionTurnResult {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const reply = typeof raw.reply === "string" ? raw.reply.trim() : "";
  if (!reply) throw new Error("Companion turn returned no reply.");
  const { actions, dropped } = coerceActions(raw.actions);
  const reportedActionErrors =
    typeof raw.actionErrors === "number" && raw.actionErrors > 0 ? Math.floor(raw.actionErrors) : 0;
  return {
    reply,
    blocks: coerceChatBlocks(raw.blocks),
    blockErrors: typeof raw.blockErrors === "number" && raw.blockErrors > 0 ? Math.floor(raw.blockErrors) : 0,
    actions,
    actionErrors: reportedActionErrors + dropped,
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
  return spawnCompanion(
    input.threadId,
    {
      workspace_id: input.workspaceId,
      session_id: input.threadId,
      message: input.message,
      transcript: transcriptWindow(input.transcript),
      grounding: companionGrounding(input.workspaceId),
      locale: input.locale,
    },
    [],
    signal
  );
}

/**
 * The DIGEST leg — the same brain door, addressed to nobody.
 *
 * One metered call under the same `assistant` use case, appended to the brain as
 * an episode like any other exchange, and answered with prose plus the same
 * optional blocks and actions. The only differences are that no operator spoke
 * (so there is no user episode to write first) and that the grounding carries
 * the open proposals, because "what is still waiting on you" is half of what a
 * digest is for.
 */
export async function runCompanionDigest(
  input: {
    workspaceId: string;
    threadId: string;
    locale: string;
    /** Open proposals the digest may refer to, shortest-possible projection. */
    openProposals: readonly { id: string; summary: string }[];
  },
  signal?: AbortSignal
): Promise<CompanionTurnResult> {
  return spawnCompanion(
    input.threadId,
    {
      workspace_id: input.workspaceId,
      session_id: input.threadId,
      digest: true,
      grounding: {
        ...companionGrounding(input.workspaceId),
        openProposals: input.openProposals.map((p) => ({ id: p.id, summary: p.summary })),
      },
      locale: input.locale,
    },
    ["--digest"],
    signal
  );
}

/** The one spawn. `threadId` doubles as the ambient LLM request id for both legs,
 *  so a digest's spend is attributable to the conversation it landed in rather
 *  than becoming an anonymous ledger row.
 *
 *  The ACTION CATALOG is attached here, in one place: the CLI's prompt addendum
 *  and its fence validator are both built from what arrives in `actions`, which
 *  is why no Python file names an action. Ship nothing and the model is taught
 *  nothing, which is the correct default for a caller that does not want an
 *  actor. */
async function spawnCompanion(
  requestId: string,
  turn: Record<string, unknown>,
  extraArgs: string[],
  signal?: AbortSignal
): Promise<CompanionTurnResult> {
  return withLlmRequestId(requestId, async () => {
    const workdir = await createWorkdir();
    try {
      // The CLI reads ONE file from the workdir — the whole turn, including the
      // grounding blob, so nothing about the studio travels on argv where it
      // would land in a process listing.
      await writeFile(
        path.join(workdir, "turn.json"),
        JSON.stringify({ ...turn, actions: companionActionWire() }),
        "utf-8"
      );
      const args = ["-m", "pipeline.jobfit.companion_cli", "--workdir", workdir, ...extraArgs];
      const { result } = spawnPython(args, { signal, env: buildLlmConfigEnv() });
      const { stdout, stderr, exitCode } = await result;
      if (exitCode !== 0) throw new Error(parseStderrError(stderr, exitCode).message);
      return coerceTurn(parsePythonJson<unknown>(stdout, stderr));
    } finally {
      await cleanupWorkdir(workdir);
    }
  });
}
