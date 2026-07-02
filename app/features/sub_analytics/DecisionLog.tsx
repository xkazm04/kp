"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { useInfiniteScroll, type InfinitePage } from "@/app/_lib/useInfiniteScroll";
import { formatRelativeTime } from "@/app/_lib/format";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { toCsv, downloadFile } from "@/app/_lib/export-utils";
import { DECISION_META, kindLabel } from "@/app/_lib/decision-attribution";
import { useDeliveryCapability } from "@/app/features/useDeliveryCapability";

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

// The auto/human decode + tone per event kind now lives in the shared
// decision-attribution module (ANA3) — the analytics automation rollup folds the
// SAME map server-side, so the per-row badge and the aggregate can never drift.
// The readable label still comes from the `analytics.log.kinds.<kind>` catalog,
// resolved at the render site.

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
// chunks. ANA5: the outer component owns the attribution/kind filters — the
// infinite-scroll engine accumulates per mount, so the inner list is KEYED on
// the filter combo and pagination restarts from offset 0 on every change.
export function DecisionLog() {
  const t = useTranslations("analytics.log");
  const [attribution, setAttribution] = useState<"auto" | "human" | null>(null);
  const [kind, setKind] = useState("");
  return (
    <DecisionLogList
      key={`${attribution ?? ""}|${kind}`}
      attribution={attribution}
      kind={kind}
      setAttribution={setAttribution}
      setKind={setKind}
    />
  );
}

function DecisionLogList({
  attribution,
  kind,
  setAttribution,
  setKind,
}: {
  attribution: "auto" | "human" | null;
  kind: string;
  setAttribution: (a: "auto" | "human" | null) => void;
  setKind: (k: string) => void;
}) {
  const t = useTranslations("analytics.log");
  const enumLabel = useEnumLabel();
  const reduced = useReducedMotion();
  // REC-10 — with no delivery relay, every "…sent" event is really a terminal
  // local-outbox row; the labels (rows, filter, CSV) must say so.
  const relayConfigured = useDeliveryCapability();
  const buildUrl = useCallback(
    (offset: number, limit: number) => {
      const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
      if (kind) params.set("kind", kind);
      else if (attribution) params.set("attribution", attribution);
      return `/api/analytics/decisions?${params.toString()}`;
    },
    [kind, attribution]
  );
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

  // ANA5 — export the rows the recruiter has isolated (the loaded, filtered
  // set), via the shared toolkit. Localized labels — the file mirrors the log.
  const exportCsv = () => {
    const rows: (string | number | null)[][] = [
      [t("csvTime"), t("csvAttribution"), t("csvKind"), t("csvCandidate"), t("csvRole"), t("csvDetail")],
      ...items.map((d) => [
        d.createdAt,
        t(`attribution.${decisionMeta(d.kind).attribution}` as Parameters<typeof t>[0]),
        kindLabel(t, d.kind, { relayConfigured }),
        d.candidateLabel,
        d.jobTitle,
        d.detail,
      ]),
    ];
    downloadFile("kp-decision-log.csv", toCsv(rows), "text/csv");
  };

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

      {/* ANA5: isolate the rows you're answering for — attribution chips, a kind
          select, and a CSV of exactly what's isolated. print:hidden so the
          existing print pattern captures the log, not its chrome. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 print:hidden">
        {(["auto", "human"] as const).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAttribution(attribution === a ? null : a)}
            aria-pressed={attribution === a}
            disabled={Boolean(kind)}
            className={`focus-ring rounded-full border px-3 py-1 text-sm font-semibold transition-colors disabled:opacity-50 ${
              attribution === a ? "border-coral bg-coral/10 text-coral" : "border-stone-200 text-steel hover:border-coral/40"
            }`}
          >
            {t(`attribution.${a}`)}
          </button>
        ))}
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          aria-label={t("filterKindAria")}
          className="focus-ring h-8 rounded-md border border-stone-200 bg-white px-2 text-sm text-ink"
        >
          <option value="">{t("allKinds")}</option>
          {Object.keys(DECISION_META).map((k) => (
            <option key={k} value={k}>
              {kindLabel(t, k, { relayConfigured })}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={exportCsv}
          disabled={items.length === 0}
          className="focus-ring ml-auto inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-2.5 py-1 text-sm font-medium text-steel hover:bg-paper hover:text-ink disabled:opacity-50"
        >
          <Download size={12} aria-hidden /> {t("exportCsv")}
        </button>
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
            const label = kindLabel(t, d.kind, { relayConfigured });
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
