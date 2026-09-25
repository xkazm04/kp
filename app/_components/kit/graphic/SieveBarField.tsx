"use client";

import type { CSSProperties } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatCount } from "../figure";
import { ShapeMark } from "./ShapeMark";
import type { SieveBar } from "./scaleModel";
import "./scale.css";

/**
 * One Sieve layer's field in BAR mode (the Sieve over its `barsAbove` threshold): the layer's count as
 * a bar proportional to the fullest layer, the part the linked filters keep drawn solid and the rest
 * faint, then its shapes as a legend-sized sample, each kind once with how many carry it. The count
 * itself stays on the fig track, as it does for dots.
 */
export function SieveBarField({ bar }: { bar: SieveBar }) {
  const t = useTranslations("kit.graphic.sieve");
  const locale = useLocale();
  const n = (v: number) => formatCount(v, locale);
  const tone = bar.sample[0]?.tone ?? "default";
  const kept = bar.count ? bar.kept / bar.count : 0;
  const tip = bar.kept < bar.count ? t("barKept", { kept: bar.kept, count: bar.count }) : undefined;
  return (
    <span className="k-sbar" data-role="kit-sieve-bar">
      <span className="k-sbar__track" style={{ "--p": bar.share.toFixed(4), "--kept": kept.toFixed(4) } as CSSProperties} data-tip={tip} aria-hidden="true">
        <i className={`k-sbar__fill k-tone--${tone}`} />
      </span>
      <span className="k-sbar__sample">
        {bar.sample.map((s) => (
          <span key={s.shape}>
            <ShapeMark shape={s.shape} tone={s.tone} size={14} tip={null} />
            <span className="k-nums">{n(s.n)}</span>
          </span>
        ))}
      </span>
    </span>
  );
}
