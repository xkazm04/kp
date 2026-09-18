// The interview simulator's VERDICT command line (spark interview-uat-tranche, WP-2) —
// what a run of scripts/interview-sim.ts proves. Reads one or more simulator output
// directories, applies the rule-checked reliability invariants (four states: pass, fail,
// not_provoked, not_evaluable), optionally a separately pinned judge for the binary facts
// no rule can read, and writes verdicts.json, heatmap.md, findings.json (/uat schema,
// cert_level "LC"), report.md and — with --characters — voices/<character>.md. The engine
// is app/_lib/interview-sim/verdict-run.ts.
//
//   node --import ./scripts/test-alias-loader.mjs --experimental-transform-types \
//     scripts/interview-sim-verdict.ts --runs <dir>[,<dir>] [flags]
//
// Flags:
//   --runs <dirs>            simulator output directories, comma-separated (repeatable);
//                            several = repeated samples of the same bank (cells become rates)
//   --out <dir>              where the artifacts go (default: <first run dir>/verdict)
//   --judge-model <m>        judge with the Claude CLI on model <m> (e.g. opus) — refused
//                            when <m> is the model that played the interviewer
//   --no-judge               rules only, keyless (the default): judge-method invariants
//                            report not_evaluable
//   --fake-judge             the scripted keyless judge (answers every fact null) — for
//                            exercising the plumbing, never for a verdict
//   --characters <paths>     /uat Character files (comma-separated) for the findings'
//                            `character` and the first-person voices (voice = judge model)
//   --timeout <s>            per judge / voice call (default 300)
//   --workers <n>            conversations judged in parallel (default 3)
//
// The judge reads the transcript and a rubric written for transcripts — never the
// interviewer's brief. A cached judgement (<run dir>/verdicts/<situationId>.json) is reused
// when the dump, the judge id and the rubric version all match. Refuses to call the Claude
// CLI under KP_OFFLINE. Exit 0 when the verdict ran — a failing interviewer is a RESULT,
// not a CLI error; 2 on a usage error or a refusal (offline, same-model judge, mixed
// instruments). Never touches a database.

import { existsSync } from "node:fs";
import path from "node:path";

import { fakeCharacterVoice, fakeJudge } from "@/app/_lib/interview-sim/fake";
import { claudeCliLlm, SimProviderError } from "@/app/_lib/interview-sim/providers";
import { InstrumentIdentityError, JudgeIndependenceError, verdictRuns } from "@/app/_lib/interview-sim/verdict-run";
import type { SimLlm } from "@/app/_lib/interview-sim/types";

type Flags = Map<string, string[]>;
class UsageError extends Error {}
const BOOLEAN = ["no-judge", "fake-judge"];

function parseFlags(argv: string[]): Flags {
  const flags: Flags = new Map();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new UsageError(`unexpected argument ${a}`);
    const [name, inline] = a.slice(2).split("=", 2);
    const value = BOOLEAN.includes(name) ? "true" : (inline ?? argv[++i]);
    if (value === undefined) throw new UsageError(`--${name} needs a value`);
    flags.set(name, [...(flags.get(name) ?? []), value]);
  }
  return flags;
}

const list = (flags: Flags, name: string) => (flags.get(name) ?? []).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
const one = (flags: Flags, name: string) => flags.get(name)?.at(-1);
const int = (flags: Flags, name: string, fallback: number) => {
  const v = one(flags, name);
  if (v === undefined) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) throw new UsageError(`--${name} must be a positive whole number`);
  return n;
};

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2));
  const known = new Set(["runs", "out", "judge-model", "no-judge", "fake-judge", "characters", "timeout", "workers"]);
  for (const k of flags.keys()) if (!known.has(k)) throw new UsageError(`unknown flag --${k}`);
  const dirs = list(flags, "runs").map((d) => path.resolve(d));
  if (dirs.length === 0) throw new UsageError("--runs <dir>[,<dir>] is required");
  for (const d of dirs) if (!existsSync(path.join(d, "index.json"))) throw new UsageError(`${d} holds no index.json — not a simulator output directory`);
  const characters = list(flags, "characters").map((p) => path.resolve(p));
  for (const p of characters) if (!existsSync(p)) throw new UsageError(`Character file not found: ${p}`);

  const judgeModel = one(flags, "judge-model")?.trim() || null;
  const modes = [judgeModel ? "--judge-model" : "", flags.has("no-judge") ? "--no-judge" : "", flags.has("fake-judge") ? "--fake-judge" : ""].filter(Boolean);
  if (modes.length > 1) throw new UsageError(`choose one of ${modes.join(", ")}`);
  const timeoutMs = int(flags, "timeout", 300) * 1000;

  let judge: SimLlm | null = null;
  let voice: SimLlm | null = null;
  if (judgeModel) {
    // Refused under KP_OFFLINE and when the CLI is missing — before anything is read.
    judge = claudeCliLlm({ model: judgeModel, timeoutMs });
    voice = judge;
  } else if (flags.has("fake-judge")) {
    judge = fakeJudge();
    voice = fakeCharacterVoice();
  }
  const mode = judgeModel ? `judge ${judge?.id}` : flags.has("fake-judge") ? "fake judge (scripted, keyless — plumbing only)" : "rules only (keyless)";
  console.log(`[interview-sim-verdict] ${dirs.length} run dir(s), ${mode}${characters.length ? `, ${characters.length} Character file(s)` : ""}`);

  const result = await verdictRuns({
    dirs,
    outDir: one(flags, "out") ? path.resolve(one(flags, "out") as string) : undefined,
    judge,
    judgeModel,
    characters,
    voiceLlm: voice,
    concurrency: int(flags, "workers", 3),
    log: (line) => console.log(`[interview-sim-verdict] ${line}`),
  });

  for (const w of result.warnings) console.warn(`[interview-sim-verdict] WARNING: ${w}`);
  const gaps = result.findings.filter((f) => f.type !== "strength");
  const cov = result.coverage;
  console.log(
    `[interview-sim-verdict] ${result.reliabilityFails} reliability fail(s) across ${result.conversations.length} conversation(s); ` +
      `coverage ${cov.produced}/${cov.selected}; ${gaps.length} finding(s), ${result.findings.length - gaps.length} strength row(s)`,
  );
  for (const f of result.files) console.log(`[interview-sim-verdict] wrote ${f}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    if (err instanceof UsageError || err instanceof SimProviderError || err instanceof JudgeIndependenceError || err instanceof InstrumentIdentityError) {
      console.error(`[interview-sim-verdict] ${err.message}`);
      process.exit(2);
    }
    console.error(`[interview-sim-verdict] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exit(2);
  },
);
