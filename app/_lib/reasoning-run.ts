import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { getProfileRecord, lookupGeminiCache, storeGeminiCache } from "./db";
import { candidateSignature, resolveCandidate, type CandidateInput } from "./match-candidate";
import { cleanupWorkdir, createWorkdir, parseStderrError, spawnPython } from "./python-runner";

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

export type ReasoningInput = { analysisSlug?: string; candidate?: CandidateInput; profileId?: string; jobId?: string };

// Shared core for /api/match/reasoning AND the background-task runner.
export async function runReasoning(body: ReasoningInput): Promise<Record<string, unknown>> {
  if (!body.jobId) throw new ReasoningError("jobId is required.", 400);
  let workdir: string | null = null;
  try {
    workdir = await createWorkdir();
    let keyPart: string;
    let args: string[];

    if (body.profileId) {
      const record = getProfileRecord(body.profileId);
      if (!record) throw new ReasoningError("Profile not found.", 404);
      keyPart = `profile:${body.profileId}`;
      const profilePath = path.join(workdir, "profile.json");
      await writeFile(profilePath, JSON.stringify(record.payload), "utf-8");
      args = ["-m", "pipeline.jobfit.reasoning_cli", "--profile-json", profilePath, "--job-id", String(body.jobId)];
    } else {
      const resolved = resolveCandidate(body);
      if ("error" in resolved) throw new ReasoningError(resolved.error, resolved.status);
      keyPart = candidateSignature(resolved.candidate);
      const candidatePath = path.join(workdir, "candidate.json");
      await writeFile(candidatePath, JSON.stringify(resolved.candidate), "utf-8");
      args = ["-m", "pipeline.jobfit.reasoning_cli", "--candidate-json", candidatePath, "--job-id", String(body.jobId)];
    }

    const hash = createHash("sha256").update(`${REASONING_PROMPT_VERSION}|${keyPart}|${body.jobId}`).digest("hex");
    const cached = lookupGeminiCache(hash, REASONING_PROMPT_VERSION);
    if (cached) return { ...(cached as object), cached: true };

    const { result } = spawnPython(args);
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      throw new ReasoningError(err.message, err.status);
    }
    const data = JSON.parse(stdout);
    storeGeminiCache(hash, data, REASONING_PROMPT_VERSION, CACHE_TTL_HOURS);
    return { ...data, cached: false };
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}
