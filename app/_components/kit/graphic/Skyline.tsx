"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Mark } from "../Mark";
import { formatCount } from "../figure";
import type { PartState, StageTone } from "../types";
import { barBox, brushBox, growDelay, inBrush, nullRun, skyGeometry, skyY, SKY, type SkyItem } from "./skylineGeometry";
import { usePlayOnce } from "./usePlayOnce";
import { useSkylineInput } from "./useSkylineInput";
import "./graphic.css";

export type SkylineItem = SkyItem & { tone?: StageTone };

/**
 * @catalog Every item as one ranked bar (null values as counted dashed stubs, never zero), a coral cap on items waiting on you, brushable into a rank range that filters linked parts.
 *
 * Items arrive pre-ranked, highest first, nulls last. The part hands back a rank RANGE; what the range
 * filters is the caller's. One focusable control: arrows, Alt, Shift, Home/End, Enter, Escape. Bars grow
 * once per `replayKey`; brushing changes opacity only.
 */
export function Skyline({
  id, label, items, brush, onBrush, onPick, picked, height = 168, state = "ready", replayKey,
  describe, brushNote, emptyText, loadingText, errorText,
}: {
  id: string;
  label: string;
  items: readonly SkylineItem[];
  brush?: readonly [number, number] | null;
  onBrush: (range: [number, number] | null) => void;
  onPick: (item: SkylineItem) => void;
  picked?: string | null;
  height?: number;
  state?: PartState;
  replayKey: string;
  /** The readout's value words for the focused item (default: its number, or "never scored"). */
  describe?: (item: SkylineItem) => string;
  brushNote?: (range: readonly [number, number]) => string;
  emptyText?: string;
  loadingText?: string;
  errorText?: string;
}) {
  const t = useTranslations("kit.graphic.skyline");
  const locale = useLocale();
  const n = (v: number) => formatCount(v, locale);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [state, items.length]);
  // Folded away (a reading pane is open): nothing to draw until the track has room again.
  const geo = width >= 120 && items.length ? skyGeometry(items.length, width, height) : null;
  const input = useSkylineInput({ items, geo, brush, onBrush, onPick });
  const svg = useRef<SVGSVGElement>(null);
  usePlayOnce(`sky:${id}`, replayKey, svg, { ready: geo != null && state === "ready", each: ".k-sky__bar, .k-sky__null", delay: growDelay });
  const focused = input.focus != null ? items[input.focus] : null;
  const say = describe ?? ((it: SkylineItem) => (it.value == null ? t("neverScored") : n(it.value)));

  if (state === "loading") return <div className="k-sky is-loading"><div className="k-section__placeholder">{loadingText ?? t("loading")}</div></div>;
  if (state === "error") {
    return (
      <div className="k-sky is-error">
        <div className="k-note k-note--critical" role="alert"><Mark kind="fail" /><span>{errorText ?? t("error")}</span></div>
      </div>
    );
  }
  if (!items.length) return <div className="k-sky"><div className="k-sky__empty">{emptyText ?? t("empty")}</div></div>;

  const cols = geo ? Array.from({ length: geo.columns }, (_, ci) => items.slice(ci * geo.per, (ci + 1) * geo.per)) : [];
  const nulls = geo ? nullRun(items, geo) : { count: 0, x: 0 };
  const shown = input.live ?? brush ?? null;
  const pickedRank = picked ? items.findIndex((q) => q.id === picked) : -1;
  return (
    <div ref={box} className="k-sky" data-part="skyline" data-role="kit-skyline">
      <svg
        ref={svg}
        className="k-sky__svg"
        tabIndex={0}
        role="application"
        aria-roledescription={t("roledesc")}
        aria-label={t("aria", { label })}
        viewBox={`0 0 ${width || 1} ${height}`}
        height={height}
        {...input.handlers}
      >
        {geo ? (
          <>
            {[0, 50, 100].map((v) => (
              <g key={v}>
                <line className="k-sky__grid" x1={SKY.left} x2={width - SKY.right} y1={skyY(geo, v)} y2={skyY(geo, v)} />
                <text className="k-sky__tick" x={SKY.left - 8} y={skyY(geo, v) + 5} textAnchor="end">{v}</text>
              </g>
            ))}
            {shown ? <rect className="k-sky__brush" y={2} height={height - SKY.bottom} rx={4} x={brushBox(geo, shown).x} width={brushBox(geo, shown).w} /> : null}
            {cols.map((c, ci) => {
              const it = c[0];
              const b = barBox(geo, ci, it.value);
              const out = inBrush(geo, ci, shown) ? "" : " is-out";
              const focusHere = input.focus != null ? Math.floor(input.focus / geo.per) === ci : pickedRank >= 0 && Math.floor(pickedRank / geo.per) === ci;
              return (
                <g key={ci} data-role={ci === 0 ? "kit-sky-bar" : undefined}>
                  {it.value == null ? (
                    <rect className={`k-sky__null${out}`} x={b.x} y={b.y} width={b.w} height={b.h} rx={2} />
                  ) : (
                    <rect className={`k-sky__bar k-tone--${it.tone ?? "default"}${out}`} x={b.x} y={b.y} width={b.w} height={b.h} rx={Math.min(3, b.w / 3)} />
                  )}
                  {c.some((q) => q.needs) ? <rect className={`k-sky__cap${out}`} x={b.x} y={b.y - 6} width={b.w} height={3} rx={1.5} /> : null}
                  {focusHere ? <rect className="k-sky__focus" x={b.x - 3} y={b.y - 9} width={b.w + 6} height={b.h + 12} rx={4} /> : null}
                </g>
              );
            })}
            {nulls.count ? <text className="k-sky__tick is-null" x={nulls.x + 4} y={height - 4}>{t("nulls", { count: nulls.count })}</text> : null}
            <text className="k-sky__tick" x={SKY.left} y={height - 4}>{t("rankOne")}</text>
            <rect className="k-sky__hit" x={SKY.left} y={0} width={Math.max(0, width - SKY.left - SKY.right)} height={height} />
          </>
        ) : null}
      </svg>
      <div className="k-sky__read" aria-live="polite">
        {brush ? (
          <span>
            <b>{t("ranks", { from: n(brush[0] + 1), to: n(brush[1] + 1) })}</b> {t("followed")}
            {brushNote ? ` · ${brushNote(brush)}` : ""}
          </span>
        ) : (
          <span>{t("hint")}</span>
        )}
        {focused && input.focus != null ? (
          <span className="k-sky__focusread">{`#${n(input.focus + 1)} · ${focused.label} · ${say(focused)}`}</span>
        ) : null}
      </div>
    </div>
  );
}
