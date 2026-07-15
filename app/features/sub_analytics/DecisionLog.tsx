"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { useInfiniteScroll, type InfinitePage } from "@/app/_lib/useInfiniteScroll";
import { formatRelativeTime } from "@/app/_lib/format";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { toCsv, downloadFile } from "@/app/_lib/export-utils";
import { DECISION_META, kindLabel, waveReasonText, type CohortProvenance, type SealedReason } from "@/app/_lib/decision-attribution";
import { useDeliveryCapability } from "@/app/features/useDeliveryCapability";
import { buildUrl as buildTabUrl, clearedTabScopedParams } from "@/app/features/tabs";
import { Select } from "@/app/_components/Select";
import { CHIP_QUIET } from "@/app/_components/ui/recipes";

type Decision = {
  id: number;
  // The subject pipeline entry (ANA1 / Direction 2): present on entry-scoped
  // events, null on board-level ones (e.g. a role close). When present, the row
  // deep-links to the candidate on the board.
  entryId: string | null;
  candidateLabel: string | null;
  jobTitle: string | null;
  kind: string;
  fromStage: string | null;
  toStage: string | null;
  detail: string | null;
  createdAt: string;
  // log-tells-the-whole-story — the three sealed-record joins the route attaches per
  // page (each present only when a reliable match exists, never guessed):
  cohort?: CohortProvenance | null; // group-eval cohort provenance (advance rows)
  reason?: SealedReason | null; // sealed structured auto-reject reason (auto_rejected rows)
  counterpart?: { label: string } | null; // rematch counterpart, resolved to a live board label
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
        <Select
          value={kind}
          onChange={setKind}
          ariaLabel={t("filterKindAria")}
          size="sm"
          className="h-8"
          options={[
            { value: "", label: t("allKinds") },
            ...Object.keys(DECISION_META).map((k) => ({ value: k, label: kindLabel(t, k, { relayConfigured }) })),
          ]}
        />
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
                    {d.candidateLabel ? (
                      d.entryId ? (
                        <>
                          <span className="text-steel">{" · "}</span>
                          <Link
                            href={boardHref(d.candidateLabel)}
                            title={t("viewCandidate")}
                            className="focus-ring rounded text-steel underline-offset-2 hover:text-coral hover:underline"
                          >
                            {d.candidateLabel}
                          </Link>
                        </>
                      ) : (
                        <span className="text-steel">{` · ${d.candidateLabel}`}</span>
                      )
                    ) : null}
                    {d.fromStage && d.toStage && d.fromStage !== d.toStage ? (
                      <span className="text-steel">
                        {" "}
                        {t("stageTransition", { from: enumLabel("stage", d.fromStage), to: enumLabel("stage", d.toStage) })}
                      </span>
                    ) : null}
                    {/* Group-eval cohort provenance chip — over a chosen selection vs top-N */}
                    {d.cohort ? <span className={`ml-2 align-middle ${CHIP_QUIET}`}>{cohortText(d.cohort)}</span> : null}
                  </p>
                  <DecisionDetail d={d} reason={reasonText(d)} boardHref={boardHref} viewLabel={t("viewCandidate")} />
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

// The second line of a log row. Precedence, all honest:
//   1. a localized sealed auto-reject reason (reconsider-earns-keep parity), else
//   2. a rematch counterpart deep-link (the board's ?q=<label> idiom) when the detail
//      parsed AND the counterpart still resolves to a live board entry, else
//   3. the raw event detail (honest plain text), else nothing.
function DecisionDetail({
  d,
  reason,
  boardHref,
  viewLabel,
}: {
  d: Decision;
  reason: string | null;
  boardHref: (q: string) => string;
  viewLabel: string;
}) {
  const t = useTranslations("analytics.log");
  if (reason) return <p className="truncate text-sm text-steel">{reason}</p>;
  if (d.counterpart) {
    const label = d.counterpart.label;
    return (
      <p className="truncate text-sm text-steel">
        {t.rich(d.kind === "rematched_from" ? "rematchFrom" : "rematchTo", {
          link: () => (
            <Link
              href={boardHref(label)}
              title={viewLabel}
              className="focus-ring rounded underline-offset-2 hover:text-coral hover:underline"
            >
              {label}
            </Link>
          ),
        })}
      </p>
    );
  }
  return d.detail ? <p className="truncate text-sm text-steel">{d.detail}</p> : null;
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
