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

export type EntrancePresetName = "staggered-draw" | "fade-pop";
export type AmbientPresetName = "float" | "pulse";

/**
 * Every preset name the renderer can actually reach. `MotionizedGlyph` composes
 * exactly two props (`entrance` / `ambient`), so a preset outside those two
 * records would be documented API that no consumer could ever invoke. A
 * `success-settle` oneshot lived here unreachably until 2026-08; a `draw`
 * entrance and a `hover-response` layer did the same until 2026-09 — the first
 * because every traced glyph in this repo is FILLED (a `pathLength` sweep on a
 * fill traces the region boundary and reads as noise, as its own docstring
 * warned), the second because no glyph in the app sits inside an interactive
 * parent. `motionPresets.test.ts` asserts this union equals the two records'
 * keys, so neither returns without the prop that renders it — and the rule the
 * removals establish is stricter: a preset needs a real consumer, not a prop.
 */
export type MotionPresetName = EntrancePresetName | AmbientPresetName;

export interface MotionPreset {
  kind: "entrance" | "loop";
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
  /** Loops: apply to accent paths only, not the ink line-work. */
  accentOnly?: boolean;
}

/** Shared reduced-motion cross-fade, referenced by every `opacity-only` preset. */
export const REDUCED_FADE_KEYFRAMES = "from { opacity: 0; } to { opacity: 1; }";
export const REDUCED_FADE_DURATION_S = 0.45;

export const ENTRANCE_PRESETS: Record<EntrancePresetName, MotionPreset> = {
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

/**
 * Flat registry over the two renderable layers. `MotionizedGlyph` imports the
 * sub-records (it needs to know which layer a name belongs to); this record is
 * the lookup for anything that only has a bare preset name — and the surface the
 * set-equality guard in `motionPresets.test.ts` checks `MotionPresetName` against.
 */
export const MOTION_PRESETS: Record<MotionPresetName, MotionPreset> = {
  ...ENTRANCE_PRESETS,
  ...AMBIENT_PRESETS,
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
