// The ONE seam between the seeker scan and the Python engine. match.ts, deepdive.ts and
// scan.ts never call spawnPython themselves: they describe a CLI call — the module, the
// JSON/text files it reads, how the argv is built from those files' paths — and hand it
// to a `CliRunner`. The default runner below is the production one (workdir, spawn,
// envelope parse, cleanup — the same shape /api/match and reasoning-run.ts follow); the
// tests inject a runner that answers shaped JSON per module, so scan.test.ts spawns no
// interpreter unless KP_JOBSEEKER_SCAN_SPAWN=1 opts in.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { buildLlmConfigEnv } from "../llm-config";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, PipelineError, spawnPython } from "../python-runner";

export type CliCall = {
  /** `pipeline.jobfit.<module>` — the `-m` target. */
  module: string;
  /** File name → content. Strings are written verbatim; anything else is JSON-encoded. */
  files: Record<string, unknown>;
  /** argv AFTER `-m <module>`, built from the written files' absolute paths. */
  args: (paths: Record<string, string>) => string[];
  signal?: AbortSignal;
  /** Forward KP_LLM_CONFIG (the operator's provider routing). Only for the CLIs that call
   *  a model — the deterministic ones must not be told about keys they do not need. */
  llm?: boolean;
  /** Hang backstop for THIS call; the runner's 10-minute default otherwise. */
  timeoutMs?: number;
};

export type CliRunner = (call: CliCall) => Promise<Record<string, unknown>>;

export const runPythonCli: CliRunner = async (call) => {
  const workdir = await createWorkdir();
  try {
    const paths: Record<string, string> = {};
    for (const [name, content] of Object.entries(call.files)) {
      const p = path.join(workdir, name);
      await writeFile(p, typeof content === "string" ? content : JSON.stringify(content), "utf-8");
      paths[name] = p;
    }
    const { result } = spawnPython(["-m", `pipeline.jobfit.${call.module}`, ...call.args(paths)], {
      signal: call.signal,
      env: call.llm ? buildLlmConfigEnv() : undefined,
      timeoutMs: call.timeoutMs,
    });
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) throw new PipelineError(parseStderrError(stderr, exitCode));
    return parsePythonJson<Record<string, unknown>>(stdout, stderr);
  } finally {
    await cleanupWorkdir(workdir);
  }
};

/** jobs_cli's refusal when no provider can be resolved for `jd_ingest` — the keyless
 *  install's ordinary state, not a fault. Matched on the engine's own wording because the
 *  CLI answers it as a plain `engine_error` (it predates the coded envelope). */
export function isNoProviderError(error: unknown): boolean {
  return error instanceof PipelineError && /no llm provider available/i.test(error.message);
}
