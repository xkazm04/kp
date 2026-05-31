import { NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { getJob } from "@/app/_lib/db";
import { buildCandidatePool } from "@/app/_lib/candidate-pool";
import {
  cleanupWorkdir,
  createWorkdir,
  parseStderrError,
  spawnPython,
} from "@/app/_lib/python-runner";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let workdir: string | null = null;
  try {
    const job = getJob(id);
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    // Shared pool (v2 profiles + saved CV analyses) — the same population
    // rediscovery scores, so the two views never diverge.
    const entries = buildCandidatePool();

    if (entries.length === 0) {
      return NextResponse.json({ job: null, candidates: [], note: "No saved candidates yet." });
    }

    workdir = await createWorkdir();
    const inputPath = path.join(workdir, "recruiter.json");
    await writeFile(inputPath, JSON.stringify({ jobId: id, candidates: entries }), "utf-8");
    // Pass the DB job directly so newly-ingested jobs (not in the static corpus) rank too.
    const jobPath = path.join(workdir, "job.json");
    await writeFile(jobPath, JSON.stringify(job), "utf-8");

    const { result } = spawnPython(["-m", "pipeline.jobfit.recruiter_cli", "--input-json", inputPath, "--job-json", jobPath]);
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to rank candidates.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}
