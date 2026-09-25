"use client";

import { useTranslations } from "next-intl";
import type { EligibilityFlag, FitTier, PostingStatus } from "@/app/_lib/jobseeker/types";
import type { ProvenanceMark } from "./sieveModel";

// The Sieve's small marks, drawn once. Each one encodes a fact in its SHAPE, so the
// fact survives without colour and without a legend being read first:
//   ProvMark   where a skill claim comes from — solid (work), half (side project),
//              ring (study), dashed (stated only: nothing backs it)
//   BandGlyph  a score is a band, not a point — the band is the confidence, the tick
//              is the score
//   Pips       the five checks of the seeker's own preferences — ✓ matches, ✕ does
//              not, ? the ad does not say (never folded into either)

export function ProvMark({ mark, size = 14 }: { mark: ProvenanceMark; size?: number }) {
  const c = size / 2;
  const r = size / 2 - 1.6;
  return (
    <svg className="pmark" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      {mark === "solid" ? <circle cx={c} cy={c} r={r + 0.6} fill="currentColor" /> : null}
      {mark === "half" ? (
        <>
          <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d={`M${c} ${c - r} A${r} ${r} 0 0 0 ${c} ${c + r}Z`} fill="currentColor" />
        </>
      ) : null}
      {mark === "ring" ? <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" strokeWidth="2" /> : null}
      {mark === "dashed" ? <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.4 2" /> : null}
    </svg>
  );
}

export function BandGlyph({ total, low, high, tier, width = 84 }: { total: number; low: number; high: number; tier: FitTier | null; width?: number }) {
  return (
    <span className="bg" style={{ width }} aria-hidden>
      <span className={`bg-band tb-${tier ?? "partial"}`} style={{ left: `${low}%`, width: `${Math.max(2, high - low)}%` }} />
      <span className="bg-tick" style={{ left: `${total}%` }} />
    </span>
  );
}

const PIP_GLYPH: Record<EligibilityFlag["state"], string> = { ok: "✓", flag: "✕", unknown: "?" };

export function Pips({ flags }: { flags: EligibilityFlag[] }) {
  const t = useTranslations("me.sieve.checks");
  const label = flags.map((f) => `${t(`key.${f.key}`)}: ${t(`state.${f.state}`)}`).join(", ");
  return (
    <span className="pips" role="img" aria-label={label}>
      {flags.map((f) => (
        <span key={f.key} className={`pip ${f.state}`} aria-hidden>
          {PIP_GLYPH[f.state]}
        </span>
      ))}
    </span>
  );
}

export function Pip({ state }: { state: EligibilityFlag["state"] }) {
  return (
    <span className={`pip ${state}`} aria-hidden>
      {PIP_GLYPH[state]}
    </span>
  );
}

export function TierChip({ tier }: { tier: FitTier | null }) {
  const t = useTranslations("me.sieve.tier");
  if (!tier) return null;
  return <span className={`chip t-${tier}`}>{t(tier)}</span>;
}

export function StatusChip({ status }: { status: PostingStatus }) {
  const t = useTranslations("me.sieve.status");
  if (status === "new") return null;
  return <span className={`chip st-${status}`}>{t(status)}</span>;
}

export function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <rect x="2.5" y="6" width="9" height="7" rx="1.5" fill="currentColor" />
      <path d="M4.5 6V4.5a2.5 2.5 0 015 0V6" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/** The Sieve's own mark: a funnel over a mesh, the last hole lit in the accent. */
export function SieveMark() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden>
      <path d="M3 6h26l-10 12v8l-6 3V18z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx="10" cy="10" r="1.6" fill="currentColor" />
      <circle cx="16" cy="10" r="1.6" fill="currentColor" />
      <circle cx="22" cy="10" r="1.6" fill="currentColor" />
      <circle cx="16" cy="15" r="1.6" fill="var(--sv-accent)" />
    </svg>
  );
}
