"use client";

import type { CSSProperties, ReactNode } from "react";
import { motion } from "framer-motion";
import { SKIN } from "./motion";
import { atStage, rectStyle, stepDelay, type ModuleStage, type Rect } from "./stages";

/*
 * The atoms every About scene composes from.
 *
 * Two ideas carry most of the quality here:
 *
 * 1. **Nothing mounts or unmounts mid-loop.** `Slot` is present for the entire
 *    cycle and crossfades between a ghost skin and a solid one. A box that
 *    appears would reflow the field, which would move the anchor of any
 *    connector drawn to it — and a diagram whose wires twitch reads as broken,
 *    not as alive. Content inside a slot may arrive and leave; the slot may not.
 *
 * 2. **Geometry is percent-of-field.** Scenes place everything with percent
 *    rects inside one `relative` box, and their connector SVG runs
 *    `viewBox="0 0 100 100" preserveAspectRatio="none"` — so `50` in a path and
 *    `50%` in a style are literally the same point. The cost is that strokes
 *    scale anisotropically; on diagrams that read as drawn ink rather than as
 *    engineering drawings, that is a texture, not a defect. Where it isn't
 *    acceptable, build the shape out of positioned boxes instead of SVG.
 */

/** The field: a `relative` box with a height floor. */
export function Field({
  children,
  className = "",
  min = "min-h-[22rem] sm:min-h-[26rem]",
}: {
  children: ReactNode;
  className?: string;
  /**
   * Percent geometry shrinks with the viewport; the type inside it does not.
   * Without a floor, a scene's labels collide before its layout does.
   */
  min?: string;
}) {
  return <div className={`relative w-full ${min} ${className}`}>{children}</div>;
}

/**
 * One part of a stage arriving. `i` is its place in the sub-beat cascade, so a
 * group of parts reads as a single gesture rather than as a list loading in.
 *
 * Deliberately CSS, not framer, and deliberately ALWAYS MOUNTED. Both choices
 * are the fix for a real bug:
 *
 *   - This component used to `return null` while hidden. That contradicted the
 *     rule at the top of this file, and it broke the cascade outright: a framer
 *     animation carrying a `delay` that is unmounted before the delay elapses
 *     never starts, so it leaves the element pinned at its `initial` — every
 *     part with `i > 0` stayed invisible for the whole loop while the `i = 0`
 *     part of each group appeared normally.
 *   - Staying mounted also means the reveal is a plain class flip on a stable
 *     element, which a CSS transition handles natively and which no amount of
 *     re-rendering from the scene clock can interrupt. Scenes re-render every
 *     900ms; JS-scheduled per-part animations are simply the wrong tool here,
 *     and there can be forty parts in one scene.
 *
 * The text stays in the accessibility tree throughout. That is intended: a
 * screen-reader user gets the finished diagram as stable prose instead of a
 * moving target, which is the same thing reduced motion gets.
 */
export function Part({
  show,
  i = 0,
  lead = 0,
  reduced,
  className = "",
  style,
  children,
}: {
  show: boolean;
  i?: number;
  lead?: number;
  reduced: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  // Duration and delay are inline rather than `duration-*` utilities on
  // purpose: two Tailwind classes that set the same property have no defined
  // precedence from the order they appear in a template string, so a
  // `duration-0 duration-500` pair would resolve by stylesheet order and the
  // reduced-motion branch could silently lose.
  const delayMs = reduced ? 0 : Math.round(stepDelay(i, lead) * 1000);
  return (
    <span
      className={`transition-[opacity,transform] ease-out ${
        show ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
      } ${className}`}
      style={{
        transitionDuration: reduced ? "0ms" : "450ms",
        transitionDelay: show ? `${delayMs}ms` : "0ms",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/**
 * A staged surface. Ghost = a dashed outline holding its space; anything from
 * `shell` up = a real panel. The border/background transition is CSS (see
 * `SKIN` in motion.ts — framer cannot tween a `color-mix()`), while framer
 * handles only the tiny scale settle on the commit beat.
 */
export function Slot({
  rect,
  stage,
  chosen = false,
  reduced,
  className = "",
  children,
}: {
  rect: Rect;
  stage: ModuleStage;
  /** Draw the commit treatment — the coral edge that means "this one was picked". */
  chosen?: boolean;
  reduced: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const solid = atStage(stage, "shell");
  return (
    <div
      className={`absolute overflow-hidden rounded-lg border ${SKIN} ${
        solid
          ? chosen
            ? "border-coral bg-white shadow-panel"
            : "border-stone-200 bg-white shadow-panel"
          : "border-dashed border-stone-300 bg-transparent"
      } ${chosen && !reduced ? "scale-[1.02]" : "scale-100"} ${className}`}
      // Only the commit beat moves geometry, and only by 2%. Position is owned
      // by the percent rect, so the settle can never drift a connector anchor.
      style={{ ...rectStyle(rect), transitionDuration: reduced ? "0ms" : "500ms" }}
    >
      {children}
    </div>
  );
}

/**
 * The connector layer. One unlocked-viewBox SVG stretched over the field, so
 * every path coordinate is a percentage of the field in each axis.
 */
export function Wires({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <svg
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      fill="none"
    >
      {children}
    </svg>
  );
}

/**
 * A wire that draws itself.
 *
 * `pathLength` is one of the few SVG attributes framer can safely animate
 * (unlike `cx`/`cy`/`r`, which can render as "undefined" mid-mount — see the
 * prototype skill's guardrails). Two things it must NOT be combined with:
 *
 *   - `vector-effect: non-scaling-stroke`. framer normalises the path to
 *     userSpace units to implement `pathLength`, while the vector effect
 *     resolves dash lengths in screen units. The two disagree and a line that
 *     must read as one unbroken stroke comes out dotted. So strokes here scale
 *     with the unlocked viewBox — anisotropically, which on a diagram that
 *     reads as drawn ink is a texture rather than a defect.
 *   - `strokeDasharray`. framer *implements* `pathLength` through
 *     dasharray/dashoffset, so authoring a dash pattern on the same element
 *     overwrites the animation. A dashed wire therefore fades in rather than
 *     drawing — which is right anyway: dashed here means "possible route", and
 *     a possibility shouldn't animate as though it happened.
 *
 * `stroke` takes a token var, e.g. `var(--color-stone-300)`, because SVG
 * strokes cannot use Tailwind colour utilities and a literal hex is banned
 * outside `app/landing/`.
 */
export function Wire({
  d,
  drawn,
  stroke,
  width = 0.5,
  dashed = false,
  delay = 0,
  reduced,
}: {
  d: string;
  drawn: boolean;
  stroke: string;
  width?: number;
  /** Renders as "a route that exists but was not taken" — fades, never draws. */
  dashed?: boolean;
  delay?: number;
  reduced: boolean;
}) {
  const common = {
    d,
    stroke,
    strokeWidth: width,
    strokeLinecap: "round" as const,
  };
  const timing = reduced ? { duration: 0 } : { duration: 0.55, ease: "easeInOut" as const, delay };

  if (dashed) {
    return (
      <motion.path
        {...common}
        strokeDasharray="2.5 2.5"
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: drawn ? 0.9 : 0 }}
        transition={timing}
      />
    );
  }

  return (
    <motion.path
      {...common}
      initial={reduced ? false : { pathLength: 0, opacity: 0 }}
      animate={{ pathLength: drawn ? 1 : 0, opacity: drawn ? 1 : 0 }}
      transition={timing}
    />
  );
}
