"use client";

/**
 * MotionizedGlyph — renderer for a /motionize traced glyph (kp).
 *
 * Maps an emitted `{ d, fill, delay }[]` (`.claude/skills/motionize/tools/trace.mjs
 * --emit`) to a center-out reveal. Three orthogonal layers compose: a one-shot
 * `entrance`, an optional ambient `ambient` loop that starts only *after* the
 * entrance finishes, and an optional `hover` transition on the wrapper group.
 * Ambient loops are accent-only, so the traced ink line-work stays still.
 *
 * All timing/easing lives in `./motionPresets.ts`, never inline here or in a
 * consumer — one file to tune, every motionized surface follows.
 *
 * **Dual theme comes for free** because nothing renders a raw hex. The tracer
 * quantizes flat art into a dozen near-identical hexes; we snap each one to the
 * nearest kp brand token and paint `var(--color-…)`, so Studio Light and Spark
 * Dark both resolve from `app/globals.css` with zero per-theme overrides and zero
 * hardcoded colors (the house rule in `.claude/CLAUDE.md`). It also costs no
 * re-render on theme switch — the CSS variable flips underneath.
 *
 * Implementation notes worth keeping:
 * - CSS keyframes, not framer-motion: a reveal is a declarative timeline over
 *   dozens of paths, and scoped `@keyframes` stay cheap at that path count.
 * - An IntersectionObserver replays the *entrance* on viewport re-entry (tab
 *   switch, scroll-back); ambient loops keep their own clock.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AMBIENT_PRESETS,
  ENTRANCE_PRESETS,
  HOVER_PRESETS,
  REDUCED_FADE_DURATION_S,
  REDUCED_FADE_KEYFRAMES,
  ambientStartDelayS,
  type AmbientPresetName,
  type EntrancePresetName,
  type HoverPresetName,
} from "./motionPresets";
import { snapToToken } from "./glyphTokens";

export interface GlyphElement {
  d: string;
  fill: string;
  delay: number;
}
/** A traced glyph module's shape (see `app/_components/glyph/glyphs/`). */
export interface TracedGlyph {
  viewBox: string;
  data: GlyphElement[];
}

interface Props {
  data: GlyphElement[];
  viewBox: string;
  className?: string;
  /** Emissive blur on the accent paths. Reads best in Spark Dark; use sparingly. */
  glow?: boolean;
  /** Total reveal spread in seconds (a path's 0..1 delay maps into this). */
  spread?: number;
  /** One-shot reveal. See motionPresets.ts. */
  entrance?: EntrancePresetName;
  /**
   * Barely-there loop on the accent paths, starting after the entrance settles.
   * `pulse` implies activity — only use it where work is actually happening.
   */
  ambient?: AmbientPresetName;
  /** Layers a transition on the wrapper group; pair with an interactive parent. */
  hover?: HoverPresetName;
}

export function MotionizedGlyph({
  data,
  viewBox,
  className = "h-40 w-40",
  glow,
  spread = 1.1,
  entrance = "staggered-draw",
  ambient,
  hover,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gid = useId().replace(/:/g, "");
  // First reveal plays on mount; the observer bumps this to replay on re-entry.
  const [runKey, setRunKey] = useState(1);
  const seen = useRef<boolean | null>(null);

  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries[0]?.isIntersecting ?? false;
        if (seen.current === null) {
          seen.current = vis; // initial observation
          return;
        }
        if (vis && !seen.current) setRunKey((k) => k + 1); // re-entered view → replay
        seen.current = vis;
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const cls = `mz-${gid}`;
  const painted = useMemo(() => data.map((p) => ({ ...p, ...snapToToken(p.fill) })), [data]);

  const enter = ENTRANCE_PRESETS[entrance];
  const amb = ambient ? AMBIENT_PRESETS[ambient] : null;
  const hov = hover ? HOVER_PRESETS[hover] : null;
  const enterDelay = (delay: number) => (enter.stagger ? enter.stagger(delay, spread) : 0);
  const reducedFade = `${cls}-fade ${REDUCED_FADE_DURATION_S}s ${enter.ease} both`;
  // The ambient loop waits for the entrance to finish — sequenced, not overlapped.
  const ambDelay = amb ? ambientStartDelayS(enter, spread) : 0;

  return (
    <svg ref={svgRef} viewBox={viewBox} className={className} aria-hidden role="img">
      <style>{`
        @keyframes ${cls}-in { ${enter.keyframes} }
        @keyframes ${cls}-fade { ${REDUCED_FADE_KEYFRAMES} }
        .${cls}-el { opacity: 0; transform-box: fill-box; transform-origin: 50% 50%; }
        ${entrance === "draw" ? `.${cls}-el { stroke-dasharray: 1; }` : ""}
        .${cls}-run .${cls}-el { animation: ${cls}-in ${enter.durationS}s ${enter.ease} both; }
${
  amb
    ? `        @keyframes ${cls}-amb { ${amb.keyframes} }
        /* The loop is 'forwards', NOT 'both': under 'both' its backwards fill would apply
           the from-state (a dimmed accent) during the start delay and fight the entrance. */
        .${cls}-run .${cls}-amb { animation: ${cls}-in ${enter.durationS}s ${enter.ease} both, ${cls}-amb ${amb.durationS}s ${amb.ease} ${amb.iteration ?? "infinite"} ${amb.direction ?? "alternate"} forwards; }`
    : ""
}
${
  hov
    ? `        .${cls}-hover { transform-box: fill-box; transform-origin: 50% 50%; transition: transform ${hov.durationS}s ${hov.ease}, opacity ${hov.durationS}s ${hov.ease}; }
        svg:hover > .${cls}-hover { transform: scale(1.03); }`
    : ""
}
        @media (prefers-reduced-motion: reduce) {
          .${cls}-run .${cls}-el { animation: ${reducedFade}; }
${
  amb
    ? `          /* ambient loops declare reduced: 'none' — drop the loop entirely */
          .${cls}-run .${cls}-amb { animation: ${reducedFade}; }`
    : ""
}
${hov ? `          svg:hover > .${cls}-hover { transform: none; }` : ""}
        }
      `}</style>
      {glow && (
        <defs>
          <filter id={`${cls}-glow`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="7" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      )}
      {/* Outer group carries the hover transition so it composes over the reveal. */}
      <g className={hov ? `${cls}-hover` : undefined}>
        <g key={runKey} className={`${cls}-run`}>
          {painted.map((p, i) => {
            // Ambient loops ride the accent paths only — traced line-work stays still.
            const loops = !!amb && (amb.accentOnly ? p.accent : true);
            return (
              <path
                key={i}
                className={`${cls}-el${loops ? ` ${cls}-amb` : ""}`}
                // Two comma-separated values when a loop rides along: the entrance's
                // per-path stagger, then the loop's post-entrance start.
                style={{ animationDelay: loops ? `${enterDelay(p.delay)}s, ${ambDelay}s` : `${enterDelay(p.delay)}s` }}
                pathLength={entrance === "draw" ? 1 : undefined}
                d={p.d}
                fill={p.paint}
                filter={glow && p.accent ? `url(#${cls}-glow)` : undefined}
              />
            );
          })}
        </g>
      </g>
    </svg>
  );
}
