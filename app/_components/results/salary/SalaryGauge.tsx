"use client";

import { motion } from "framer-motion";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { clampPercent, formatGrouped, formatMoney } from "@/app/_lib/format";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { confidenceOpacity, growthMarkerPercent } from "./salaryGauge.logic";

interface SalaryGaugeProps {
  minimum: number;
  maximum: number;
  midpoint: number;
  confidence: string;
  // The +30% growth target, rounded once by the caller. Passed in so the dashed marker and
  // the aria-label use the SAME figure the card text shows, instead of a third unrounded one.
  target?: number;
  // Currency code for the aria-label + hover tooltip (the bar + tick labels are
  // number-only). The analysis is no longer CZK-only, so this is REQUIRED — a default
  // would silently mislabel a EUR/USD salary as CZK to screen-reader users.
  currency: string;
}

export function SalaryGauge({ minimum, maximum, midpoint, confidence, target: targetProp, currency }: SalaryGaugeProps) {
  const t = useTranslations("report");
  const target = targetProp ?? midpoint * 1.3;
  // bug-ui-scan-2026-07-09 (analysis-result-panels #4): derive the growth caption
  // from the ACTUAL (rounded) target instead of a fixed "+30%", so the label agrees
  // with the marker's position. null when undefined → fall back to a plain "Target".
  const growthPct = growthMarkerPercent(midpoint, target);
  const growthLabel = growthPct != null ? t("salary.growthPct", { pct: growthPct }) : t("salary.target");
  const gaugeMin = minimum * 0.9;
  const gaugeMax = Math.max(maximum, target) * 1.08;
  const range = gaugeMax - gaugeMin;
  // A zero/flat/inverted model estimate makes range <= 0, which would turn
  // every percent into NaN (and clamping can't rescue NaN). Center the markers
  // so the bar degrades gracefully instead of collapsing with React warnings.
  const degenerate = !(range > 0);

  const pct = (value: number) => (degenerate ? 50 : clampPercent(((value - gaugeMin) / range) * 100));
  const minPct = pct(minimum);
  const maxPct = pct(maximum);
  const midPct = pct(midpoint);
  const targetPct = pct(target);

  // bug-ui-scan / Direction 1 (#e): an unrecognized confidence must NOT fall through
  // to full opacity (the rendering of "high") — it maps to the lowest emphasis and
  // is flagged so the bar carries an explicit "unknown" title instead of looking sure.
  const emphasis = confidenceOpacity(confidence);
  const fillOpacity = emphasis.opacity;

  const reducedMotion = useReducedMotion();
  const barRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; value: number } | null>(null);

  // The value the readout reflects right now: the scrubbed point, or the midpoint
  // as the resting position (what a freshly-focused keyboard user lands on). Also
  // feeds the slider's aria-valuenow/valuetext so AT hears the same figure the
  // floating readout shows to sighted users.
  const readoutValue = hover?.value ?? midpoint;

  // Place the readout at a money value: mirror the mouse path by parking the
  // floating chip at that value's x and storing the value for the label + aria.
  const scrubTo = (value: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    const clamped = Math.max(gaugeMin, Math.min(gaugeMax, value));
    const ratio = range === 0 ? 0 : (clamped - gaugeMin) / range;
    setHover({ x: ratio * (rect?.width ?? 0), value: clamped });
  };

  const handleMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (degenerate) return;
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const ratio = rect.width === 0 ? 0 : x / rect.width;
    setHover({ x, value: gaugeMin + ratio * range });
  };

  // Keyboard parity for the mouse readout: arrows scrub in ~2% steps (10% with
  // Shift), Home/End jump to the ends, Escape clears. Same value+position the
  // mouse produces, so keyboard and touch users get the per-point figure the
  // aria summary alone never carried.
  const handleKeyScrub = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (degenerate) return;
    const step = event.shiftKey ? range / 10 : range / 50;
    let value = readoutValue;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        value += step;
        break;
      case "ArrowLeft":
      case "ArrowDown":
        value -= step;
        break;
      case "Home":
        value = gaugeMin;
        break;
      case "End":
        value = gaugeMax;
        break;
      case "Escape":
        setHover(null);
        return;
      default:
        return;
    }
    event.preventDefault();
    scrubTo(value);
  };

  return (
    <div className="relative pt-7 pb-6">
      {hover ? (
        <div
          className="pointer-events-none absolute -translate-x-1/2 rounded-md bg-ink px-2 py-1 text-sm font-medium text-paper shadow nums"
          style={{ left: hover.x, top: 0 }}
        >
          {formatMoney(hover.value, currency)}
        </div>
      ) : null}

      <div
        ref={barRef}
        // Interactive when scrubbable → a slider (focusable, arrow-scrubbable) so
        // keyboard/touch users reach the per-point value; degenerate → a static
        // image. Either way the aria-label keeps the full min/max/mid/target
        // summary (the slider's name), so the summary is never degraded — the
        // slider only ADDS aria-valuenow/valuetext for the scrubbed figure.
        role={degenerate ? "img" : "slider"}
        tabIndex={degenerate ? undefined : 0}
        aria-label={t("salary.gaugeAria", {
          min: formatGrouped(minimum),
          max: formatGrouped(maximum),
          currency,
          midpoint: formatGrouped(midpoint),
          growth: growthLabel,
          target: formatGrouped(target),
        })}
        aria-valuemin={degenerate ? undefined : Math.round(gaugeMin)}
        aria-valuemax={degenerate ? undefined : Math.round(gaugeMax)}
        aria-valuenow={degenerate ? undefined : Math.round(readoutValue)}
        aria-valuetext={degenerate ? undefined : formatMoney(readoutValue, currency)}
        title={emphasis.known ? undefined : t("salary.confidenceUnknownTitle")}
        className={`relative h-3 w-full rounded-full bg-stone-200 ${degenerate ? "cursor-default" : "cursor-crosshair"}`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
        onKeyDown={handleKeyScrub}
        onFocus={() => {
          if (!degenerate && !hover) scrubTo(midpoint);
        }}
        onBlur={() => setHover(null)}
      >
        <motion.div
          className="absolute top-0 h-full rounded-full"
          style={{
            left: `${minPct}%`,
            background: "linear-gradient(to right, var(--color-coral), var(--color-moss))",
            opacity: fillOpacity
          }}
          initial={reducedMotion ? false : { width: 0 }}
          animate={{ width: `${maxPct - minPct}%` }}
          transition={reducedMotion ? { duration: 0 } : { duration: 0.9, ease: "easeOut" }}
        />

        <div
          className="absolute top-1/2 h-5 w-0.5 -translate-y-1/2 bg-ink"
          style={{ left: `calc(${midPct}% - 1px)` }}
          aria-hidden
        />

        <div
          className="absolute top-1/2 h-6 -translate-y-1/2 border-l-2 border-dashed border-coral"
          style={{ left: `${targetPct}%` }}
          aria-hidden
        />
      </div>

      <div className="relative mt-1 h-4 text-sm font-medium uppercase tracking-wide">
        <span
          className="absolute -translate-x-1/2 text-ink"
          style={{ left: `${midPct}%` }}
        >
          {t("salary.mid")}
        </span>
        <span
          className="absolute -translate-x-1/2 text-coral"
          style={{ left: `${targetPct}%` }}
        >
          {growthLabel}
        </span>
      </div>
    </div>
  );
}
