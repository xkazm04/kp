"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { useInfiniteScroll, type InfinitePage } from "@/app/_lib/useInfiniteScroll";
import { formatRelativeTime } from "@/app/_lib/format";
import { useEnumLabel } from "@/app/_lib/use-enum-label";

type Decision = {
  id: number;
  candidateLabel: string | null;
  jobTitle: string | null;
  kind: string;
  fromStage: string | null;
  toStage: string | null;
  detail: string | null;
  createdAt: string;
};

type DecisionPage = {
  decisions: Decision[];
  total: number;
  hasMore: boolean;
  nextOffset: number;
  error?: string;
};

const PAGE_SIZE = 20;

// Decode raw event kinds into whether the system decided it (auto) or a human did,
// plus a tone. The readable label comes from the `analytics.log.kinds.<kind>`
// catalog, resolved at the render site (this map is module-level, no hook).
const DECISION_META: Record<string, { auto: boolean; tone: string }> = {
  advanced: { auto: true, tone: "text-moss" },
  screening_hold: { auto: true, tone: "text-ink" },
  interview_scorecard: { auto: true, tone: "text-steel" },
  interview_prep_generated: { auto: true, tone: "text-steel" },
  offer_drafted: { auto: true, tone: "text-steel" },
  rematched: { auto: true, tone: "text-steel" },
  rematched_from: { auto: true, tone: "text-steel" },
  outreach_sent: { auto: true, tone: "text-steel" },
  rejection_sent: { auto: true, tone: "text-coral" },
  rejected: { auto: false, tone: "text-coral" },
  applied: { auto: false, tone: "text-steel" },
  re_applied: { auto: false, tone: "text-amber-600" },
  scheduled: { auto: false, tone: "text-steel" },
  interview_scheduled: { auto: false, tone: "text-moss" },
  offer_sent: { auto: false, tone: "text-steel" },
  offer_accepted: { auto: false, tone: "text-moss" },
  offer_declined: { auto: false, tone: "text-coral" },
  onboarding_started: { auto: false, tone: "text-moss" },
};

// Attribution is three-state on purpose. In an auditable log, defaulting an
// unrecognized kind to AUTO would misattribute accountability to the machine —
// the most damaging default. An unmapped kind renders a neutral UNKNOWN badge
// and warns in dev, so adding a backend event kind forces a conscious entry in
// DECISION_META above (the kinds here must track recordAutomationEvent callers).
// `known` gates whether a catalog label exists; unknown falls back to the raw kind.
function decisionMeta(kind: string): { known: boolean; attribution: "auto" | "human" | "unknown"; tone: string } {
  const meta = DECISION_META[kind];
  if (meta) return { known: true, attribution: meta.auto ? "auto" : "human", tone: meta.tone };
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[analytics] unmapped decision kind "${kind}" — add it to DECISION_META (rendering as UNKNOWN, not AUTO).`);
  }
  return { known: false, attribution: "unknown", tone: "text-steel" };
}

const ATTRIBUTION_BADGE = {
  auto: "bg-moss/10 text-moss",
  human: "bg-coral/10 text-coral",
  unknown: "bg-stone-100 text-steel",
} as const;

// Audit rows show "—" for a blank/malformed timestamp; otherwise the shared
// relative-time renderer (formatRelativeTime, which returns "" on invalid).
function timeAgo(iso: string): string {
  return formatRelativeTime(iso) || "—";
}

// Auditable decision log that pages the full automation/human trail in 20-row
// chunks. A sentinel below the list auto-loads the next page as it scrolls into
// view (with a manual "Load more" fallback for keyboard/no-observer paths), and
// each freshly loaded page cascades in unless the user prefers reduced motion.
export function DecisionLog() {
  const t = useTranslations("analytics.log");
  const enumLabel = useEnumLabel();
  const reduced = useReducedMotion();
  const buildUrl = useCallback((offset: number, limit: number) => `/api/analytics/decisions?offset=${offset}&limit=${limit}`, []);
  const selectPage = useCallback((body: unknown): InfinitePage<Decision> => {
    const b = body as DecisionPage;
    return { items: b.decisions, total: b.total, hasMore: b.hasMore, nextOffset: b.nextOffset };
  }, []);
  const { items, total, hasMore, phase, showInitialSkeleton, error, sentinelRef, loadMore } = useInfiniteScroll<Decision>({
    pageSize: PAGE_SIZE,
    buildUrl,
    selectPage,
    errorLabel: t("loadFailed"),
  });

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-serif text-h2 text-ink">{t("title")}</h3>
        {total != null && items.length > 0 ? (
          <p className="text-meta uppercase text-steel">
            {t("countAuditable", { shown: items.length, total })}
          </p>
        ) : (
          <p className="text-meta uppercase text-steel">{t("subtitle")}</p>
        )}
      </div>

      {showInitialSkeleton ? (
        <ul className="mt-3 divide-y divide-stone-100" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </ul>
      ) : phase === "idle" && items.length === 0 ? (
        <p className="mt-3 text-base text-steel">{t("empty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-stone-100" aria-busy={phase === "more"}>
          {items.map((d, i) => {
            const m = decisionMeta(d.kind);
            const badgeCls = ATTRIBUTION_BADGE[m.attribution];
            const label = m.known ? t(`kinds.${d.kind}` as Parameters<typeof t>[0]) : d.kind.replace(/_/g, " ");
            // Cascade rows within each freshly loaded page; CSS animations only
            // fire when a node mounts, so already-present rows never re-animate.
            const animate = !reduced;
            return (
              <li
                key={d.id}
                className={`flex items-center gap-3 py-2 ${animate ? "animate-fade-in" : ""}`}
                style={animate ? { animationDelay: `${(i % PAGE_SIZE) * 18}ms` } : undefined}
              >
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-meta font-semibold ${badgeCls}`}>
                  {t(`attribution.${m.attribution}` as Parameters<typeof t>[0])}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base text-ink">
                    <span className={`font-medium ${m.tone}`}>{label}</span>
                    {d.candidateLabel ? <span className="text-steel">{` · ${d.candidateLabel}`}</span> : null}
                    {d.fromStage && d.toStage && d.fromStage !== d.toStage ? (
                      <span className="text-steel">
                        {" "}
                        {t("stageTransition", { from: enumLabel("stage", d.fromStage), to: enumLabel("stage", d.toStage) })}
                      </span>
                    ) : null}
                  </p>
                  {d.detail ? <p className="truncate text-sm text-steel">{d.detail}</p> : null}
                </div>
                <span className="shrink-0 text-sm text-steel">{timeAgo(d.createdAt)}</span>
              </li>
            );
          })}
          {phase === "more"
            ? Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={`s${i}`} />)
            : null}
        </ul>
      )}

      {phase === "error" ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-coral/40 bg-coral/5 px-3 py-2">
          <p className="text-base text-coral">{error ?? t("loadFailed")}</p>
          <button
            type="button"
            onClick={() => void loadMore()}
            className="focus-ring shrink-0 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper"
          >
            {t("retry")}
          </button>
        </div>
      ) : null}

      {/* Sentinel + manual fallback. The observer drives auto-loading; the button
          covers keyboard users and environments without IntersectionObserver. */}
      {hasMore && phase !== "error" ? (
        <div ref={sentinelRef} className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={phase === "more"}
            className="focus-ring rounded-md border border-stone-300 bg-white px-4 py-1.5 text-sm font-medium text-steel transition-colors hover:bg-paper disabled:opacity-60"
          >
            {phase === "more" ? t("loading") : t("loadMore")}
          </button>
        </div>
      ) : !hasMore && items.length > 0 && phase === "idle" ? (
        <p className="mt-3 text-center text-sm text-steel">{t("endOfLog", { count: items.length })}</p>
      ) : null}
    </div>
  );
}

function SkeletonRow() {
  return (
    <li className="flex items-center gap-3 py-2" aria-hidden>
      <span className="h-5 w-14 shrink-0 animate-pulse rounded-full bg-stone-100" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <span className="block h-3.5 w-2/3 animate-pulse rounded bg-stone-100" />
        <span className="block h-3 w-1/3 animate-pulse rounded bg-stone-100" />
      </div>
      <span className="h-3 w-12 shrink-0 animate-pulse rounded bg-stone-100" />
    </li>
  );
}
