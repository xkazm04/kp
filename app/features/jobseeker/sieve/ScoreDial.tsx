import type { CSSProperties } from "react";
import type { FitTier } from "@/app/_lib/jobseeker/types";

// Weigh's score as a DIAL - the /about step art's ring, in the flow's tokens. The ring is
// drawn to the score in the tier's colour; the confidence band is the softer, wider arc
// behind it, so "68, likely 60-76" reads as a place on a circle, not a lone number. The
// number sits at display size in the centre. One image with one name (aria-label): the
// band sentence beside it says the same in words.
//
// The score arc draws itself in as the panel scrolls into view (sieve.css, transition-
// gated); a still reader gets the finished ring.

const R = 64;
const C = 2 * Math.PI * R;

export function ScoreDial({ total, low, high, tier, label }: { total: number; low: number | null; high: number | null; tier: FitTier | null; label: string }) {
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const score = clamp(total);
  const band = low !== null && high !== null ? { from: clamp(low), to: clamp(Math.max(low, high)) } : null;
  return (
    <svg className={`dial t-${tier ?? "partial"}`} viewBox="0 0 160 160" role="img" aria-label={label}>
      <circle cx="80" cy="80" r={R} className="dial-track" />
      {band ? (
        <circle
          cx="80"
          cy="80"
          r={R}
          className="dial-band"
          strokeDasharray={`${(C * (band.to - band.from)) / 100} ${C}`}
          strokeDashoffset={(-C * band.from) / 100}
          transform="rotate(-90 80 80)"
        />
      ) : null}
      <circle
        cx="80"
        cy="80"
        r={R}
        className="dial-arc"
        strokeDasharray={`${(C * score) / 100} ${C}`}
        transform="rotate(-90 80 80)"
        style={{ "--arc": `${(C * score) / 100}px` } as CSSProperties}
      />
      <text x="80" y="80" textAnchor="middle" dominantBaseline="central" className="dial-num">
        {Math.round(score)}
      </text>
    </svg>
  );
}
