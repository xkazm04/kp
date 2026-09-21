import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, PipelineError, spawnPython } from "./python-runner";
import { buildLlmConfigEnv } from "./llm-config";

// The devcase CLI envelope every run* function in the phase modules shares: make a
// temp workdir, write the per-call JSON arg files into it + build the argv, spawn
// `python -m pipeline.jobfit.devcase.devcase_cli <verb> …`, fail on a non-zero
// exit (mapping stderr → PipelineError), parse the single JSON line, then always
// clean the workdir up. `build` receives the workdir, writes whatever arg files
// it needs, and returns the FULL argv (verb + flags + the paths it just wrote) —
// so each call keeps its exact subcommand/flags/input. `signal` is forwarded to
// spawnPython uniformly (the kp SIGKILL-on-abort convention); pass ctx.signal
// where a caller can be cancelled.
//
// This is the ONE spawn site for the whole dev-case lifecycle, which is why it sits
// in its own module rather than in any single phase: `app/_lib/llm-spawn-contract.test.ts`
// pins `buildLlmConfigEnv()` to the file that actually spawns, and the phase modules
// (devcase-run-design/-eval/-observed/-source) all call through here.
export async function runDevcaseCli<T>(
  build: (workdir: string) => string[] | Promise<string[]>,
  signal?: AbortSignal,
): Promise<T> {
  const workdir = await createWorkdir();
  try {
    const args = await build(workdir);
    // Route the devcase LLM steps (analyze-need, design-artifacts) through the
    // workspace Models config so model/max-tokens/timeout are configurable — same
    // wiring automation-run/reasoning-run use. `{}` when nothing is configured
    // (Python then defaults to the Claude CLI, unchanged).
    const { result } = spawnPython(["-m", "pipeline.jobfit.devcase.devcase_cli", ...args], { signal, env: buildLlmConfigEnv() });
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) throw new PipelineError(parseStderrError(stderr, exitCode));
    return parsePythonJson<T>(stdout, stderr);
  } finally {
    await cleanupWorkdir(workdir);
  }
}
