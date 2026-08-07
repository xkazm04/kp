"use client";

/*
 * CzMap — the interactive inline-SVG choropleth of the 14 Czech kraje, the page
 * centrepiece. Geometry comes from data/cz-regions.json (real NUTS3 outlines,
 * projected to an SVG viewBox); each region is filled by a heat ramp over the
 * chosen metric (open-vacancy volume or median salary). Hover/focus/click a
 * region to activate it.
 *
 * Hover stability: the base paint order is computed once (largest region first,
 * so small ones like Praha stay clickable) and does NOT depend on the active
 * region — so hovering never reorders the DOM or re-runs the mount animation.
 * The active region is highlighted by a lightweight outline OVERLAY drawn on
 * top, so a hover only touches that one element, not the whole map.
 */
import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { geo, heatColor, salaryColor, regionScale, type MapMetric, type Region } from "./data";
import { regionAriaLabel } from "./regionLabel";
import { INK, CORAL } from "../tokens";

interface CzMapProps {
  regions: Region[];
  metric: MapMetric;
  activeCode: string | null;
  onActivate: (code: string | null) => void;
  className?: string;
}

// Stable, active-independent paint order (largest first). Module-level so it is
// computed once and never changes identity across renders.
const ENTRIES = Object.entries(geo.regions).sort((a, b) => b[1].d.length - a[1].d.length);

export default function CzMap({ regions, metric, activeCode, onActivate, className }: CzMapProps) {
  const reduce = useReducedMotion();
  const t = useTranslations("jobMarket");
  const byCode = useMemo(() => new Map(regions.map((r) => [r.code, r])), [regions]);
  const scale = useMemo(() => regionScale(regions, metric), [regions, metric]);
  const activeGeo = activeCode ? geo.regions[activeCode] : null;
  // Localised words the per-region accessible name stitches its figures between,
  // so a keyboard/SR user hears the region's VALUE (not just its name) on focus.
  const labelText = {
    vacancies: t("map.a11yVacancies"),
    median: t("map.a11yMedian"),
    medianUnavailable: t("map.a11yMedianUnavailable"),
  };

  return (
    <svg
      viewBox={geo.viewBox}
      className={className}
      role="group"
      aria-label={t("map.ariaLabel")}
      style={{ overflow: "visible" }}
    >
      {ENTRIES.map(([code, g], i) => {
        const region = byCode.get(code);
        const norm = region ? scale(region) : 0;
        const fill = !region ? "#e8e2d4" : metric === "volume" ? heatColor(norm) : salaryColor(norm);
        // Fold the region's figures into its accessible name (falls back to the
        // bare geo name only for regions absent from the data snapshot).
        const label = region ? regionAriaLabel(region, labelText) : g.name;
        return (
          <motion.path
            key={code}
            d={g.d}
            fill={fill}
            stroke={INK}
            strokeWidth={1.4}
            strokeLinejoin="round"
            tabIndex={0}
            role="button"
            aria-label={label}
            // Reflect the selected region so the button role is honest to AT
            // (which region's figures the detail card is currently showing).
            aria-pressed={activeCode === code}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={reduce ? undefined : { delay: i * 0.02, duration: 0.3 }}
            style={{ cursor: "pointer", outline: "none", transition: "fill 0.25s ease" }}
            onMouseEnter={() => onActivate(code)}
            onFocus={() => onActivate(code)}
            onClick={() => onActivate(code)}
            // Honour the button keyboard contract the role implies: Enter/Space
            // activate the region (and Space must not scroll the page).
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
                e.preventDefault();
                onActivate(code);
              }
            }}
          />
        );
      })}

      {/* Active highlight — an outline overlay on top of the stable base map, so
          hovering changes only this element's border (no map reorder/re-render). */}
      {activeGeo && (
        <g pointerEvents="none">
          <path d={activeGeo.d} fill="none" stroke={INK} strokeWidth={4.5} strokeLinejoin="round" />
          <path d={activeGeo.d} fill="none" stroke={CORAL} strokeWidth={2} strokeLinejoin="round" />
        </g>
      )}
    </svg>
  );
}
