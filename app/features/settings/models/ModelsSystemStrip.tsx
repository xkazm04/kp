"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { BTN_SECONDARY, META_LABEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import type { EngineAvailability } from "@/app/_lib/engine-preflight";

// DATA2 — the operator's read of telemetry the app always collected and never
// surfaced: engine availability, the run queue, the automation clock, and the
// 7-day analyze/engine rollups. Read-only; /api/ops bounds every log read
// server-side.
//
// This used to be a standalone "System" card on the Background-tasks tab, which
// meant the workspace answered "what is the LLM layer doing" in two places that
// half-overlapped: the card reported the prompt cache and a 7-day token total
// that the Models tab's Usage & cost ledger already reports (per use case, over
// 30 days, with the deterministic-fallback and unpriced-cost splits the card
// never had). Rather than keep two readouts drifting apart, the card's
// NON-duplicated half moved into the usage panel as this strip, and the
// duplicated half (prompt-cache rows, token totals) was dropped in favour of the
// ledger's version.
//
// It renders ABOVE the ledger because it is the precondition for reading it: a
// stalled scheduler or a missing engine key explains a suspiciously cheap week.
//
// The CHROME reads from the `models.system` catalog. What stays verbatim is the
// machine payload it displays: engine names, stage keys, the env-var names in the
// preflight tooltips, and `degradedReasons`, which arrive from /api/ops as
// canonical English server diagnostics with no code to resolve
// (docs/architecture/localization.md).

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
/** The placeholder for "no sample yet" — a typographic mark, not copy. */
const EMPTY = "—";
const ENGINE_GEMINI = "Gemini";
const ENGINE_CLAUDE_CLI = "Claude CLI";

function Dot({ on }: { on: boolean }) {
  return <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${on ? "bg-moss" : "bg-coral"}`} />;
}

function StatCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md bg-paper/70 px-3 py-2">
      <p className={META_LABEL}>{label}</p>
      <p className="mt-0.5 text-base font-semibold text-ink nums">{value}</p>
      {sub ? <p className="text-sm text-steel">{sub}</p> : null}
    </div>
  );
}

export function ModelsSystemStrip() {
  const t = useTranslations("models.system");
  const { data, error, reload } = useJsonFetch<Ops>("/api/ops", t("loadFailed"));

  return (
    <div className={`${PANEL_SUNKEN} mt-3 p-3`}>
      <h4 className={META_LABEL}>{t("title")}</h4>

      {error ? (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-coral/40 bg-coral/5 px-3 py-2">
          <p className="text-base text-coral">{error}</p>
          <button type="button" onClick={reload} className={`${BTN_SECONDARY} h-8 shrink-0 gap-1 px-3 text-sm`}>
            <RefreshCw size={12} aria-hidden /> {t("retry")}
          </button>
        </div>
      ) : !data ? (
        // Loading choreography tier 2: hold the strip's height, quietly.
        <div className="reveal-quiet mt-2 min-h-[7rem]" aria-hidden />
      ) : (
        <div className="mt-2 space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-ink">
            <span className="inline-flex items-center gap-1.5">
              <Dot on={data.ok} /> {data.ok ? t("healthy") : t("degraded")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Dot on={data.seeds === "ok"} /> {t("seeds")}
            </span>
            <span className="inline-flex items-center gap-1.5" title={t("clockTitle")}>
              <Dot on={data.clock === "healthy"} />{" "}
              {data.clock === "healthy"
                ? t("scheduler")
                : data.clock === "starting"
                  ? t("schedulerStarting")
                  : t("schedulerStalled")}
            </span>
            {/* These two titles name an ENV VAR and a binary on PATH, not copy —
                translating them would make the preflight hint wrong. */}
            <span className="inline-flex items-center gap-1.5" title="GEMINI_API_KEY / GOOGLE_API_KEY configured">
              <Dot on={data.engines.gemini} /> {ENGINE_GEMINI}
            </span>
            <span className="inline-flex items-center gap-1.5" title="claude CLI resolves on PATH">
              <Dot on={data.engines.claudeCli} /> {ENGINE_CLAUDE_CLI}
            </span>
            <span className="text-steel">{t("queue", { running: data.queue.running, queued: data.queue.queued })}</span>
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

          {/* Only the two cells the ledger below does NOT already report. Prompt-cache
              rows and token totals live in the ledger's own footer/columns. */}
          <div className="grid gap-2 sm:grid-cols-2">
            <StatCell
              label={t("cacheHitRate")}
              value={data.analyze.cacheHitRatePct != null ? `${data.analyze.cacheHitRatePct}%` : EMPTY}
              sub={data.analyze.sampled ? t("runs7d", { count: data.analyze.sampled }) : t("noRuns")}
            />
            <StatCell
              label={t("avgAnalysis")}
              value={data.analyze.avgDurationMs != null ? `${Math.round(data.analyze.avgDurationMs / 1000)}s` : EMPTY}
              sub={data.engine.sampled ? t("engineRuns7d", { count: data.engine.sampled }) : undefined}
            />
          </div>

          {Object.keys(data.engine.stageAvgMs).length > 0 ? (
            <div>
              <p className={META_LABEL}>{t("stageTimings")}</p>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink">
                {Object.entries(data.engine.stageAvgMs)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 6)
                  .map(([stage, ms]) => (
                    <li key={stage} className="nums">
                      <span className="font-mono text-steel">{stage}</span>{" "}
                      {ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className={data.comms.deadLetters7d > 0 ? "font-semibold text-coral" : "text-steel"}>
              {t("deadLetters", { count: data.comms.deadLetters7d })}
            </span>
            <span className={data.schedule.reconcileFailures > 0 ? "font-semibold text-coral" : "text-steel"}>
              {t("reconcileFailures", { count: data.schedule.reconcileFailures })}
            </span>
            <span className={data.schedule.noSlotStalls > 0 ? "font-semibold text-amber-700" : "text-steel"}>
              {t("bookedStalls", { count: data.schedule.noSlotStalls })}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
