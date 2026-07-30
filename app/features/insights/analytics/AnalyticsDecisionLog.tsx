"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { useInfiniteScroll, type InfinitePage } from "@/app/_lib/useInfiniteScroll";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { toCsv, downloadFile } from "@/app/_lib/export-utils";
import { DECISION_META, kindLabel, waveReasonText, type CohortProvenance } from "@/app/_lib/decision-attribution";
import { useDeliveryCapability } from "@/app/features/shell/useDeliveryCapability";
import { buildUrl as buildTabUrl, clearedTabScopedParams } from "@/app/features/shell/tabs";
import { PAGE_SIZE, decisionMeta, type Decision, type DecisionPage } from "./analyticsDecisionLogTypes";
import { DecisionLogRow } from "./AnalyticsDecisionLogRow";
import { AnalyticsDecisionLogToolbar } from "./AnalyticsDecisionLogToolbar";
import { AnalyticsDecisionLogFooter } from "./AnalyticsDecisionLogFooter";

// Auditable decision log that pages the full automation/human trail in 20-row
// chunks. ANA5: the outer component owns the attribution/kind filters — the
// infinite-scroll engine accumulates per mount, so the inner list is KEYED on
// the filter combo and pagination restarts from offset 0 on every change.
//
// Direction 3 — the kind filter is deep-linkable: it hydrates from ?kind= at
// mount and writes back on every change (the board's PIPE3 two-way URL-sync
// idiom), so a filtered log is reload- and share-stable and a cross-tab CTA (the
// Decisions comms-failure banner) can land here pre-filtered. Only the kind
// filter syncs — a specific kind wins over the broader attribution bucket anyway,
// and attribution stays local/ephemeral.
export function DecisionLog() {
  const search = useSearchParams();
  const router = useRouter();
  const [attribution, setAttribution] = useState<"auto" | "human" | null>(null);
  // Hydrate ONCE from the URL (lazy initializer off the render-time params, like
  // PipelineTab); an unknown kind falls back to unfiltered rather than a dead view.
  const [kind, setKindState] = useState(() => {
    const k = search.get("kind");
    return k && k in DECISION_META ? k : "";
  });
  const setKind = useCallback(
    (k: string) => {
      setKindState(k);
      // Write back to the same ?kind= param the mount reads. buildTabUrl preserves
      // tab + every other param and clears the key when the filter is emptied.
      router.replace(buildTabUrl({ kind: k || null }, search.toString()), { scroll: false });
    },
    [router, search]
  );
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
  // Sealed auto-reject reasons localize through the SAME decisions.wave.reasons.*
  // catalog the reconsider queue + records panel use (via the shared waveReasonText),
  // so a Czech recruiter reads a Czech reason and the three surfaces can never drift.
  const tWave = useTranslations("decisions.wave");
  const enumLabel = useEnumLabel();
  const reduced = useReducedMotion();
  const search = useSearchParams();

  // Compact, localized cohort-provenance chip text for a group-eval advance row: a lead
  // crowned over a recruiter-picked selection reads differently from one over top-N.
  const cohortText = (c: CohortProvenance): string =>
    t(c.source === "selection" ? "cohortSelection" : "cohortTop", { compared: c.compared, field: c.field });
  // The localized sealed auto-reject reason for a row, or null (unmapped / no seal).
  const reasonText = (d: Decision): string | null => (d.reason ? waveReasonText(tWave, d.reason) : null);
  // Direction 2 — reuse the board deep-link idiom (buildUrl + cleared tab-scoped
  // params, ?q=<label>) the funnel/by-role links use, so a log row opens the
  // board filtered to that candidate. Only entry-scoped rows carry a subject.
  const boardHref = (q: string) => buildTabUrl({ ...clearedTabScopedParams(), tab: "pipeline", q }, search.toString());
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
      [t("csvTime"), t("csvAttribution"), t("csvKind"), t("csvCandidate"), t("csvRole"), t("csvCohort"), t("csvDetail")],
      ...items.map((d) => [
        d.createdAt,
        t(`attribution.${decisionMeta(d.kind).attribution}` as Parameters<typeof t>[0]),
        kindLabel(t, d.kind, { relayConfigured }),
        d.candidateLabel,
        d.jobTitle,
        // The new Cohort column mirrors the on-screen chip; empty when the row carries none.
        d.cohort ? cohortText(d.cohort) : null,
        // Detail mirrors the row: the localized sealed reason (auto-reject), the resolved
        // rematch counterpart, else the raw event detail — so the file says what the log says.
        reasonText(d) ?? (d.counterpart ? t("csvRematchCounterpart", { name: d.counterpart.label }) : d.detail),
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

      <AnalyticsDecisionLogToolbar
        attribution={attribution}
        kind={kind}
        setAttribution={setAttribution}
        setKind={setKind}
        exportCsv={exportCsv}
        exportDisabled={items.length === 0}
        relayConfigured={relayConfigured}
      />

      {/* Loading choreography (docs/design/loading-choreography.md, tier 2): the initial
          page load holds a quiet reserved box instead of pulsing skeleton rows —
          useInfiniteScroll's own 300ms grace already keeps a fast/empty response
          from ever painting this at all. */}
      {showInitialSkeleton ? (
        <div className="reveal-quiet mt-3 min-h-[15rem]" aria-hidden />
      ) : phase === "idle" && items.length === 0 ? (
        <p className="mt-3 text-base text-steel">{t("empty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-stone-100" aria-busy={phase === "more"}>
          {items.map((d, i) => (
            <DecisionLogRow
              key={d.id}
              d={d}
              i={i}
              animate={!reduced}
              label={kindLabel(t, d.kind, { relayConfigured })}
              boardHref={boardHref}
              cohortText={cohortText}
              reasonText={reasonText}
              enumLabel={enumLabel}
            />
          ))}
          {phase === "more" ? (
            // Paging in more rows: a quiet reserved gap, not more skeleton rows.
            <li className="reveal-quiet h-16" aria-hidden />
          ) : null}
        </ul>
      )}

      <AnalyticsDecisionLogFooter
        phase={phase}
        error={error}
        hasMore={hasMore}
        itemsCount={items.length}
        sentinelRef={sentinelRef}
        loadMore={loadMore}
      />
    </div>
  );
}
