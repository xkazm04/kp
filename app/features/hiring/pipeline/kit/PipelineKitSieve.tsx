"use client";

import { useLocale, useTranslations } from "next-intl";
import { Button, Mark, Section, formatCount, type PartState } from "@/app/_components/kit";
import { SIEVE_BARS_ABOVE, ShapeMark, Sieve, type SieveLayer } from "@/app/_components/kit/graphic";
import { stageHasRole } from "@/app/_lib/pipeline-stages";
import type { PipelineTabState } from "../usePipelineTabState";
import type { PipelineKit } from "./usePipelineKit";
import { OUT } from "./pipelineKitModel";

/** "Where everyone is": every candidate a dot, poured through the workspace's stages and out of the funnel;
 *  above SIEVE_BARS_ABOVE candidates (every role at once, at scale) each stage is a bar instead. */
export function PipelineKitSieve({ s, k, status }: { s: PipelineTabState; k: PipelineKit; status: PartState }) {
  const t = useTranslations("pipeline.kit");
  // The board error is resolved to the tab's own localized line, never the server's message.
  const tt = useTranslations("pipeline.tab");
  const locale = useLocale();
  const n = (v: number) => formatCount(v, locale);
  const stages = k.layers.filter((l) => !l.exit);
  // The one placement worth naming: how many at the offer stage were placed there without a recorded move.
  const offer = stages.find((l) => stageHasRole(l.id, "offer", s.axis));

  const layers: SieveLayer[] = k.layers.map((l) =>
    l.exit
      ? { id: OUT, label: t("outLabel"), exit: true, mark: <Mark kind="fail" tip={t("outTip")} />, sub: <span>{t("outSub")}</span>, tip: t("outSub"), empty: t("outEmpty") }
      : {
          id: l.id,
          label: l.label,
          mark: <ShapeMark shape="solid" tone={l.tone} tip={l.label} />,
          sub: l.waiting ? <span className="k-needs-t">{t("layerWaiting", { count: l.waiting })}</span> : <span>{t("layerProv", { walked: l.walked, placed: l.placed })}</span>,
          time: l.medianAge == null ? <span className="k-absent">—</span> : t("layerMedian", { days: l.medianAge }),
          timeTip: t("layerMedianTip", { stage: l.label }),
          tip: [l.waiting ? t("layerWaiting", { count: l.waiting }) : t("layerProv", { walked: l.walked, placed: l.placed }), l.medianAge == null ? null : t("layerMedian", { days: l.medianAge })]
            .filter(Boolean)
            .join(" · "),
          empty: t("layerEmpty", { stage: l.label }),
        }
  );

  const legend = (
    <div className="k-g-legend">
      <span><ShapeMark shape="solid" tone="screened" tip={null} />{t("legendWalked")}</span>
      <span><ShapeMark shape="ring" tone="screened" tip={null} />{t("legendPlaced")}</span>
      <span><ShapeMark shape="dashed" tip={null} />{t("legendNone")}</span>
      <span>
        <svg width="16" height="16" viewBox="-8 -8 16 16" aria-hidden="true"><circle className="k-dot__halo" r="6.4" /><circle r="3.6" fill="currentColor" /></svg>
        {t("legendWaiting")}
      </span>
      <span><ShapeMark shape="exit" tip={null} />{t("legendRejected")}</span>
    </div>
  );

  return (
    <Section
      title={t("sieveTitle")}
      count={t("sieveCount", { count: k.scoped.length, stages: stages.length })}
      state={offer && offer.placed ? t("sieveState", { placed: n(offer.placed), total: n(offer.count), stage: offer.label }) : undefined}
      actions={<Button label={t("pourAgain")} tip={t("pourAgainTip")} variant="ghost" size="sm" onClick={k.pourAgain} />}
    >
      <Sieve
        id="pipeline-sieve"
        layers={layers}
        items={k.dots}
        barsAbove={SIEVE_BARS_ABOVE}
        selected={k.layer}
        dim={k.dim}
        selectedItem={k.open?.id ?? null}
        onLayer={k.toggleLayer}
        replayKey={k.sieveKey}
        state={status}
        legend={legend}
        pouredLabel={k.dots.length > SIEVE_BARS_ABOVE ? t("pouredBars") : t("poured")}
        errorText={tt("loadFailed")}
        onRetry={() => void s.load()}
      />
    </Section>
  );
}
