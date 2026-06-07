import { getJob, lookupPromptCache, storePromptCache } from "./db";
import { writeMatchInput, type MatchInputBody } from "./match-input";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, spawnPython } from "./python-runner";
import { reasoningCacheKey } from "./reasoning-cache-key";
import { isCacheableReasoning } from "./reasoning-cache-policy";

// Must match pipeline/jobfit/match_reasoning.py::REASONING_PROMPT_VERSION — a
// drift here leaves the reasoning cache silently stale. The pairing is enforced
// by pipeline/jobfit/tests/test_prompt_version_sync.py (CI fails on divergence).
const REASONING_PROMPT_VERSION = "match-reasoning-v1";
const CACHE_TTL_HOURS = 168;

export class ReasoningError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type ReasoningInput = MatchInputBody & { jobId?: string };

// Shared core for /api/match/reasoning AND the background-task runner.
export async function runReasoning(body: ReasoningInput): Promise<Record<string, unknown>> {
  if (!body.jobId) throw new ReasoningError("jobId is required.", 400);
  let workdir: string | null = null;
  try {
    workdir = await createWorkdir();
    const input = await writeMatchInput(body, workdir);
    if ("error" in input) throw new ReasoningError(input.error, input.status);
    const args = ["-m", "pipeline.jobfit.reasoning_cli", ...input.inputArgs, "--job-id", String(body.jobId)];

    // Content-address the job (not just its id) so an in-place edit to the job's
    // requirements/title invalidates the cached verdict — symmetric with the
    // profile content hash in input.keyPart. See reasoning-cache-key.ts for the
    // full invalidation contract.
    const hash = reasoningCacheKey({
      promptVersion: REASONING_PROMPT_VERSION,
      candidateKeyPart: input.keyPart,
      jobId: body.jobId,
      jobPayload: getJob(body.jobId),
    });
    const cached = lookupPromptCache(hash, REASONING_PROMPT_VERSION);
    if (cached) return { ...(cached as object), cached: true };

    const { result } = spawnPython(args);
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      throw new ReasoningError(err.message, err.status);
    }
    // parsePythonJson, not raw JSON.parse (idea-37493de3): reasoning_cli invokes
    // an LLM, and the interpreter can print shutdown chatter after the JSON line
    // — a successful, PAID reasoning call must not throw here (and skip the
    // cache!) because asyncio logged 'Event loop is closed'.
    const data = parsePythonJson<Record<string, unknown>>(stdout, stderr);
    // Persist authoritative LLM verdicts only; a deterministic fallback is left
    // uncached so it is recomputed (and upgraded) the moment the provider returns.
    // See reasoning-cache-policy.ts for the full invalidation contract.
    if (isCacheableReasoning(data)) {
      storePromptCache(hash, data, REASONING_PROMPT_VERSION, CACHE_TTL_HOURS);
    }
    return { ...data, cached: false };
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}
