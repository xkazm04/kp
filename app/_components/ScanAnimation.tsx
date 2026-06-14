"use client";

import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { INK, PAPER, MOSS, CORAL, STEEL } from "@/app/_lib/brand";

export function ScanAnimationCompact({ className }: { className?: string }) {
  const reducedMotion = useReducedMotion();
  return (
    <svg
      viewBox="0 0 80 80"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Scanning CV"
    >
      <rect
        x="22"
        y="12"
        width="36"
        height="56"
        rx="3"
        fill={PAPER}
        stroke={INK}
        strokeWidth="2"
      />

      <g opacity="0.55" stroke={STEEL} strokeWidth="1.6" strokeLinecap="round">
        <line x1="28" y1="22" x2="48" y2="22" />
        <line x1="28" y1="28" x2="52" y2="28" />
        <line x1="28" y1="34" x2="46" y2="34" />
        <line x1="28" y1="40" x2="50" y2="40" />
        <line x1="28" y1="46" x2="44" y2="46" />
        <line x1="28" y1="52" x2="50" y2="52" />
        <line x1="28" y1="58" x2="42" y2="58" />
      </g>

      {/* The sweeping scan line + tracer dot loop forever; for reduced-motion
          users we drop them entirely and leave the static document. */}
      {!reducedMotion ? (
        <g>
          <line
            x1="22"
            y1="14"
            x2="58"
            y2="14"
            stroke={MOSS}
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.9"
          >
            <animate
              attributeName="y1"
              values="14;66;14"
              keyTimes="0;0.5;1"
              dur="2.4s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="y2"
              values="14;66;14"
              keyTimes="0;0.5;1"
              dur="2.4s"
              repeatCount="indefinite"
            />
          </line>

          <circle r="2.4" fill={CORAL}>
            <animate
              attributeName="cx"
              values="32;48;36;52;32"
              keyTimes="0;0.25;0.55;0.8;1"
              dur="2.4s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="cy"
              values="14;30;46;58;66"
              keyTimes="0;0.25;0.55;0.8;1"
              dur="2.4s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="0;1;1;1;0"
              keyTimes="0;0.15;0.5;0.85;1"
              dur="2.4s"
              repeatCount="indefinite"
            />
          </circle>
        </g>
      ) : null}
    </svg>
  );
}
