import { meterAllows } from "./billing/enforce";
import { getJob, lookupPromptCache, storePromptCache } from "./db";
import { buildLlmConfigEnv } from "./llm-config";
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

// MAT1 — `lang` is the recruiter's locale for the verdict/strengths/gaps
// narrative, captured at request scope (the detached task can't read the cookie)
// and validated upstream. Defaults to "en".
export type ReasoningInput = MatchInputBody & { jobId?: string; lang?: string };

// Shared core for /api/match/reasoning AND the background-task runner.
export async function runReasoning(body: ReasoningInput, signal?: AbortSignal): Promise<Record<string, unknown>> {
  if (!body.jobId) throw new ReasoningError("jobId is required.", 400);
  const lang = body.lang === "cs" ? "cs" : "en";
  let workdir: string | null = null;
  try {
    workdir = await createWorkdir();
    const input = await writeMatchInput(body, workdir);
    if ("error" in input) throw new ReasoningError(input.error, input.status);
    const args = [
      "-m",
      "pipeline.jobfit.reasoning_cli",
      ...input.inputArgs,
      "--job-id",
      String(body.jobId),
      "--lang",
      lang,
    ];
    // Billing degrade (docs/BILLING.md): past the AI-candidates allowance the
    // rationale falls back to the deterministic template via --no-llm — the
    // same path a provider outage takes — and stays uncached (source !=
    // "llm"), so it upgrades the moment allowance returns. No extra debit:
    // reasoning is part of the analyze-debited candidate bundle.
    if (!meterAllows("ai_candidates")) args.push("--no-llm");

    // Content-address the job (not just its id) so an in-place edit to the job's
    // requirements/title invalidates the cached verdict — symmetric with the
    // profile content hash in input.keyPart. The locale is a fourth axis so a
    // cached cs verdict never serves an en session. See reasoning-cache-key.ts.
    const hash = reasoningCacheKey({
      promptVersion: REASONING_PROMPT_VERSION,
      candidateKeyPart: input.keyPart,
      jobId: body.jobId,
      jobPayload: getJob(body.jobId),
      lang,
    });
    const cached = lookupPromptCache(hash, REASONING_PROMPT_VERSION);
    if (cached) return { ...(cached as object), cached: true };

    const { result } = spawnPython(args, { signal, env: buildLlmConfigEnv() });
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
