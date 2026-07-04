import { NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { getJob } from "@/app/_lib/db";
import { buildCandidatePool } from "@/app/_lib/candidate-pool";
import {
  cleanupWorkdir,
  createWorkdir,
  parsePythonJson,
  parseStderrError,
  spawnPython,
} from "@/app/_lib/python-runner";


// idea-aa039d0c — pre-publish winnability coach. Grades a (draft) JD against the
// SAME shared pool the recruiter ranking scores, reusing the production ko_filter
// + score_job so the "+N if you loosen this" promises match what publishing would
// actually surface. Read-only: it never mutates the job.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let workdir: string | null = null;
  try {
    const job = getJob(id);
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    // Same population the candidates tab ranks, so the coach and the ranking
    // never diverge on who's in the pool.
    const entries = buildCandidatePool();
    if (entries.length === 0) {
      return NextResponse.json({ poolSize: 0, note: "No saved candidates yet." });
    }

    workdir = await createWorkdir();
    const inputPath = path.join(workdir, "winnability.json");
    await writeFile(inputPath, JSON.stringify({ jobId: id, candidates: entries }), "utf-8");
    // Pass the DB job directly so a freshly-ingested draft (not in the static
    // corpus) can be graded before it's ever published.
    const jobPath = path.join(workdir, "job.json");
    await writeFile(jobPath, JSON.stringify(job), "utf-8");

    // Thread the AbortSignal: switching tabs / closing the modal SIGKILLs the
    // child instead of letting it run to the backstop and pile up.
    const { result } = spawnPython(
      ["-m", "pipeline.jobfit.winnability_cli", "--input-json", inputPath, "--job-json", jobPath],
      { signal: request.signal },
    );
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    // parsePythonJson, not raw JSON.parse: the interpreter routinely prints
    // trailing non-JSON at shutdown (asyncio "Event loop is closed", leaked-
    // semaphore / ResourceWarning — common on Windows) that would crash a parse.
    const payload = parsePythonJson<Record<string, unknown>>(stdout, stderr);
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to assess winnability.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}
