/**
 * The scoped stylesheet `MotionizedGlyph` renders for one glyph instance.
 *
 * Split out of the component for one reason: this is where a preset's declared
 * behaviour becomes actual CSS, and until it was a function nothing could check
 * that the two agreed. `MotionPreset.reduced` had been documented as the
 * `prefers-reduced-motion` contract ("cross-fade only, or don't run at all")
 * since the library was written, and the renderer never read the field — every
 * preset, including the ones declaring `reduced: "none"`, got the same hardcoded
 * cross-fade. A preset could ask for stillness and still fade in.
 *
 * Pure string in, pure string out: no React, no DOM, so `glyphMotionCss.test.ts`
 * asserts the derivation directly.
 */
import { REDUCED_FADE_DURATION_S, REDUCED_FADE_KEYFRAMES, type MotionPreset } from "./motionPresets";

export interface GlyphMotionCssInput {
  /** Per-instance class prefix (`mz-<useId>`), which is what scopes every rule. */
  cls: string;
  entrance: MotionPreset;
  /** The ambient loop riding the accent paths, when the consumer asked for one. */
  ambient?: MotionPreset | null;
}

/**
 * What a layer animates to under `prefers-reduced-motion: reduce`, per its own
 * `reduced` field.
 *
 * `none` cannot simply drop the `animation` — the resting `.el` state is
 * `opacity: 0` (so a path does not flash before its stagger lands), so removing
 * the animation without restoring opacity would render an invisible glyph. That
 * is why this returns the whole declaration block and not just an animation
 * value.
 */
function reducedAnimation(preset: MotionPreset, cls: string): string {
  return preset.reduced === "none" ? "none" : `${cls}-fade ${REDUCED_FADE_DURATION_S}s ${preset.ease} both`;
}

export function glyphMotionCss({ cls, entrance, ambient }: GlyphMotionCssInput): string {
  const amb = ambient ?? null;
  const enterAnim = `${cls}-in ${entrance.durationS}s ${entrance.ease} both`;
  const loopAnim = amb
    ? `${cls}-amb ${amb.durationS}s ${amb.ease} ${amb.iteration ?? "infinite"} ${amb.direction ?? "alternate"} forwards`
    : "";

  // Reduced motion, layer by layer. The entrance decides the baseline; a loop
  // that declares `reduced: "none"` is dropped onto that baseline, and one that
  // declares `opacity-only` keeps running (its keyframes touch opacity only, so
  // there is no vestibular motion to suppress).
  const enterReduced = reducedAnimation(entrance, cls);
  const stillFix = entrance.reduced === "none" ? " opacity: 1;" : "";
  const ambKeepsLoop = !!amb && amb.reduced === "opacity-only";

  return `
        @keyframes ${cls}-in { ${entrance.keyframes} }
        @keyframes ${cls}-fade { ${REDUCED_FADE_KEYFRAMES} }
        .${cls}-el { opacity: 0; transform-box: fill-box; transform-origin: 50% 50%; }
        .${cls}-run .${cls}-el { animation: ${enterAnim}; }
${
  amb
    ? `        @keyframes ${cls}-amb { ${amb.keyframes} }
        /* The loop is 'forwards', NOT 'both': under 'both' its backwards fill would apply
           the from-state (a dimmed accent) during the start delay and fight the entrance. */
        .${cls}-run .${cls}-amb { animation: ${enterAnim}, ${loopAnim}; }`
    : ""
}
        @media (prefers-reduced-motion: reduce) {
          /* entrance declares reduced: '${entrance.reduced}' */
          .${cls}-run .${cls}-el { animation: ${enterReduced};${stillFix} }
${
  amb
    ? `          /* loop declares reduced: '${amb.reduced}' — ${ambKeepsLoop ? "opacity-only, so it keeps running" : "dropped entirely"} */
          .${cls}-run .${cls}-amb { animation: ${ambKeepsLoop ? `${enterReduced}, ${loopAnim}` : enterReduced};${stillFix} }`
    : ""
}
        }
      `;
}

/** Seconds a path waits before its entrance runs — the emitted 0..1 delay, mapped. */
export function entranceDelayS(entrance: MotionPreset, delay: number, spread: number): number {
  return entrance.stagger ? entrance.stagger(delay, spread) : 0;
}
