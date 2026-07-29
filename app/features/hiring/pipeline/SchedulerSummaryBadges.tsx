"use client";

// Shared types + the per-run summary badges / outcome chip for SchedulerControl.
// Split out of SchedulerControl.tsx.

import { AlertTriangle, ArrowUpRight, Pause, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge, type BadgeTone } from "@/app/_components/Badge";
import { type DecisionOutcome } from "@/app/_lib/decision-attribution";

export type Summary = { advanced?: number; rejected?: number; held?: number; alerts?: number; errors?: number; evaluated?: number };
// AUTO2 — the persisted per-run record the schedule GET has always returned
// (and this component ignored): trigger/status/summary plus the decision rows
// the pass used to compute and discard.
export type RunDecision = { entryId?: string; action?: string; reason?: string; outcome?: string };
export type SchedulerRun = {
  id: number;
  trigger: string;
  status: string;
  summary: Summary | null;
  decisions: RunDecision[] | null;
  error: string | null;
  startedAt: string;
};
export type Schedule = {
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt: string | null;
  lastSummary: Summary | null;
};
// Mirrors tickScheduler()'s return shape (scheduler.ts) as forwarded by the POST route.
export type Tick = { ran: boolean; summary?: Summary | null; error?: string };
export type RunResult = { tone: "ok" | "neutral" | "error"; text: string };

export const RESULT_TONE: Record<RunResult["tone"], string> = {
  ok: "bg-moss/15 text-moss",
  neutral: "bg-stone-100 text-steel",
  error: "bg-coral/10 text-coral",
};

// Per-decision outcome chip — failed / CAS-skipped / fairness-refused / queued
// states the action badge alone can't convey (a failed REJECT used to render
// exactly like an applied one, and skips were dropped from the list entirely).
const OUTCOME_STYLE: Record<DecisionOutcome, string> = {
  applied: "",
  failed: "bg-coral/10 text-coral",
  skipped: "bg-stone-100 text-steel",
  fairness_blocked: "bg-amber-50 text-amber-700",
  queued: "bg-stone-100 text-steel",
};

export function OutcomeChip({ outcome }: { outcome: DecisionOutcome }) {
  const t = useTranslations("pipeline.scheduler");
  return (
    <span className={`mr-1 inline-flex items-center gap-0.5 rounded px-1 py-0.5 font-semibold uppercase ${OUTCOME_STYLE[outcome]}`}>
      {outcome === "failed" ? <XCircle size={10} aria-hidden /> : null}
      {outcome === "fairness_blocked" ? <AlertTriangle size={10} aria-hidden /> : null}
      {t(`outcome.${outcome}` as Parameters<typeof t>[0])}
    </span>
  );
}

// The four buckets a policy pass moves entries into, tone-coded so the last-run
// row reads at a glance — and so `held` (tracked by the backend, AutomationSummary)
// is shown instead of silently dropped. Zero counts render dimmed (Badge.muted).
// This is the ONE table of buckets: both the badge row (SummaryBadges) and the
// "Run now" chip (describeTick, in SchedulerControl.tsx) are driven from it, so
// adding a fifth outcome is a single-line change that can't leave the two
// summaries out of sync. The per-bucket presentation; the human label is
// localized via the `pipeline.scheduler` catalog (labelKey), so the chip and the
// badges never drift.
export const SUMMARY_COUNTS: { key: keyof Summary; tone: BadgeTone; icon: LucideIcon; labelKey: string }[] = [
  { key: "advanced", tone: "positive", icon: ArrowUpRight, labelKey: "summaryAdvanced" },
  { key: "rejected", tone: "critical", icon: XCircle, labelKey: "summaryRejected" },
  { key: "held", tone: "neutral", icon: Pause, labelKey: "summaryHeld" },
  { key: "alerts", tone: "caution", icon: AlertTriangle, labelKey: "summaryAlerts" },
  // AUTO2 — apply failures were tracked by the backend and invisible here.
  { key: "errors", tone: "critical", icon: AlertTriangle, labelKey: "summaryErrors" },
];

// Render the last-run summary as semantic badges (one per bucket), every count
// through the shared Badge so outcomes look identical to the rest of the pipeline.
export function SummaryBadges({ summary }: { summary: Summary }) {
  const t = useTranslations("pipeline.scheduler");
  return (
    <>
      {SUMMARY_COUNTS.map(({ key, tone, icon, labelKey }) => {
        const n = summary[key] ?? 0;
        const label = t(labelKey as Parameters<typeof t>[0], { n });
        return (
          <Badge
            key={key}
            tone={tone}
            icon={icon}
            muted={n === 0}
            label={label}
            ariaLabel={t("thisRun", { label })}
            className="nums"
          />
        );
      })}
    </>
  );
}
