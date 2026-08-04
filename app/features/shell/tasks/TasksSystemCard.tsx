"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { useNumberFormat } from "@/app/_lib/use-number-format";
import type { EngineAvailability } from "@/app/_lib/engine-preflight";

// DATA2 — the System panel: the operator's read of telemetry the app always
// collected and never surfaced. Lives on the Background-tasks tab (the
// operator's natural home). Read-only; /api/ops bounds every log read
// server-side.
//
// This card used to be English-only "like the rest of this surface"; the rest of
// this surface is localized now, and an operator reading a health panel is a UI
// user like any other, so the CHROME reads from the `tasks.system` catalog.
// What stays verbatim is the machine payload it displays: engine and table
// names, stage keys, the env-var names in the preflight tooltips, and
// `degradedReasons`, which arrive from /api/ops as canonical English server
// diagnostics with no code to resolve (docs/architecture/localization.md).

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

// Engine proper nouns: held as constants, not JSX text, because they are product
// names that never translate (docs/i18n/glossary.md — Do-Not-Translate).
/** The em-dash placeholder for "no sample yet" — a typographic mark, not copy. */
const EMPTY = "—";
const ENGINE_GEMINI = "Gemini";
const ENGINE_CLAUDE_CLI = "Claude CLI";

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
  const t = useTranslations("tasks");
  const n = useNumberFormat();
  const { data, error, reload } = useJsonFetch<Ops>("/api/ops", t("system.loadFailed"));

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-serif text-h2 text-ink">{t("system.title")}</h3>
        <span className="text-meta uppercase text-steel">{t("system.meta")}</span>
      </div>

      {error ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-coral/40 bg-coral/5 px-3 py-2">
          <p className="text-base text-coral">{error}</p>
          <button
            type="button"
            onClick={reload}
            className="focus-ring inline-flex shrink-0 items-center gap-1 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper"
          >
            <RefreshCw size={12} /> {t("system.retry")}
          </button>
        </div>
      ) : !data ? (
        <p className="mt-3 text-base text-steel">{t("system.loading")}</p>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-ink">
            <span className="inline-flex items-center gap-1.5">
              <Dot on={data.ok} /> {data.ok ? t("system.healthy") : t("system.degraded")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Dot on={data.seeds === "ok"} /> {t("system.seeds")}
            </span>
            <span className="inline-flex items-center gap-1.5" title={t("system.clockTitle")}>
              <Dot on={data.clock === "healthy"} />{" "}
              {data.clock === "healthy"
                ? t("system.scheduler")
                : data.clock === "starting"
                  ? t("system.schedulerStarting")
                  : t("system.schedulerStalled")}
            </span>
            {/* These two titles name an ENV VAR and a binary on PATH, not copy —
                translating them would make the preflight hint wrong. */}
            <span className="inline-flex items-center gap-1.5" title="GEMINI_API_KEY / GOOGLE_API_KEY configured">
              <Dot on={data.engines.gemini} /> {ENGINE_GEMINI}
            </span>
            <span className="inline-flex items-center gap-1.5" title="claude CLI resolves on PATH">
              <Dot on={data.engines.claudeCli} /> {ENGINE_CLAUDE_CLI}
            </span>
            <span className="text-steel">
              {t("system.queue", { running: data.queue.running, queued: data.queue.queued })}
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
              label={t("system.cacheHitRate")}
              value={data.analyze.cacheHitRatePct != null ? `${data.analyze.cacheHitRatePct}%` : EMPTY}
              sub={data.analyze.sampled ? t("system.runs7d", { count: data.analyze.sampled }) : t("system.noRuns")}
            />
            <StatCell
              label={t("system.tokens7d")}
              // Grouped in the READER's locale — a hardcoded "en-US" here was a
              // formatting-locale bug (docs/architecture/localization.md).
              value={n.grouped(data.engine.totalTokens7d)}
              sub={data.engine.cachedTokens7d ? t("system.cached", { tokens: n.grouped(data.engine.cachedTokens7d) }) : undefined}
            />
            <StatCell
              label={t("system.avgAnalysis")}
              value={data.analyze.avgDurationMs != null ? `${Math.round(data.analyze.avgDurationMs / 1000)}s` : EMPTY}
              sub={data.engine.sampled ? t("system.engineRuns7d", { count: data.engine.sampled }) : undefined}
            />
            <StatCell
              label={t("system.promptCache")}
              value={String(data.promptCache.rows)}
              sub={
                data.promptCache.expiredBacklog
                  ? t("system.expiredPending", { count: data.promptCache.expiredBacklog })
                  : t("system.noExpired")
              }
            />
          </div>

          {Object.keys(data.engine.stageAvgMs).length > 0 ? (
            <div>
              <p className="text-meta uppercase text-steel">{t("system.stageTimings")}</p>
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
              {t("system.deadLetters", { count: data.comms.deadLetters7d })}
            </span>
            <span className={data.schedule.reconcileFailures > 0 ? "font-semibold text-coral" : "text-steel"}>
              {t("system.reconcileFailures", { count: data.schedule.reconcileFailures })}
            </span>
            <span className={data.schedule.noSlotStalls > 0 ? "font-semibold text-amber-700" : "text-steel"}>
              {t("system.bookedStalls", { count: data.schedule.noSlotStalls })}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
