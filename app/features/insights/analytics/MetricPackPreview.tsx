"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { Modal } from "@/app/_components/Modal";
import { Badge, type BadgeTone } from "@/app/_components/Badge";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { BTN_GHOST, BTN_SECONDARY, META_LABEL, NOTICE, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { MetricPack, MetricStatus } from "@/app/_lib/metric-pack";
import { apiErrorPayload } from "./analyticsFetchError";
import { metricPackPreview, type PreviewRow } from "./metricPackPreviewModel";

// The metric pack, previewed in place (it used to be reachable only as a blind
// Markdown download). The route's JSON is the same pack the Markdown renders, and
// each blocking row's `need.note` is the very sentence the file's caveat carries,
// so the screen and the attachment cannot disagree. The ordering and the clearing
// date are metricPackPreviewModel.ts (pure, tested); this file is the wiring.

const STATUS_TONE: Record<MetricStatus, BadgeTone> = { measured: "positive", thin: "caution", not_measurable: "neutral" };

// Keyed by the query it answers: a window switch (the "use all time" remedy) leaves
// the old pack in state until the new one lands, and it must not read as the new one.
type Load = { query: string; pack: MetricPack | null; error: string | null };

export function MetricPackPreview({
  days,
  workspaceScoped,
  onClose,
  onUseAllTime,
}: {
  days: number | null;
  /** A role is in scope on the page; the pack is still the whole workspace's. */
  workspaceScoped: boolean;
  onClose: () => void;
  /** Widen to all time (the remedy a window-too-narrow row names). */
  onUseAllTime: () => void;
}) {
  const t = useTranslations("analytics");
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const query = days ? `?days=${days}` : "";
  const [loaded, setLoad] = useState<Load | null>(null);
  const load = loaded?.query === query ? loaded : { query, pack: null, error: null };

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/analytics/metric-pack${query}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) {
          const payload = await apiErrorPayload(res);
          setLoad({ query, pack: null, error: errorMessage(payload, t("metricPack.preview.loadFailed")) });
          return;
        }
        setLoad({ query, pack: (await res.json()) as MetricPack, error: null });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setLoad({ query, pack: null, error: t("metricPack.preview.loadFailed") });
      });
    return () => ctrl.abort();
  }, [query, errorMessage, t]);

  const fmt = useDateFormat();
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const view = load.pack ? metricPackPreview(load.pack) : null;
  const windowLabel = days ? t("metricPack.windowLast", { days }) : t("metricPack.windowAll");
  const label = (key: string) => {
    const k = `metricPack.metric.${key}` as Parameters<typeof t>[0];
    return t.has(k) ? t(k) : key.replace(/_/g, " ");
  };
  const unit = (u: string) => {
    const k = `metricPack.unit.${u}` as Parameters<typeof t>[0];
    return t.has(k) ? t(k) : u;
  };
  const row = (r: PreviewRow) => (
    <li key={r.key} className={`${PANEL_SUNKEN} p-3`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold text-ink">{label(r.key)}</span>
        <span className="flex items-center gap-2">
          <span className="nums text-ink">{r.value == null ? "—" : `${num.format(r.value)} ${unit(r.unit)}`}</span>
          <Badge tone={STATUS_TONE[r.status]} label={t(`metricPack.status.${r.status}`)} />
        </span>
      </div>
      <p className="mt-1 text-meta text-steel">{r.basis}</p>
      {r.need ? <p className="mt-1 text-sm text-ink">{r.need.note}</p> : null}
    </li>
  );
  const blockers = view?.rows.filter((r) => r.blocker) ?? [];
  const measured = view?.rows.filter((r) => !r.blocker) ?? [];

  return (
    <Modal
      title={t("metricPack.preview.title")}
      subtitle={windowLabel}
      onClose={onClose}
      size="xl"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <a href={`/api/analytics/metric-pack?format=md${days ? `&days=${days}` : ""}`} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
            <Download size={14} aria-hidden />
            {workspaceScoped ? t("metricPackDownloadWorkspace") : t("metricPackDownload")}
          </a>
        </div>
      }
    >
      {load.error ? (
        <p role="alert" className={`${NOTICE("critical")} px-3 py-2 text-sm`}>
          {load.error}
        </p>
      ) : !view ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">{t("metricPack.preview.loading")}</span>
          <LoadingGap className="min-h-[12rem]" />
        </div>
      ) : (
        <div className="space-y-4">
          <div role="status" className="space-y-1">
            <p className="font-semibold text-ink">
              {t("metricPack.preview.summary", view.summary)}
              {" · "}
              {view.certifiable ? t("metricPack.preview.ready") : t("metricPack.preview.notReady")}
            </p>
            {!view.certifiable ? (
              <p className="text-sm text-steel">
                {view.earliestClear != null
                  ? // UTC, the same clock the need notes are dated on (metric-pack.ts).
                    t("metricPack.preview.clearsAround", { date: fmt.date(view.earliestClear, { timeZone: "UTC" }) })
                  : t("metricPack.preview.noClearDate")}
              </p>
            ) : null}
          </div>
          {view.windowTooNarrow && days ? (
            <div className={`${NOTICE("amber")} flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm`}>
              <span>{t("metricPack.preview.windowHint")}</span>
              <button type="button" onClick={onUseAllTime} className={`${BTN_GHOST} px-2 py-1 text-sm`}>
                {t("metricPack.preview.useAllTime")}
              </button>
            </div>
          ) : null}
          {blockers.length > 0 ? (
            <section>
              <h3 className={META_LABEL}>{t("metricPack.preview.blockersHeading")}</h3>
              <ul className="mt-2 space-y-2">{blockers.map(row)}</ul>
            </section>
          ) : null}
          {measured.length > 0 ? (
            <section>
              <h3 className={META_LABEL}>{t("metricPack.preview.measuredHeading")}</h3>
              <ul className="mt-2 space-y-2">{measured.map(row)}</ul>
            </section>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
