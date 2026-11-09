import { DEFAULT_STAGE_RUNNERS, type StageContext, type StageOutcome, type StageRunner, type StageRunners } from "../role-run-engine.ts";
import type { RoleRunStageKind } from "../role-run-stages.ts";
import { engineAvailability, type EngineAvailability } from "../engine-preflight.ts";
import { isOffline } from "../offline.ts";
import { opsLog } from "../ops-telemetry.ts";

// THE PRODUCER SEAM (ADR-0011 s1: "the registry is the seam that makes those increments
// independent of each other").
//
// A PRODUCER is a stage runner that does real work - an LLM or a policy engine - where the
// engine's DEFAULT runner is the keyless, deterministic floor. This module is the only place
// that decides, per call, which of the two a stage gets:
//
//   producer available   -> the producer's outcome
//   producer unavailable -> the keyless default, unchanged (CI is keyless; so is the
//                           two-minute start; KP_OFFLINE seals egress)
//   producer throws      -> the keyless default as well, logged by CODE only
//
// WHAT "AN LLM" MEANS HERE. kp has one production LLM layer: the Python provider registry
// (pipeline/jobfit/llm/, the `claude_cli` adapter among them), reached through the existing
// *-run.ts runners with `env: buildLlmConfigEnv()` (llm-spawn-contract.test.ts). A producer
// therefore calls those runners - it never spawns `claude` itself. (The TS `claude -p`
// wrapper in interview-sim/providers.ts is a dev-only simulator on synthetic data and is
// deliberately NOT reused: its consumer-terms veto does not apply to real candidates.) The
// engine opens the withLlmRoleRun scope around every runner, so each metered call lands in
// llm_usage.role_run_id and counts against the per-run ceiling (role-run-budget.ts).
//
// A producer never writes PII: appendStageArtifact still refuses it at the write door, and
// never resolves a gate: the three Art. 22 approval gates stay in commitRoleRunStageGate.

export type RoleRunProducer = {
  kind: RoleRunStageKind;
  /** True when the producer calls a model. An LLM producer runs only while
   *  `roleRunLlmAvailable()` holds; a local one (a policy engine) always runs. */
  usesLlm: boolean;
  run: StageRunner;
};

/** KP_ROLE_RUN_LLM=0 turns every LLM producer off even when a provider is installed. */
export function roleRunLlmAvailable(
  env: Readonly<Record<string, string | undefined>> = process.env,
  engine: () => EngineAvailability = engineAvailability
): boolean {
  if ((env.KP_ROLE_RUN_LLM ?? "").trim() === "0") return false;
  if (isOffline(env)) return false;
  const e = engine();
  return e.claudeCli || e.gemini;
}

export type ProducerRunnerOptions = {
  /** The runners a stage falls back to. Defaults to the engine's keyless floor. */
  fallback?: StageRunners;
  /** Whether an LLM producer may run now. Injected by tests; defaults to the env/PATH probe. */
  llmAvailable?: () => boolean;
};

/** Build the `runners` map for advanceRoleRun from a set of producers. Stages with no
 *  producer are simply absent, so the engine's own default applies to them. */
export function producerRunners(producers: readonly RoleRunProducer[], opts: ProducerRunnerOptions = {}): Partial<StageRunners> {
  const fallback = opts.fallback ?? DEFAULT_STAGE_RUNNERS;
  const llmAvailable = opts.llmAvailable ?? (() => roleRunLlmAvailable());
  const out: Partial<StageRunners> = {};
  for (const producer of producers) {
    out[producer.kind] = async (ctx: StageContext): Promise<StageOutcome> => {
      if (producer.usesLlm && !llmAvailable()) return fallback[producer.kind](ctx);
      try {
        return await producer.run(ctx);
      } catch (err) {
        // Code only: a provider message can echo the prompt, and a prompt here carries
        // a role description or a candidate profile.
        opsLog("warn", "role-run:producer-failed", { runId: ctx.run.id, kind: producer.kind, errorName: err instanceof Error ? err.name : "unknown" });
        return fallback[producer.kind](ctx);
      }
    };
  }
  return out;
}
