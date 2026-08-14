/*
 * Shared choreography vocabulary for the About scenes.
 *
 * Every scene on this tab is a *self-playing loop*: it replays the mechanism it
 * explains for as long as it is on screen, and rewinds when it leaves. That is a
 * deliberate exception to the "animation austerity" rule the prototype skill
 * applies to workspace surfaces — About is an explanatory showcase, not a tool,
 * and a mechanism you can only see once is a mechanism most readers miss. The
 * exception is bounded three ways:
 *
 *   1. Loops are gated on visibility (`useSceneLoop`), so nothing animates in a
 *      tab you are not looking at.
 *   2. `prefers-reduced-motion` resolves every loop to its FINAL frame — the
 *      fully-drawn diagram — rather than freezing it half-built or stopping it
 *      on step 0. A reduced-motion reader gets the conclusion, not a stub.
 *   3. No scene animates anything a reader has to chase: the loop redraws a
 *      diagram in place, it never moves the reading position.
 *
 * Timings live here rather than per-scene so the whole deck breathes at one
 * tempo; a scene that needs a different beat passes an explicit override.
 */

/**
 * The house ease — a strong out-quint. Long tail, so a value "arrives" and
 * settles rather than sliding to a stop. Matches `app/landing/spark/about-art`
 * (`DRAW`) so the workspace deck and the public /about read as one hand.
 */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Draw a stroke, fill a track, sweep a dial. */
export const DRAW = { duration: 0.9, ease: EASE_OUT } as const;

/** A value or label arriving in place. */
export const ARRIVE = { duration: 0.45, ease: EASE_OUT } as const;

/**
 * Something landing with weight — a stamp, a verdict, a card dropping onto a
 * stack. `bounce` is what makes Spark Dark's sticker register feel physical;
 * Studio Light gets the same physics at a calmer amplitude by using SETTLE.
 */
export const STAMP = { type: "spring", bounce: 0.45, duration: 0.6 } as const;

/** The quieter spring: geometry that moves but must not draw attention. */
export const SETTLE = { type: "spring", bounce: 0.15, duration: 0.5 } as const;

/**
 * Per-item offset inside a group that enters together. Small enough to read as
 * one gesture, large enough that the eye can count the items.
 */
export const STAGGER = 0.07;

/**
 * One beat of the scene clock, in ms. Long enough to read a short label at a
 * glance without the loop feeling like a slideshow. Scenes express "dwell here
 * longer" by spending two ticks on a beat in their `data.ts`, not by varying
 * the tick — a constant tick is what lets several scenes on screen at once feel
 * like one instrument rather than three.
 */
export const TICK_MS = 900;

/**
 * Colour is the one thing framer must NOT animate here.
 *
 * Every colour in the workspace resolves through a CSS variable, and half of
 * them are `color-mix()` (that is how `bg-coral/10` compiles under Tailwind v4).
 * framer cannot interpolate either form — it will read the computed value once
 * and then jump. So: **framer owns transform / opacity / pathLength; CSS owns
 * colour.** Scoped, never `transition-all`, so a transform handled by framer and
 * a colour handled by CSS can't fight over the same property.
 */
export const SKIN = "transition-[background-color,border-color,color,box-shadow] duration-500";

/**
 * Stroke colours for the connector layers.
 *
 * SVG `stroke` cannot take a Tailwind colour utility and a literal hex is
 * banned outside `app/landing/`, so wires paint through the token variables
 * directly. Both theme blocks re-declare these, so a wire re-skins with
 * everything else — no `useTheme()` fork needed.
 *
 * Named by ROLE, not by hue, so a scene reads as an argument: `quiet` is
 * structure that is merely present, `line` is a real relationship, `act` is the
 * thing that just happened, `good` is a verdict that landed well.
 */
export const INK = {
  quiet: "var(--color-stone-300)",
  line: "var(--color-steel)",
  act: "var(--color-coral)",
  good: "var(--color-moss)",
} as const;

/**
 * How much of a scene must be in view before its loop starts. Deliberately
 * under half: these scenes are tall, and waiting for 50% means a reader on a
 * short viewport never triggers the mechanism they scrolled to.
 */
export const IN_VIEW_AMOUNT = 0.35;
