"use client";

import type { useTranslations } from "next-intl";
import { Badge, type BadgeTone } from "@/app/_components/Badge";
import { FIT_PROMISING_FLOOR } from "@/app/_lib/fit-thresholds";
import { BTN_GHOST, BTN_PRIMARY, EYEBROW, PANEL } from "@/app/_components/ui/recipes";
import type { Slate, SlateState } from "./matrixSlate";

const TONE: Record<SlateState, BadgeTone> = { clear: "positive", contested: "caution", thin: "neutral", uncovered: "critical" };
const STATE_KEY = { clear: "stateClear", contested: "stateContested", thin: "stateThin", uncovered: "stateUncovered" } as const;

// "Review in grid" only loads the picks into the selection; Add still files.
export function MatrixSlatePanel({ slate, review, close, t }: {
  slate: Slate;
  review: () => void;
  close: () => void;
  t: ReturnType<typeof useTranslations<"matrix">>;
}) {
  return (
    <section aria-labelledby="matrix-slate-h" className={`${PANEL} space-y-3 p-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="matrix-slate-h" className={EYEBROW}>{t("slate.heading")}</h3>
        <span className="text-sm font-semibold text-ink">{t("slate.filled", { filled: slate.filled, total: slate.total })}</span>
      </div>
      <p className="text-sm text-steel">{t("slate.intro")}</p>
      <ul className="divide-y divide-stone-100">
        {slate.lines.map((l) => (
          <li key={l.posId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <span className="min-w-[10rem] font-semibold text-ink">{l.title}</span>
            <span className="text-ink">{l.pick ? `${l.pick.label} · ${l.pick.score}` : "—"}</span>
            <Badge tone={TONE[l.state]} label={t(`slate.${STATE_KEY[l.state]}`)} />
            <span className="text-steel">
              {l.rival
                ? t("slate.rival", { name: l.rival.label, score: l.rival.score, role: l.rival.placedOn })
                : l.state === "thin"
                ? t("slate.thinNote")
                : l.state === "uncovered"
                ? t("slate.uncoveredNote", { floor: FIT_PROMISING_FLOOR })
                : l.separated === false
                ? t("slate.withinMargin")
                : null}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button type="button" onClick={review} disabled={slate.filled === 0} className={`${BTN_PRIMARY} h-9 px-3 text-sm`}>
          {t("slate.review")}
        </button>
        <button type="button" onClick={close} className={`${BTN_GHOST} h-9 px-3 text-sm`}>
          {t("slate.close")}
        </button>
      </div>
    </section>
  );
}
