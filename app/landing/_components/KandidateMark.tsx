import type { SVGProps } from "react";

/*
 * Kandidate logomark — rounded badge, geometric K, and the "decision dot".
 * The dot is the brand story: hiring ends in a call being made; the mark puts
 * a period after the K. Theme-adaptive by design:
 *   - badge fill   → currentColor (set text-* on the svg)
 *   - letter K     → var(--k-fg), defaults to warm paper
 *   - decision dot → var(--k-accent), defaults to coral
 * Variants recolor it with one wrapping style, no extra assets needed.
 */
export default function KandidateMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" {...props}>
      <rect width="48" height="48" rx="12" fill="currentColor" />
      <path
        d="M15 12v24M15.5 25.5 31 12M15.5 24.5 32 36"
        stroke="var(--k-fg, #f7f5ef)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="38.5" cy="36" r="3.4" fill="var(--k-accent, #d65a4a)" />
    </svg>
  );
}
