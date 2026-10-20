// The interview SIMULATOR's command line (spark interview-uat-tranche, WP-1) — the /uat
// "LC" (conversation) level: the REAL directed interviewer (agenda, private brief,
// director policy, tool results) driven in text against simulated candidates, on a
// throwaway database and a simulated clock. The engine is app/_lib/interview-sim/.
//
//   node --import ./scripts/test-alias-loader.mjs --experimental-transform-types \
//     scripts/interview-sim.ts [flags]
//
// Flags:
//   --situation <ids>        comma-separated ids or substrings (repeatable); default: all
//   --fixture <names>        kit,prep,debrief,student,rehearsal
//   --lang <codes>           en,cs
//   --workers <n>            conversations in parallel (default 1)
//   --max-calls <n>          model calls per conversation, both sides (default 120)
//   --max-turns <n>          candidate turns per conversation (default 50)
//   --out <dir>              where dumps go (default: <tmp>/kp-interview-sim/<runId>);
//                            a rerun into the same dir skips what is already dumped
//   --fake                   keyless: scripted interviewer + candidate, no model at all
//   --seed <n>               run order + the fake's line choice (default 1)
//   --model <m>              --model for both sides of the Claude CLI
//   --interviewer-model <m>  … for the stand-in interviewer only
//   --candidate-model <m>    … for the simulated candidate only
//   --timeout <s>            per CLI call (default 180)
//   --db <path>              the throwaway SQLite file (default: a fresh temp file)
//   --keep-db                do not delete the temp database afterwards
//   --list                   print the situation bank and exit
//
// NEVER the operator's database: KP_DB_PATH is pointed at a temp file BEFORE any store
// module is imported (db-path.ts freezes the path at import), and the instrument builder
// refuses anything inside the repository's data/ directory. Refuses to call the Claude
// CLI under KP_OFFLINE (use --fake).

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadSituations, instrumentLocaleFor } from "@/app/_lib/interview-sim/situations";
import { SIM_FIXTURES, type SimSituation } from "@/app/_lib/interview-sim/types";
import { claudeCliLlm, SimProviderError } from "@/app/_lib/interview-sim/providers";
import { fakeCandidate, fakeInterviewer } from "@/app/_lib/interview-sim/fake";

type Flags = Map<string, string[]>;

function parseFlags(argv: string[]): Flags {
  const flags: Flags = new Map();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument ${a}`);
    const [name, inline] = a.slice(2).split("=", 2);
    const boolean = ["fake", "keep-db", "list"].includes(name);
    const value = boolean ? "true" : (inline ?? argv[++i]);
    if (value === undefined) throw new Error(`--${name} needs a value`);
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
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} must be a whole number`);
  return n;
};

function select(all: SimSituation[], flags: Flags): SimSituation[] {
  const ids = list(flags, "situation");
  const fixtures = list(flags, "fixture");
  const langs = list(flags, "lang");
  for (const f of fixtures) if (!(SIM_FIXTURES as readonly string[]).includes(f)) throw new Error(`unknown fixture ${f}`);
  return all.filter(
    (s) =>
      (ids.length === 0 || ids.some((id) => s.id === id || s.id.includes(id))) &&
      (fixtures.length === 0 || fixtures.includes(s.fixture)) &&
      (langs.length === 0 || langs.includes(s.language)),
  );
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2));
  const all = loadSituations();
  if (flags.has("list")) {
    for (const s of all) console.log(`${s.id.padEnd(34)} ${s.fixture.padEnd(9)} ${s.language}  ${instrumentLocaleFor(s) ?? "auto"}  provokes: ${s.provokes.join(", ")}`);
    console.log(`${all.length} situations`);
    return 0;
  }
  const situations = select(all, flags);
  if (situations.length === 0) {
    console.error("[interview-sim] no situation matches the filters (see --list)");
    return 2;
  }
  const fake = flags.has("fake");
  const seed = int(flags, "seed", 1);
  const workers = Math.max(1, int(flags, "workers", 1));
  const limits = { maxCalls: int(flags, "max-calls", 120), maxCandidateTurns: int(flags, "max-turns", 50) };
  const runId = `sim-${stamp()}-s${seed}${fake ? "-fake" : ""}`;
  const outDir = path.resolve(one(flags, "out") ?? path.join(tmpdir(), "kp-interview-sim", runId));

  // Providers first: a refusal (KP_OFFLINE, no CLI) must cost nothing, not even a seed.
  const both = one(flags, "model") ?? null;
  const ivModel = one(flags, "interviewer-model") ?? both;
  const cvModel = one(flags, "candidate-model") ?? both;
  const timeoutMs = int(flags, "timeout", 180) * 1000;
  if (!fake) {
    try {
      claudeCliLlm({ model: ivModel, timeoutMs, role: "interviewer" });
    } catch (err) {
      if (err instanceof SimProviderError) {
        console.error(`[interview-sim] ${err.message}`);
        return 2;
      }
      throw err;
    }
  }

  // The throwaway database — set BEFORE any store module is imported.
  const dbArg = one(flags, "db");
  const dbDir = dbArg ? null : mkdtempSync(path.join(tmpdir(), "kp-interview-sim-db-"));
  const dbPath = dbArg ? path.resolve(dbArg) : path.join(dbDir as string, "kp.sqlite");
  mkdirSync(path.dirname(dbPath), { recursive: true });
  process.env.KP_DB_PATH = dbPath;

  const { assertThrowawayDb, buildSimInstrument } = await import("@/app/_lib/interview-sim/instrument");
  const { runSimulations } = await import("@/app/_lib/interview-sim/runner");
  assertThrowawayDb();

  console.log(`[interview-sim] ${runId}: ${situations.length} situation(s), ${fake ? "fake providers (keyless)" : `Claude CLI (interviewer ${ivModel ?? "default"}, candidate ${cvModel ?? "default"})`}, ${workers} worker(s)`);
  console.log(`[interview-sim] out: ${outDir}`);
  console.log(`[interview-sim] db:  ${dbPath}`);

  try {
    const result = await runSimulations({
      runId,
      outDir,
      situations,
      workers,
      seed,
      limits,
      buildInstrument: buildSimInstrument,
      providers: (s, inst) =>
        fake
          ? { interviewer: fakeInterviewer(inst.agenda), candidate: fakeCandidate(s, { seed }) }
          : {
              interviewer: claudeCliLlm({ model: ivModel, timeoutMs, role: "interviewer" }),
              candidate: claudeCliLlm({ model: cvModel, timeoutMs, role: "candidate" }),
            },
      meta: { provider: fake ? "fake" : "claude-cli", interviewerModel: ivModel, candidateModel: cvModel, limits },
      log: (line) => console.log(line),
    });
    console.log(`[interview-sim] done: ${result.ran.length} ran, ${result.skipped.length} skipped, ${result.errored} errored → ${path.join(outDir, "index.json")}`);
    return result.errored > 0 ? 1 : 0;
  } finally {
    const holder = globalThis as typeof globalThis & { __kpDb?: { close(): void } };
    try {
      holder.__kpDb?.close();
    } catch {
      /* already closed — nothing to release */
    }
    if (dbDir && !flags.has("keep-db")) {
      try {
        rmSync(dbDir, { recursive: true, force: true });
      } catch {
        /* an isolated store still holds the file (Windows); the OS temp cleaner gets it */
      }
    }
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`[interview-sim] ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    process.exit(2);
  },
);
