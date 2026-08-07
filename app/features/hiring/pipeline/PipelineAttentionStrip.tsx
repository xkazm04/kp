"use client";

// The board's "before you triage, deal with these" strip — ONE surface for the two
// queues that outrank the board itself.
//
// They used to be two independently-styled full-width banners stacked inside
// PipelinePopulatedBoard, i.e. BELOW the Getting-started checklist and directly on
// top of the filter row: two different alert idioms (red-wash vs coral-wash, both
// whole-banner buttons) competing for the same glance, wedged between the setup
// content and the board's controls. Consolidated here they read as one ranked list
// — highest-severity row first — and they sit above Getting started, because a
// stalled application outranks a setup checklist.
//
// Renders nothing when both queues are empty; the strip must never be a permanent
// fixture the eye learns to skip.

import { AlertTriangle, BellRing, CircleCheckBig } from "lucide-react";
import { PANEL } from "@/app/_components/ui/recipes";
import { Fade } from "./PipelineMotion";
import type { PipelineTabTranslator } from "./pipelineTranslator";

type AttentionTone = "red" | "coral";

const TONE: Record<AttentionTone, { dot: string; action: string; row: string }> = {
  red: { dot: "bg-red-600", action: "text-red-700", row: "hover:bg-red-50" },
  coral: { dot: "bg-coral", action: "text-coral", row: "hover:bg-coral/5" },
};

export function PipelineAttentionStrip({
  t,
  degradedCount,
  approvalsCount,
  onReviewDegraded,
  onOpenDecisions,
}: {
  t: PipelineTabTranslator;
  degradedCount: number;
  approvalsCount: number;
  onReviewDegraded: () => void;
  onOpenDecisions: () => void;
}) {
  // Severity order, not declaration order: a degraded intake is a broken record (the
  // candidate cannot be matched at all), an awaiting decision is work that is merely
  // waiting. Both are click targets onto the exact cohort they count.
  const rows = [
    degradedCount > 0
      ? {
          id: "degraded",
          tone: "red" as const,
          Icon: AlertTriangle,
          headline: t("degradedBannerCount", { count: degradedCount }),
          body: t("degradedBannerBody", { count: degradedCount }),
          action: t("review"),
          onAct: onReviewDegraded,
        }
      : null,
    approvalsCount > 0
      ? {
          id: "approvals",
          tone: "coral" as const,
          Icon: CircleCheckBig,
          headline: t("approvalsCount", { count: approvalsCount }),
          body: t("approvalsBody"),
          action: t("openDecisions"),
          onAct: onOpenDecisions,
        }
      : null,
  ].filter((r) => r !== null);

  // Self-hiding, so the presence animation lives HERE (see PipelineMotion): the
  // parent always renders this component, so its AnimatePresence outlives the
  // strip and can fade the last queue out as it empties. Fade renders no wrapper
  // element while hidden, so the tab's space-y stack keeps no gap for it.
  return (
    <Fade show={rows.length > 0}>
      <section aria-labelledby="pipeline-attention" className={`${PANEL} overflow-hidden`}>
        <h3
          id="pipeline-attention"
          className="flex items-center gap-2 border-b border-stone-200 bg-paper px-4 py-2 text-meta uppercase tracking-wide text-steel"
        >
          <BellRing size={14} className="text-coral" aria-hidden />
          {t("attentionTitle")}
        </h3>
        <ul className="divide-y divide-stone-200">
          {rows.map(({ id, tone, Icon, headline, body, action, onAct }) => (
            <li key={id}>
              <button
                type="button"
                onClick={onAct}
                className={`focus-ring flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${TONE[tone].row}`}
              >
                <span
                  className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white ${TONE[tone].dot}`}
                  aria-hidden
                >
                  <Icon size={15} />
                </span>
                <span className="min-w-0 flex-1 text-base text-ink">
                  <span className={`font-semibold ${TONE[tone].action}`}>{headline}</span> {body}
                </span>
                <span className={`shrink-0 text-base font-semibold ${TONE[tone].action}`}>{action}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </Fade>
  );
}
