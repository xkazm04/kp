"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import type { SpendOps } from "./useSpendData";

// Engine context as INLINE FACTS, not a card: which engines can serve, whether
// the automation clock is alive, what the queue is doing, and the three failure
// counters that explain a suspiciously cheap week.
//
// The old System card wrapped all of this in its own bordered panel, which is
// what made nesting it inside the usage panel look like a bug. Stripped to a
// line of dots and a line of counters, it reads as a footnote to the spend
// above it — which is what it is.
//
// The three failure counters render ONLY when non-zero. A spend reader is not
// triaging the scheduler, so three permanent zeroes are noise — but this is the
// only screen in the app that carries `reconcileFailures` and `noSlotStalls` at
// all (dead letters also surface per-message in the Channels ledger), so hiding
// them unconditionally would delete an alarm rather than quiet it. Silent when
// healthy, loud when not.

// Engine proper nouns: constants, not JSX text, because they are product names
// that never translate (docs/i18n/glossary.md — Do-Not-Translate).
const ENGINE_GEMINI = "Gemini";
const ENGINE_CLAUDE_CLI = "Claude CLI";

function Dot({ on }: { on: boolean }) {
  return <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${on ? "bg-moss" : "bg-coral"}`} />;
}

export function SpendEngineFacts({ ops }: { ops: SpendOps }) {
  const t = useTranslations("models.system");
  const alarms = [
    ops.comms.deadLetters7d > 0 ? { key: "deadLetters" as const, count: ops.comms.deadLetters7d, tone: "text-coral" } : null,
    ops.schedule.reconcileFailures > 0
      ? { key: "reconcileFailures" as const, count: ops.schedule.reconcileFailures, tone: "text-coral" }
      : null,
    ops.schedule.noSlotStalls > 0
      ? { key: "bookedStalls" as const, count: ops.schedule.noSlotStalls, tone: "text-amber-700" }
      : null,
  ].filter((a): a is { key: "deadLetters" | "reconcileFailures" | "bookedStalls"; count: number; tone: string } => a !== null);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-ink">
        <span className="inline-flex items-center gap-1.5">
          <Dot on={ops.ok} /> {ops.ok ? t("healthy") : t("degraded")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Dot on={ops.seeds === "ok"} /> {t("seeds")}
        </span>
        <span className="inline-flex items-center gap-1.5" title={t("clockTitle")}>
          <Dot on={ops.clock === "healthy"} />{" "}
          {ops.clock === "healthy" ? t("scheduler") : ops.clock === "starting" ? t("schedulerStarting") : t("schedulerStalled")}
        </span>
        {/* These two titles name an ENV VAR and a binary on PATH, not copy —
            translating them would make the preflight hint wrong. */}
        <span className="inline-flex items-center gap-1.5" title="GEMINI_API_KEY / GOOGLE_API_KEY configured">
          <Dot on={ops.engines.gemini} /> {ENGINE_GEMINI}
        </span>
        <span className="inline-flex items-center gap-1.5" title="claude CLI resolves on PATH">
          <Dot on={ops.engines.claudeCli} /> {ENGINE_CLAUDE_CLI}
        </span>
        <span className="text-steel">{t("queue", { running: ops.queue.running, queued: ops.queue.queued })}</span>
      </div>

      {ops.degradedReasons.length > 0 ? (
        <ul className="space-y-0.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {/* `degradedReasons` are canonical English server diagnostics with no
              code to resolve (docs/architecture/localization.md). */}
          {ops.degradedReasons.map((r) => (
            <li key={r} className="flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden /> {r}
            </li>
          ))}
        </ul>
      ) : null}

      {alarms.length > 0 ? (
        <div role="status" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {alarms.map((alarm) => (
            <span key={alarm.key} className={`font-semibold ${alarm.tone}`}>
              {t(alarm.key, { count: alarm.count })}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
