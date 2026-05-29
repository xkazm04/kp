import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { lookupGeminiCache, storeGeminiCache } from "@/app/_lib/db";
import { candidateSignature, resolveCandidate, type CandidateInput } from "@/app/_lib/match-candidate";
import {
  cleanupWorkdir,
  createWorkdir,
  parseStderrError,
  spawnPython,
} from "@/app/_lib/python-runner";

export const runtime = "nodejs";

// Must match pipeline/jobfit/match_reasoning.py::REASONING_PROMPT_VERSION.
const REASONING_PROMPT_VERSION = "match-reasoning-v1";
const CACHE_TTL_HOURS = 168; // corpus is static; a week is plenty

export async function POST(request: NextRequest) {
  let workdir: string | null = null;
  try {
    const body = (await request.json()) as {
      analysisSlug?: string;
      candidate?: CandidateInput;
      jobId?: string;
    };
    if (!body.jobId) {
      return NextResponse.json({ error: "jobId is required." }, { status: 400 });
    }

    const resolved = resolveCandidate(body);
    if ("error" in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }
    const candidate = resolved.candidate;

    const hash = createHash("sha256")
      .update(`${REASONING_PROMPT_VERSION}|${candidateSignature(candidate)}|${body.jobId}`)
      .digest("hex");

    const cached = lookupGeminiCache(hash, REASONING_PROMPT_VERSION);
    if (cached) {
      return NextResponse.json({ ...(cached as object), cached: true });
    }

    workdir = await createWorkdir();
    const candidatePath = path.join(workdir, "candidate.json");
    await writeFile(candidatePath, JSON.stringify(candidate), "utf-8");

    const { result } = spawnPython([
      "-m",
      "pipeline.jobfit.reasoning_cli",
      "--candidate-json",
      candidatePath,
      "--job-id",
      String(body.jobId),
    ]);
    const { stdout, stderr, exitCode } = await result;

    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    const data = JSON.parse(stdout);
    storeGeminiCache(hash, data, REASONING_PROMPT_VERSION, CACHE_TTL_HOURS);
    return NextResponse.json({ ...data, cached: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reasoning failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}
