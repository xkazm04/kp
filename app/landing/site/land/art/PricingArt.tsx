/*
 * The drawn emblems of the pricing cards (a terminal with a padlock for
 * self-hosting, a sprout, a paper plane taking off, a rising bar chart) and the
 * enterprise band's three buildings, the third one dashed (planned). Decorative;
 * the card titles carry the meaning. Prototype index.html, verbatim.
 */

const INK = "#17202a";
const CREAM = "#fdf8ee";
const AMBER = "#caa54c";
const LIME = "#dce7d0";
const MOSS = "#526b4f";
const STEEL = "#42606f";
const CORAL = "#d65a4a";

export type EmblemKey = "selfhost" | "free" | "starter" | "growth";

export function PlanEmblem({ tier }: { tier: EmblemKey }) {
  return (
    <svg className="emb" viewBox="0 0 96 96" aria-hidden="true" focusable="false">
      {tier === "selfhost" ? (
        <>
          <rect x="10" y="14" width="76" height="52" rx="9" fill={LIME} stroke={CREAM} strokeWidth="4" />
          <rect x="18" y="22" width="60" height="36" rx="4" fill={INK} />
          <path d="M28 34l9 7-9 7" fill="none" stroke={AMBER} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M44 48h16" stroke={LIME} strokeWidth="4" strokeLinecap="round" />
          <path d="M36 76h24M48 66v10" stroke={CREAM} strokeWidth="5" strokeLinecap="round" />
          <g transform="translate(70 66)">
            <rect x="-11" y="-4" width="22" height="18" rx="4" fill={CORAL} stroke={CREAM} strokeWidth="3.5" />
            <path d="M-6 -4v-5a6 6 0 0 1 12 0v5" fill="none" stroke={CREAM} strokeWidth="3.5" />
          </g>
        </>
      ) : tier === "free" ? (
        <>
          <path d="M30 62h36l-5 24H35z" fill={AMBER} stroke={INK} strokeWidth="4" strokeLinejoin="round" />
          <path d="M48 62V36" stroke={INK} strokeWidth="4" strokeLinecap="round" />
          <path d="M48 44C48 28 34 22 22 24c0 14 12 22 26 20z" fill={MOSS} stroke={INK} strokeWidth="4" strokeLinejoin="round" />
          <path d="M48 36C48 22 60 14 74 16c1 14-10 22-26 20z" fill="#8fb07e" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
        </>
      ) : tier === "starter" ? (
        <>
          <path d="M22 84h34" stroke={INK} strokeWidth="6" strokeLinecap="round" />
          <path d="M39 84V58L58 30" fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          <path
            d="M50 26l22 14 10-16z"
            fill={AMBER}
            stroke={INK}
            strokeWidth="4"
            strokeLinejoin="round"
            transform="rotate(-8 62 30)"
          />
          <path d="M60 46l12 18M56 48l-6 20M68 44l18 10" stroke="#f5dc93" strokeWidth="3.5" strokeLinecap="round" opacity=".9" />
          <circle cx="39" cy="58" r="5" fill={CORAL} stroke={INK} strokeWidth="3" />
        </>
      ) : (
        <>
          <rect x="12" y="56" width="16" height="30" rx="4" fill={STEEL} stroke={INK} strokeWidth="4" />
          <rect x="34" y="40" width="16" height="46" rx="4" fill={MOSS} stroke={INK} strokeWidth="4" />
          <rect x="56" y="22" width="16" height="64" rx="4" fill={CORAL} stroke={INK} strokeWidth="4" />
          <path
            d="M14 40L40 24 58 10M58 10h14M58 10v14"
            fill="none"
            stroke={INK}
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  );
}

export function EnterpriseArt() {
  return (
    <svg className="ent-art" viewBox="0 0 220 120" aria-hidden="true" focusable="false">
      <g transform="translate(14 22)">
        <rect x="0" y="34" width="46" height="56" rx="7" fill={STEEL} stroke={INK} strokeWidth="4" />
        <path d="M11 50h8M27 50h8M11 64h8M27 64h8" stroke={LIME} strokeWidth="4" strokeLinecap="round" />
      </g>
      <g transform="translate(66 6)">
        <rect x="0" y="34" width="52" height="72" rx="7" fill={MOSS} stroke={INK} strokeWidth="4" />
        <path d="M12 52h8M32 52h8M12 68h8M32 68h8M12 84h8M32 84h8" stroke={LIME} strokeWidth="4" strokeLinecap="round" />
        <rect x="0" y="20" width="52" height="16" rx="5" fill={AMBER} stroke={INK} strokeWidth="4" />
      </g>
      <g transform="translate(138 30)">
        <rect x="0" y="34" width="44" height="52" rx="7" fill={CREAM} stroke={INK} strokeWidth="4" strokeDasharray="7 5" />
        <path
          d="M12 62l8 8 14-16"
          fill="none"
          stroke="#a06a00"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="3 6"
        />
      </g>
      <path d="M0 112h220" stroke={INK} strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
