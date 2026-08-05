import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { JobRecord } from "./db";
import type { CandidatePoolEntry } from "./candidate-pool";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, PipelineError, spawnPython } from "./python-runner";
import { buildLlmConfigEnv } from "./llm-config";

// The recruiter_cli ranking-spawn envelope shared by every "rank this pool
// against this job" site (the candidates list, rediscovery, the automation
// auto-score sweep, and the Decisions group eval). Each used to hand-roll the
// identical createWorkdir → write recruiter.json (+ optional job.json) →
// spawnPython(recruiter_cli) → exitCode/parse → cleanup dance; this single-
// sources the I/O so a temp-file/abort/JSON-parse fix lands in one place.
//
// `job` is nullable: when present we pass --job-json so a freshly-ingested
// (non-corpus) job ranks too; when null we omit it (the automation sweep's
// contract). `weightsLlm`/`embeddings` opt into the deep-read enrichments the
// group eval wants and the cheap list endpoint leaves off. On a non-zero exit we
// throw a PipelineError (carrying the CLI's status/code) — callers keep their own
// try/catch and result-mapping (the route surfaces err.status, the best-effort
// sweep/publish triggers swallow it).
export async function rankPoolForJob<T>(
  jobId: string,
  pool: CandidatePoolEntry[],
  job: JobRecord | null,
  opts: { signal?: AbortSignal; weightsLlm?: boolean; embeddings?: boolean } = {},
): Promise<T> {
  const workdir = await createWorkdir();
  try {
    const inputPath = path.join(workdir, "recruiter.json");
    await writeFile(inputPath, JSON.stringify({ jobId, candidates: pool }), "utf-8");
    const args = ["-m", "pipeline.jobfit.recruiter_cli", "--input-json", inputPath];
    if (job) {
      const jobPath = path.join(workdir, "job.json");
      await writeFile(jobPath, JSON.stringify(job), "utf-8");
      args.push("--job-json", jobPath);
    }
    if (opts.weightsLlm) args.push("--weights-llm");
    if (opts.embeddings) args.push("--embeddings");

    // buildLlmConfigEnv: --weights-llm resolves the weight_proposal use case —
    // without this env the configured provider re-route never reaches the child.
    const { result } = spawnPython(args, { signal: opts.signal, env: buildLlmConfigEnv() });
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) throw new PipelineError(parseStderrError(stderr, exitCode));
    // parsePythonJson, not raw JSON.parse: the interpreter routinely prints
    // trailing non-JSON at shutdown (asyncio "Event loop is closed", leaked-
    // semaphore / ResourceWarning, atexit — common on Windows), and one such line
    // would turn a successful ranking into a JSON.parse throw / 500.
    return parsePythonJson<T>(stdout, stderr);
  } finally {
    await cleanupWorkdir(workdir);
  }
}
