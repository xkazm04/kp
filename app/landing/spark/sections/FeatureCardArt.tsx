import type { ReactNode } from "react";
import { AMBER, CORAL, INK, LIMEWASH, MOSS, STEEL } from "../tokens";
import type { PreviewKey } from "../previews";

/*
 * The nine feature cards' background decoration.
 *
 * Each card used to open with the same 44px outlined tile holding a lucide
 * glyph, and close with the same "peek inside" line. Both were duplicates: the
 * glyph repeats inside the spotlight header the card opens, and the section
 * hint above the grid already says every card peeks. Nine identical tiles also
 * made nine identical cards — the eye had nothing to navigate by but the
 * heading text.
 *
 * What replaced them is per-card art traced from the mockup that card actually
 * opens: `score` is the dial from ScorePreview, `schedule` is its slot grid
 * with the picked cell filled, `inbox` is five doors funnelling into one tray,
 * `salary` is the range bar with the marker parked over the band. So the card
 * is a low-contrast thumbnail of its own spotlight, and the tint gives the grid
 * nine different silhouettes to scan rather than nine equal blocks of text.
 *
 * Drawn in the Spark idiom (heavy ink outlines, flat accent fills, literal
 * hexes — the docs/design/README.md art-direction exemption) and rendered under
 * the copy at ~12% so it reads as watermark, never as content. `fill="#fff"` on
 * a white card is invisible by design: it knocks holes in the line art the way
 * a sticker's paper does, so overlapping shapes stay legible instead of
 * stacking into a blob.
 *
 * Purely decorative and inert: `aria-hidden`, no pointer events, no motion of
 * its own beyond the shared hover lift.
 */

/* One accent per card, so the corner wash differs even before the line art
 * resolves. Follows the preview's own dominant colour where it has one. */
const CARD_ART: Record<PreviewKey, { tint: string; art: ReactNode }> = {
  // The 0–100 dial, stamped — ScorePreview's ring, arc and centre badge.
  score: {
    tint: MOSS,
    art: (
      <>
        <circle cx="58" cy="58" r="40" fill="none" stroke={INK} strokeWidth="8" />
        <path d="M58 18a40 40 0 1 1-34 61" fill="none" stroke={MOSS} strokeWidth="8" strokeLinecap="round" />
        <circle cx="58" cy="58" r="21" fill={MOSS} stroke={INK} strokeWidth="5" />
      </>
    )
  },
  // Mic plus the three-bar equaliser that pulses beside the live transcript.
  voice: {
    tint: CORAL,
    art: (
      <>
        <rect x="26" y="16" width="28" height="48" rx="14" fill={CORAL} stroke={INK} strokeWidth="5" />
        <path d="M14 54a26 26 0 0 0 52 0" fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" />
        <path d="M40 80v18" stroke={INK} strokeWidth="5" strokeLinecap="round" />
        <path d="M82 44v38M96 32v50M110 54v28" stroke={INK} strokeWidth="6" strokeLinecap="round" />
      </>
    )
  },
  // The work sample: a flask, and the tick of a planted flaw caught with a
  // known answer. AI is allowed in the beaker; the check is the judgment.
  cases: {
    tint: AMBER,
    art: (
      <>
        <path d="M74 76 60 50V14H44v36L30 76a10 10 0 0 0 9 15h26a10 10 0 0 0 9-15z" fill={AMBER} />
        <path
          d="M44 14v36L30 76a10 10 0 0 0 9 15h26a10 10 0 0 0 9-15L60 50V14"
          fill="none"
          stroke={INK}
          strokeWidth="5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path d="M38 14h28" stroke={INK} strokeWidth="6" strokeLinecap="round" />
        <circle cx="51" cy="74" r="4" fill="#fff" />
        <circle cx="64" cy="65" r="3" fill="#fff" />
        <path d="m84 28 10 10 18-20" fill="none" stroke={MOSS} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      </>
    )
  },
  // SchedulePreview's slot grid, with the candidate's pick already filled.
  schedule: {
    tint: MOSS,
    art: (
      <>
        <rect x="10" y="20" width="100" height="88" rx="12" fill="#fff" stroke={INK} strokeWidth="5" />
        <path d="M10 46h100" stroke={INK} strokeWidth="5" />
        <path d="M34 10v16M86 10v16" stroke={INK} strokeWidth="6" strokeLinecap="round" />
        {[58, 82].map((y) =>
          [24, 54, 84].map((x) => (
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width="22"
              height="16"
              rx="5"
              fill={x === 54 && y === 82 ? MOSS : LIMEWASH}
              stroke={INK}
              strokeWidth="3"
            />
          ))
        )}
      </>
    )
  },
  // Five doors, one pipeline — the channel chips flying home to the tray.
  inbox: {
    tint: CORAL,
    art: (
      <>
        <rect x="6" y="12" width="30" height="13" rx="6.5" fill="#fff" stroke={INK} strokeWidth="4" />
        <rect x="45" y="4" width="30" height="13" rx="6.5" fill="#fff" stroke={INK} strokeWidth="4" />
        <rect x="84" y="12" width="30" height="13" rx="6.5" fill="#fff" stroke={INK} strokeWidth="4" />
        <path d="M21 31 56 52M60 23v29M99 31 64 52" stroke={INK} strokeWidth="4" strokeLinecap="round" />
        <path d="M16 58h88l-11 36a8 8 0 0 1-8 6H35a8 8 0 0 1-8-6z" fill={CORAL} stroke={INK} strokeWidth="5" strokeLinejoin="round" />
      </>
    )
  },
  // The market band with the marker parked over it — SalaryPreview's needle.
  salary: {
    tint: AMBER,
    art: (
      <>
        <rect x="6" y="62" width="108" height="22" rx="11" fill="#fff" stroke={INK} strokeWidth="5" />
        <rect x="44" y="68" width="40" height="10" rx="5" fill={MOSS} />
        <rect x="42" y="18" width="46" height="26" rx="8" fill={AMBER} stroke={INK} strokeWidth="5" />
        <path d="M65 44v16" stroke={INK} strokeWidth="6" strokeLinecap="round" />
        <path d="M20 90v10M65 90v14M108 90v10" stroke={INK} strokeWidth="4" strokeLinecap="round" />
      </>
    )
  },
  // The pool you already paid for: a rewind arc closing back on a candidate.
  rediscover: {
    tint: STEEL,
    art: (
      <>
        <path d="M22 60a38 38 0 1 1 11 27" fill="none" stroke={INK} strokeWidth="8" strokeLinecap="round" />
        <path d="m8 46 14 16 16-12" fill="none" stroke={INK} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="60" cy="60" r="19" fill={STEEL} stroke={INK} strokeWidth="5" />
      </>
    )
  },
  // The letter that drafts itself, signed by a person, sealed on acceptance.
  offer: {
    tint: MOSS,
    art: (
      <>
        <rect x="14" y="10" width="74" height="94" rx="10" fill="#fff" stroke={INK} strokeWidth="5" />
        <path d="M28 32h46M28 46h46M28 60h30" stroke={INK} strokeWidth="5" strokeLinecap="round" />
        <path d="M28 84c8-12 14 8 22-4 5-7 10 2 16-4" fill="none" stroke={MOSS} strokeWidth="5" strokeLinecap="round" />
        <circle cx="92" cy="86" r="22" fill={MOSS} stroke={INK} strokeWidth="5" />
        <path d="m83 86 7 8 13-16" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      </>
    )
  },
  // The human gate: nothing passes without the shield's tick.
  gates: {
    tint: CORAL,
    art: (
      <>
        <path
          d="M60 8l46 18v30c0 30-20 46-46 56-26-10-46-26-46-56V26z"
          fill={CORAL}
          stroke={INK}
          strokeWidth="5"
          strokeLinejoin="round"
        />
        <path d="m40 60 14 15 28-32" fill="none" stroke="#fff" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
      </>
    )
  }
};

/** The watermark layer for one feature card. Render first inside the card. */
export default function FeatureCardArt({ preview }: { preview: PreviewKey }) {
  const { tint, art } = CARD_ART[preview];
  return (
    <>
      {/* Corner wash — reads before the line art does, at thumbnail size. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-16 -right-16 h-56 w-56 rounded-full opacity-10 transition-opacity duration-300 ease-out group-hover:opacity-20"
        style={{ background: tint }}
      />
      <svg
        viewBox="0 0 120 120"
        aria-hidden
        focusable="false"
        className="pointer-events-none absolute -bottom-7 -right-6 h-36 w-36 opacity-[0.12] transition-[opacity,transform] duration-300 ease-out group-hover:scale-105 group-hover:opacity-[0.2]"
      >
        {art}
      </svg>
    </>
  );
}
