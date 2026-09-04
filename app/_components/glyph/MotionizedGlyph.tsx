"use client";

/**
 * MotionizedGlyph — renderer for a /motionize traced glyph (kp).
 *
 * Maps an emitted `{ d, fill, delay }[]` (`.claude/skills/motionize/tools/trace.mjs
 * --emit`) to a center-out reveal. Two orthogonal layers compose: a one-shot
 * `entrance`, and an optional ambient `ambient` loop that starts only *after* the
 * entrance finishes. Ambient loops are accent-only, so the traced ink line-work
 * stays still.
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
  ambientStartDelayS,
  type AmbientPresetName,
  type EntrancePresetName,
} from "./motionPresets";
import { entranceDelayS, glyphMotionCss } from "./glyphMotionCss";
import { GLYPH_SIZE } from "./glyphSizes";
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
  /** Sizing + layout classes. Defaults to `GLYPH_SIZE.lg`; pass another step
   *  from `./glyphSizes` rather than a hand-typed `h-N w-N` pair. */
  className?: string;
  /**
   * Accessible name. Omitted (the default) the glyph is `aria-hidden` decoration —
   * correct wherever adjacent text already carries the meaning. Pass a translated
   * string ONLY where the drawing itself is the information.
   */
  label?: string;
  /** Total reveal spread in seconds (a path's 0..1 delay maps into this). */
  spread?: number;
  /** One-shot reveal. See motionPresets.ts. */
  entrance?: EntrancePresetName;
  /**
   * Barely-there loop on the accent paths, starting after the entrance settles.
   * `pulse` implies activity — only use it where work is actually happening.
   */
  ambient?: AmbientPresetName;
}

export function MotionizedGlyph({
  data,
  viewBox,
  // The scale, not a fifth size: `glyphSizes.ts` is the vocabulary every call
  // site draws from, and a hand-typed default is the one size nobody chose.
  className = GLYPH_SIZE.lg,
  label,
  spread = 1.1,
  entrance = "staggered-draw",
  ambient,
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
  // The whole scoped stylesheet, derived from the presets — including what each
  // layer does under `prefers-reduced-motion` (see glyphMotionCss.ts).
  const css = glyphMotionCss({ cls, entrance: enter, ambient: amb });
  // The ambient loop waits for the entrance to finish — sequenced, not overlapped.
  const ambDelay = amb ? ambientStartDelayS(enter, spread) : 0;

  return (
    <svg
      ref={svgRef}
      viewBox={viewBox}
      className={className}
      // A glyph is decorative by default: every render site so far pairs it with a
      // heading and a body sentence that already say what it depicts, so naming it
      // again would make a screen reader read the same thing twice. `label` is the
      // escape hatch for the site where the drawing IS the information — and the
      // two attributes are mutually exclusive, because `aria-hidden` on an element
      // that also carries `role="img"` and a name is a contradiction the AT resolves
      // by dropping the name.
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <style>{css}</style>
      <g key={runKey} className={`${cls}-run`}>
        {painted.map((p, i) => {
          // Ambient loops ride the accent paths only — traced line-work stays still.
          const loops = !!amb && (amb.accentOnly ? p.accent : true);
          const delay = entranceDelayS(enter, p.delay, spread);
          return (
            <path
              key={i}
              className={`${cls}-el${loops ? ` ${cls}-amb` : ""}`}
              // Two comma-separated values when a loop rides along: the entrance's
              // per-path stagger, then the loop's post-entrance start.
              style={{ animationDelay: loops ? `${delay}s, ${ambDelay}s` : `${delay}s` }}
              d={p.d}
              fill={p.paint}
            />
          );
        })}
      </g>
    </svg>
  );
}
