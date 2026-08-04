/**
 * Motion preset library for /motionize traced glyphs (kp).
 *
 * ONE place where glyph motion is defined. `MotionizedGlyph` turns a preset into
 * scoped `@keyframes` + `animation` declarations — so tuning a timing here retunes
 * every motionized surface in the app at once. **Never inline keyframes in a
 * consuming component**; add or edit a preset instead.
 *
 * CSS-keyframe data, not framer-motion variants: framer motion in kp lives behind
 * reduced-motion gates and `AnimatePresence` for mount/unmount, while a glyph
 * reveal is a pure declarative timeline over dozens of paths — cheaper and more
 * reliable as scoped CSS. It also keeps this file dependency-free.
 *
 * Taste guardrails (from .claude/skills/motionize/SKILL.md — keep them true):
 * - Entrance total <= ~1.2s (last stagger delay + duration). Quiet and deliberate.
 * - Ambient loops are barely-there: translate <= 3px, opacity delta <= 0.08,
 *   period 3-6s. A screenshot 3s apart should look near-identical.
 * - Never loop a transform that implies progress on a state where no work is
 *   happening — a sweep on an idle empty state reads as "loading" and is a lie.
 * - Every preset degrades under `prefers-reduced-motion` per its `reduced` field.
 */

export type EntrancePresetName = "draw" | "staggered-draw" | "fade-pop";
export type AmbientPresetName = "float" | "pulse";
export type HoverPresetName = "hover-response";

/**
 * Every preset name the renderer can actually reach. There is deliberately no
 * fourth "oneshot" layer: `MotionizedGlyph` composes exactly three props
 * (`entrance` / `ambient` / `hover`), so a preset outside those three records
 * would be documented API that no consumer could ever invoke. A `success-settle`
 * oneshot lived here unreachably until 2026-08 — `motionPresets.test.ts` now
 * asserts this union equals the three records' keys, so it cannot come back
 * without the prop that renders it.
 */
export type MotionPresetName = EntrancePresetName | AmbientPresetName | HoverPresetName;

export interface MotionPreset {
  kind: "entrance" | "loop" | "hover";
  /** `@keyframes` body (from/to or % steps). The renderer scopes it per instance. */
  keyframes: string;
  /** Seconds. For loops this is the period. */
  durationS: number;
  ease: string;
  /** Entrances: map a path's emitted 0..1 `delay` into seconds. */
  stagger?: (delay: number, spread: number) => number;
  iteration?: "infinite" | 1;
  /** Loops: `alternate` so the glyph returns to rest rather than jumping back. */
  direction?: "normal" | "alternate";
  /** `prefers-reduced-motion` fallback: cross-fade only, or don't run at all. */
  reduced: "opacity-only" | "none";
  /** Loops/hover: apply to accent paths only, not the ink line-work. */
  accentOnly?: boolean;
}

/** Shared reduced-motion cross-fade, referenced by every `opacity-only` preset. */
export const REDUCED_FADE_KEYFRAMES = "from { opacity: 0; } to { opacity: 1; }";
export const REDUCED_FADE_DURATION_S = 0.45;

export const ENTRANCE_PRESETS: Record<EntrancePresetName, MotionPreset> = {
  /**
   * Stroke trace — the classic "self-drawing" line. STROKE/`--mono` traces only:
   * on filled paths a `pathLength` dash sweep traces the region *boundary*, which
   * reads as noise. Consumers with filled glyphs want `staggered-draw`.
   */
  draw: {
    kind: "entrance",
    keyframes: "from { opacity: 0; stroke-dashoffset: 1; } to { opacity: 1; stroke-dashoffset: 0; }",
    durationS: 0.9,
    ease: "cubic-bezier(0.16, 1, 0.3, 1)",
    stagger: (delay, spread) => 0.08 + delay * spread,
    iteration: 1,
    reduced: "opacity-only",
  },
  /** The default: per-path fade + scale-up, ordered by the emitted radial delay. */
  "staggered-draw": {
    kind: "entrance",
    keyframes: "from { opacity: 0; transform: scale(0.35); } to { opacity: 1; transform: scale(1); }",
    durationS: 0.5,
    ease: "cubic-bezier(0.16, 1, 0.3, 1)",
    stagger: (delay, spread) => 0.08 + delay * spread,
    iteration: 1,
    reduced: "opacity-only",
  },
  /** Whole-glyph pop — for small icons where a per-path stagger is just noise. */
  "fade-pop": {
    kind: "entrance",
    keyframes: "from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); }",
    durationS: 0.35,
    ease: "cubic-bezier(0.16, 1, 0.3, 1)",
    // No per-path stagger: every path shares one timing so the glyph reads as one object.
    stagger: () => 0.05,
    iteration: 1,
    reduced: "opacity-only",
  },
};

export const AMBIENT_PRESETS: Record<AmbientPresetName, MotionPreset> = {
  /** Ambient idle drift. Safe on any state — it implies presence, not progress. */
  float: {
    kind: "loop",
    keyframes: "from { transform: translateY(-2px); opacity: 0.94; } to { transform: translateY(2px); opacity: 1; }",
    durationS: 5,
    ease: "ease-in-out",
    iteration: "infinite",
    direction: "alternate",
    reduced: "none",
    accentOnly: true,
  },
  /**
   * Attention / activity breathing. Only for surfaces where work really is
   * happening (an analysis in flight, a running job) — otherwise it lies.
   */
  pulse: {
    kind: "loop",
    keyframes: "from { opacity: 0.75; } to { opacity: 1; }",
    durationS: 3.5,
    ease: "ease-in-out",
    iteration: "infinite",
    direction: "alternate",
    reduced: "none",
    accentOnly: true,
  },
};

export const HOVER_PRESETS: Record<HoverPresetName, MotionPreset> = {
  /**
   * A `transition` on the wrapper `<g>`, not an animation — so it layers freely
   * on top of whatever entrance/ambient the glyph already runs.
   */
  "hover-response": {
    kind: "hover",
    keyframes: "", // transition-driven; see MotionizedGlyph's hover rule
    durationS: 0.18,
    ease: "cubic-bezier(0.16, 1, 0.3, 1)",
    reduced: "opacity-only",
    accentOnly: true,
  },
};

/**
 * Flat registry over the three renderable layers. `MotionizedGlyph` imports the
 * sub-records (it needs to know which layer a name belongs to); this record is
 * the lookup for anything that only has a bare preset name — and the surface the
 * set-equality guard in `motionPresets.test.ts` checks `MotionPresetName` against.
 */
export const MOTION_PRESETS: Record<MotionPresetName, MotionPreset> = {
  ...ENTRANCE_PRESETS,
  ...AMBIENT_PRESETS,
  ...HOVER_PRESETS,
};

/**
 * When an ambient loop may start: after the entrance has fully finished (last
 * stagger delay + its duration) plus a beat of stillness. Sequencing, not
 * overlapping, is what keeps the reveal legible.
 */
export function ambientStartDelayS(entrance: MotionPreset, spread: number, gapS = 0.2): number {
  const lastDelay = entrance.stagger ? entrance.stagger(1, spread) : 0;
  return lastDelay + entrance.durationS + gapS;
}
