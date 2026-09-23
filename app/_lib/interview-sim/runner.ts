// A simulator RUN (spark interview-uat-tranche, WP-1): many situations, a worker pool,
// one JSON dump per conversation written the moment it finishes, a run index, and a
// resumable output directory.
//
//   <out>/<situationId>.json                       SimConversation + trace (engine.ts)
//   <out>/instruments/<fixture>.<locale>-<sha>.json the instrument each dump names by
//                                                  briefSha: agenda, both briefs, the
//                                                  harness preambles
//   <out>/index.json                               every run into this directory, and a
//                                                  one-line summary per conversation
//
// RESUMABLE. A rerun into the same directory skips a situation whose dump exists, did
// not end in `error`, was produced by the SAME instrument (briefSha and
// directorVersion) AND ran the same situation (situationSha: persona, first line,
// provocations, required response) — a dump of a different brief or of an edited cast
// is stale, and mixing the two in one directory is the "instrument identity" failure the
// registry warns about (a cast run at one variant, scored as another). Errored and stale conversations run again and
// overwrite their dump.
//
// Instruments are built BEFORE any conversation starts and sequentially (they write the
// throwaway database); conversations then only talk to their providers.

import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { CANDIDATE_HARNESS_PREAMBLE, INTERVIEWER_HARNESS_PREAMBLE, runConversation, type SimConversationDump, type SimLimits } from "./engine";
import type { SimInstrument } from "./instrument";
import { instrumentLocaleFor, situationSha } from "./situations";
import type { SimFixture, SimLlm, SimSituation } from "./types";

export type SimRunOptions = {
  runId: string;
  outDir: string;
  situations: SimSituation[];
  workers: number;
  seed: number;
  limits?: Partial<SimLimits>;
  /** instrument.ts buildSimInstrument (injected so a test can count or fake builds). */
  buildInstrument: (fixture: SimFixture, locale: string | null) => Promise<SimInstrument>;
  /** Fresh providers for ONE conversation — two different instances. */
  providers: (situation: SimSituation, instrument: SimInstrument) => { interviewer: SimLlm; candidate: SimLlm };
  /** What produced this run (flags, provider ids), recorded in the index. */
  meta?: Record<string, unknown>;
  log?: (line: string) => void;
};

export type ConversationSummary = {
  situationId: string;
  fixture: SimFixture;
  file: string;
  runId: string;
  endedBy: string;
  turns: number;
  candidateTurns: number;
  calls: number;
  simMinutes: number;
  briefSha: string;
  directorVersion: string;
  tools: Record<string, number>;
  directives: Record<string, number>;
  error?: string;
};

export type SimRunResult = { ran: ConversationSummary[]; skipped: string[]; errored: number };

const count = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});

/** The one-line facts of a dump (the index row and the console line). */
export function summarizeConversation(dump: SimConversationDump, file: string): ConversationSummary {
  return {
    situationId: dump.situationId,
    fixture: dump.fixture,
    file,
    runId: dump.runId,
    endedBy: dump.endedBy,
    turns: dump.turns.length,
    candidateTurns: dump.turns.filter((t) => t.role === "candidate").length,
    calls: dump.calls,
    simMinutes: Math.round((dump.simElapsedMs / 60_000) * 10) / 10,
    briefSha: dump.instrument.briefSha,
    directorVersion: dump.instrument.directorVersion,
    tools: count(dump.turns.filter((t) => t.tool).map((t) => String(t.tool?.name))),
    directives: count((dump.trace?.directives ?? []).map((d) => d.kind)),
    ...(dump.error ? { error: dump.error } : {}),
  };
}

export function formatSummaryLine(s: ConversationSummary, position?: string): string {
  const fmt = (m: Record<string, number>) =>
    Object.entries(m)
      .map(([k, n]) => (n > 1 ? `${k}×${n}` : k))
      .join(" ") || "none";
  return [
    position ? `[${position}]` : "",
    s.situationId.padEnd(34),
    s.fixture.padEnd(9),
    s.endedBy.padEnd(13),
    `turns ${String(s.turns).padStart(3)}`,
    `calls ${String(s.calls).padStart(3)}`,
    `${s.simMinutes.toFixed(1).padStart(5)} min`,
    `tools: ${fmt(s.tools)}`,
    `directives: ${fmt(s.directives)}`,
    s.error ? `error: ${s.error.slice(0, 120)}` : "",
  ]
    .filter(Boolean)
    .join("  ");
}

function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null; // missing or half-written: treated as "no dump", so the situation runs again
  }
}

/** mulberry32 — a tiny seeded PRNG, so a run's order is reproducible from its seed. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(xs: readonly T[], seed: number): T[] {
  const out = [...xs];
  const rand = prng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

type IndexFile = { version: 1; updatedAt: string; runs: Record<string, unknown>[]; conversations: ConversationSummary[] };

function rebuildIndex(outDir: string, runs: Record<string, unknown>[]): void {
  const conversations: ConversationSummary[] = [];
  for (const name of readdirSync(outDir).sort()) {
    if (!name.endsWith(".json") || name === "index.json") continue;
    const dump = readJson<SimConversationDump>(path.join(outDir, name));
    if (dump && typeof dump.situationId === "string" && Array.isArray(dump.turns)) conversations.push(summarizeConversation(dump, name));
  }
  const index: IndexFile = { version: 1, updatedAt: new Date().toISOString(), runs, conversations };
  writeJsonAtomic(path.join(outDir, "index.json"), index);
}

/** Run every situation into `outDir` (see the header). */
export async function runSimulations(opts: SimRunOptions): Promise<SimRunResult> {
  const log = opts.log ?? (() => undefined);
  mkdirSync(path.join(opts.outDir, "instruments"), { recursive: true });

  // 1. Every instrument this run needs, once each, before any conversation.
  const instruments = new Map<string, SimInstrument>();
  for (const s of opts.situations) {
    const locale = instrumentLocaleFor(s);
    const key = `${s.fixture}.${locale ?? "auto"}`;
    if (instruments.has(key)) continue;
    const inst = await opts.buildInstrument(s.fixture, locale);
    instruments.set(key, inst);
    writeJsonAtomic(path.join(opts.outDir, "instruments", `${inst.key}-${inst.record.briefSha.replace(/^sha256:/, "").slice(0, 12)}.json`), {
      ...inst,
      harness: { interviewerPreamble: INTERVIEWER_HARNESS_PREAMBLE, candidatePreamble: CANDIDATE_HARNESS_PREAMBLE },
    });
  }
  const instrumentFor = (s: SimSituation) => instruments.get(`${s.fixture}.${instrumentLocaleFor(s) ?? "auto"}`) as SimInstrument;

  // 2. Resume: skip what an earlier run already produced with this same instrument.
  const skipped: string[] = [];
  const todo: SimSituation[] = [];
  for (const s of opts.situations) {
    const prior = readJson<SimConversationDump>(path.join(opts.outDir, `${s.id}.json`));
    const inst = instrumentFor(s);
    const current =
      prior !== null &&
      prior.endedBy !== "error" &&
      prior.instrument?.briefSha === inst.record.briefSha &&
      prior.instrument?.directorVersion === inst.record.directorVersion &&
      prior.situationSha === situationSha(s);
    if (current) skipped.push(s.id);
    else todo.push(s);
  }
  if (skipped.length) log(`resume: ${skipped.length} conversation(s) already dumped with this instrument — skipped`);

  const prior = readJson<IndexFile>(path.join(opts.outDir, "index.json"));
  const run: Record<string, unknown> = {
    runId: opts.runId,
    startedAt: new Date().toISOString(),
    seed: opts.seed,
    workers: opts.workers,
    selected: opts.situations.length,
    skipped: skipped.length,
    ...opts.meta,
  };
  const runs = [...(prior?.runs ?? []), run];
  rebuildIndex(opts.outDir, runs);

  // 3. The pool.
  const queue = seededShuffle(todo, opts.seed);
  const ran: ConversationSummary[] = [];
  let done = 0;
  const worker = async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      const inst = instrumentFor(s);
      const { interviewer, candidate } = opts.providers(s, inst);
      const dump = await runConversation({ runId: opts.runId, situation: s, instrument: inst, interviewer, candidate, limits: opts.limits });
      const file = `${s.id}.json`;
      writeJsonAtomic(path.join(opts.outDir, file), dump);
      const summary = summarizeConversation(dump, file);
      ran.push(summary);
      done += 1;
      rebuildIndex(opts.outDir, runs);
      log(formatSummaryLine(summary, `${done}/${todo.length}`));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.workers, todo.length || 1)) }, worker));

  const errored = ran.filter((r) => r.endedBy === "error").length;
  Object.assign(run, { finishedAt: new Date().toISOString(), ran: ran.length, errored });
  rebuildIndex(opts.outDir, runs);
  return { ran, skipped, errored };
}
