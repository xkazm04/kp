import { closeSync, openSync, readSync, statSync } from "node:fs";
import path from "node:path";

// DATA2 — readers for the append-only JSONL telemetry the app has always
// written and never read: analyze.log (cache_hit/duration per run, logger.ts),
// pipeline.log (per-stage timings + Gemini token usage, logger.py), comms.log
// (dead-letter records). Every read is BOUNDED — a tail window of bytes, never
// the whole file — so a months-old log can't balloon an ops request.

const LOG_DIR = process.env.KP_LOG_DIR ?? path.join(process.cwd(), "tmp");
const TAIL_BYTES = 256 * 1024; // plenty for a few hundred JSONL lines
const SAMPLE_LINES = 200;
const WEEK_MS = 7 * 86_400_000;

// Read the last `maxLines` parsed JSONL records of a log. Missing file or any
// IO/parse fault degrades to [] / skipped lines — telemetry must never error an
// ops request that the health half of the payload could still answer.
export function tailJsonl(filename: string, maxLines = SAMPLE_LINES): Record<string, unknown>[] {
  const file = path.join(LOG_DIR, filename);
  let fd: number | null = null;
  try {
    const size = statSync(file).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const length = size - start;
    if (length <= 0) return [];
    fd = openSync(file, "r");
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, start);
    const lines = buf.toString("utf-8").split("\n");
    // A mid-file start almost certainly bisects a line — drop the partial head.
    if (start > 0) lines.shift();
    const out: Record<string, unknown>[] = [];
    for (const line of lines.slice(-maxLines)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (parsed && typeof parsed === "object") out.push(parsed as Record<string, unknown>);
      } catch {
        /* torn or corrupt line — skip it */
      }
    }
    return out;
  } catch {
    return []; // no log yet (fresh workspace) or unreadable — report empty
  } finally {
    if (fd != null) closeSync(fd);
  }
}

function withinWeek(rec: Record<string, unknown>, now: number): boolean {
  const ts = typeof rec.ts === "string" ? Date.parse(rec.ts) : NaN;
  return Number.isFinite(ts) && now - ts <= WEEK_MS;
}

export type AnalyzeTelemetry = { sampled: number; cacheHitRatePct: number | null; avgDurationMs: number | null };

export function analyzeTelemetry(now = Date.now()): AnalyzeTelemetry {
  const recent = tailJsonl("analyze.log").filter((r) => withinWeek(r, now));
  if (recent.length === 0) return { sampled: 0, cacheHitRatePct: null, avgDurationMs: null };
  const hits = recent.filter((r) => r.cache_hit === true).length;
  const durations = recent.map((r) => Number(r.duration_ms)).filter((d) => Number.isFinite(d) && d >= 0);
  return {
    sampled: recent.length,
    cacheHitRatePct: Math.round((hits / recent.length) * 100),
    avgDurationMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
  };
}

export type EngineTelemetry = {
  sampled: number;
  totalTokens7d: number;
  cachedTokens7d: number;
  stageAvgMs: Record<string, number>;
};

export function engineTelemetry(now = Date.now()): EngineTelemetry {
  const recent = tailJsonl("pipeline.log").filter((r) => withinWeek(r, now));
  let totalTokens = 0;
  let cachedTokens = 0;
  const stageSums: Record<string, { sum: number; n: number }> = {};
  for (const r of recent) {
    const gemini = r.gemini as Record<string, unknown> | undefined;
    const total = Number(gemini?.total_tokens);
    const cached = Number(gemini?.cached_tokens);
    if (Number.isFinite(total)) totalTokens += total;
    if (Number.isFinite(cached)) cachedTokens += cached;
    const stages = r.stages_ms as Record<string, unknown> | undefined;
    if (stages && typeof stages === "object") {
      for (const [stage, ms] of Object.entries(stages)) {
        const v = Number(ms);
        if (!Number.isFinite(v) || v < 0) continue;
        const slot = (stageSums[stage] ??= { sum: 0, n: 0 });
        slot.sum += v;
        slot.n += 1;
      }
    }
  }
  const stageAvgMs = Object.fromEntries(
    Object.entries(stageSums).map(([stage, { sum, n }]) => [stage, Math.round(sum / n)])
  );
  return { sampled: recent.length, totalTokens7d: totalTokens, cachedTokens7d: cachedTokens, stageAvgMs };
}

export type CommsTelemetry = { deadLetters7d: number; sampled: number };

export function commsTelemetry(now = Date.now()): CommsTelemetry {
  const recent = tailJsonl("comms.log").filter((r) => withinWeek(r, now));
  // Today the writer only records dead-letters, but gate on status anyway so a
  // future success-line addition doesn't silently inflate the count.
  return { deadLetters7d: recent.filter((r) => r.status === "failed").length, sampled: recent.length };
}
