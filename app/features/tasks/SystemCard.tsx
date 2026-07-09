"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import type { EngineAvailability } from "@/app/_lib/engine-preflight";

// DATA2 — the System panel: the operator's read of telemetry the app always
// collected and never surfaced. Lives on the Background-tasks tab (the
// operator's natural home, English like the rest of this surface). Read-only;
// /api/ops bounds every log read server-side.

type Ops = {
  ok: boolean;
  seeds: "ok" | "degraded";
  // Scheduler liveness sub-check (bug-ui-scan-2026-07-09 #1): whether the automation
  // clock is still ticking. "stalled" = a wedged/dead clock (reminders + GDPR sweep
  // silently halted); "starting" = fresh boot before the first heartbeat.
  clock: "healthy" | "starting" | "stalled";
  degradedReasons: string[];
  tables: Record<string, number>;
  queue: { running: number; queued: number };
  engines: EngineAvailability;
  promptCache: { rows: number; expiredBacklog: number };
  analyze: { sampled: number; cacheHitRatePct: number | null; avgDurationMs: number | null };
  engine: { sampled: number; totalTokens7d: number; cachedTokens7d: number; stageAvgMs: Record<string, number> };
  comms: { deadLetters7d: number; sampled: number };
  schedule: { reconcileFailures: number; noSlotStalls: number };
};

function Dot({ on }: { on: boolean }) {
  return <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${on ? "bg-moss" : "bg-coral"}`} />;
}

function StatCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md bg-paper/70 px-3 py-2">
      <p className="text-meta uppercase text-steel">{label}</p>
      <p className="mt-0.5 text-base font-semibold text-ink nums">{value}</p>
      {sub ? <p className="text-sm text-steel">{sub}</p> : null}
    </div>
  );
}

export function SystemCard() {
  const { data, error, reload } = useJsonFetch<Ops>("/api/ops", "Couldn't load system status.");

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-serif text-h2 text-ink">System</h3>
        <span className="text-meta uppercase text-steel">cost · cache · engines</span>
      </div>

      {error ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-coral/40 bg-coral/5 px-3 py-2">
          <p className="text-base text-coral">{error}</p>
          <button
            type="button"
            onClick={reload}
            className="focus-ring inline-flex shrink-0 items-center gap-1 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper"
          >
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      ) : !data ? (
        <p className="mt-3 text-base text-steel">Loading…</p>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-ink">
            <span className="inline-flex items-center gap-1.5">
              <Dot on={data.ok} /> {data.ok ? "Healthy" : "Degraded"}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Dot on={data.seeds === "ok"} /> Seeds
            </span>
            <span
              className="inline-flex items-center gap-1.5"
              title="Automation clock heartbeat — drives interview reminders, offer-expiry lapses, and the GDPR consent sweep"
            >
              <Dot on={data.clock === "healthy"} />{" "}
              {data.clock === "healthy" ? "Scheduler" : data.clock === "starting" ? "Scheduler starting" : "Scheduler stalled"}
            </span>
            <span className="inline-flex items-center gap-1.5" title="GEMINI_API_KEY / GOOGLE_API_KEY configured">
              <Dot on={data.engines.gemini} /> Gemini
            </span>
            <span className="inline-flex items-center gap-1.5" title="claude CLI resolves on PATH">
              <Dot on={data.engines.claudeCli} /> Claude CLI
            </span>
            <span className="text-steel">
              queue {data.queue.running} running · {data.queue.queued} queued
            </span>
          </div>
          {data.degradedReasons.length > 0 ? (
            <ul className="space-y-0.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              {data.degradedReasons.map((r) => (
                <li key={r} className="flex items-start gap-1.5">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden /> {r}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <StatCell
              label="Cache hit rate"
              value={data.analyze.cacheHitRatePct != null ? `${data.analyze.cacheHitRatePct}%` : "—"}
              sub={data.analyze.sampled ? `${data.analyze.sampled} runs · 7d` : "no runs this week"}
            />
            <StatCell
              label="Tokens · 7d"
              value={data.engine.totalTokens7d.toLocaleString("en-US")}
              sub={data.engine.cachedTokens7d ? `${data.engine.cachedTokens7d.toLocaleString("en-US")} cached` : undefined}
            />
            <StatCell
              label="Avg analysis"
              value={data.analyze.avgDurationMs != null ? `${Math.round(data.analyze.avgDurationMs / 1000)}s` : "—"}
              sub={data.engine.sampled ? `${data.engine.sampled} engine runs · 7d` : undefined}
            />
            <StatCell
              label="Prompt cache"
              value={String(data.promptCache.rows)}
              sub={data.promptCache.expiredBacklog ? `${data.promptCache.expiredBacklog} expired pending prune` : "no expired backlog"}
            />
          </div>

          {Object.keys(data.engine.stageAvgMs).length > 0 ? (
            <div>
              <p className="text-meta uppercase text-steel">Avg stage timings (7d)</p>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink">
                {Object.entries(data.engine.stageAvgMs)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 6)
                  .map(([stage, ms]) => (
                    <li key={stage} className="nums">
                      <span className="font-mono text-steel">{stage}</span> {ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className={data.comms.deadLetters7d > 0 ? "font-semibold text-coral" : "text-steel"}>
              {data.comms.deadLetters7d} dead-lettered messages · 7d
            </span>
            <span className={data.schedule.reconcileFailures > 0 ? "font-semibold text-coral" : "text-steel"}>
              {data.schedule.reconcileFailures} schedule reconcile failures
            </span>
            <span className={data.schedule.noSlotStalls > 0 ? "font-semibold text-amber-700" : "text-steel"}>
              {data.schedule.noSlotStalls} fully-booked stalls
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
