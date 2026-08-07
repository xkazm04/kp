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
import { geo, heatColor, salaryColor, regionScale, type MapMetric, type Region } from "./data";
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
  const byCode = useMemo(() => new Map(regions.map((r) => [r.code, r])), [regions]);
  const scale = useMemo(() => regionScale(regions, metric), [regions, metric]);
  const activeGeo = activeCode ? geo.regions[activeCode] : null;

  return (
    <svg
      viewBox={geo.viewBox}
      className={className}
      role="group"
      aria-label="Map of Czech regions"
      style={{ overflow: "visible" }}
    >
      {ENTRIES.map(([code, g], i) => {
        const region = byCode.get(code);
        const t = region ? scale(region) : 0;
        const fill = !region ? "#e8e2d4" : metric === "volume" ? heatColor(t) : salaryColor(t);
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
            aria-label={g.name}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={reduce ? undefined : { delay: i * 0.02, duration: 0.3 }}
            style={{ cursor: "pointer", outline: "none", transition: "fill 0.25s ease" }}
            onMouseEnter={() => onActivate(code)}
            onFocus={() => onActivate(code)}
            onClick={() => onActivate(code)}
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
