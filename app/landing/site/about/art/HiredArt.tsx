import type { CSSProperties } from "react";
import { useLocale, useTranslations } from "next-intl";
import { widestEm } from "../../land/headlineFit";
import type { DioProps } from "./dio";
import {
  BURST_ANGLES,
  HIRED_GRADIENTS,
  HIRED_ID,
  HIRED_SPARKS,
  SEAL,
  STAR_POINTS,
  WAX_PATH,
  hiredUrl,
} from "./hired-geom";

/*
 * Step 08 - HIRED (the prototype's about-art/s8-hired.js). A candidate card takes
 * a giant HIRED stamp, three close-out rows tick in, and a hand-off arrow carries
 * the card into an ATS box. The hero is a moss wax seal with ribbon tails and a
 * check-star, plus a key ring handed to a small box (day one belongs to the ATS).
 * All motion is CSS (../../css/about-s8-hired.css), started by `.dio.is-in`, so
 * the drawing has no behaviour of its own.
 */

/** The close-out checklist, in order: keys under aboutPage.art.hired.tasks. */
const ROWS = ["record", "ats", "role"] as const;

function Gradients() {
  return (
    <>
      {HIRED_GRADIENTS.map((g) => {
        const stops = g.stops.map(([offset, cls], i) => (
          <stop key={i} offset={offset} className={`hd-s-${cls}`} />
        ));
        return g.kind === "lin" ? (
          <linearGradient key={g.id} id={HIRED_ID + g.id} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}>
            {stops}
          </linearGradient>
        ) : (
          <radialGradient key={g.id} id={HIRED_ID + g.id} cx={g.cx} cy={g.cy} r={g.r}>
            {stops}
          </radialGradient>
        );
      })}
      <radialGradient id={`${HIRED_ID}sh`} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" className="hd-s-sh0" />
        <stop offset="0.6" className="hd-s-sh1" />
        <stop offset="1" className="hd-s-sh2" />
      </radialGradient>
    </>
  );
}

/* the hero: seal + ribbons + key ring handed to a small box, viewBox 190 x 180 */
function Hero() {
  const { cx, cy } = SEAL;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 190 180" aria-hidden="true" focusable="false">
      <defs>
        <Gradients />
      </defs>

      <ellipse cx="94" cy="174" rx="90" ry="7.4" fill={hiredUrl("sh")} />

      {/* ribbon tails, behind the seal */}
      <g className="hd-ribbons">
        <path d="M46 94L72 100L58 164L44 152L28 160Z" fill={hiredUrl("gr")} className="hd-ol" />
        <path d="M52 104L60 106L48 152" className="hd-line" strokeWidth="1.6" opacity=".3" />
        <path d="M50.4 101L57 103" className="hd-hl" strokeWidth="2.4" />
        <path d="M56 98L82 92L108 156L93 150L82 166Z" fill={hiredUrl("gr")} className="hd-ol" />
        <path d="M68 104L74 102L92 146" className="hd-line" strokeWidth="1.6" opacity=".3" />
        <path d="M60 96.6L76 93.4" className="hd-hl" strokeWidth="2.4" />
      </g>

      {/* the small box the key is handed to */}
      <g className="hd-box">
        <path d="M116 132H180V172Q180 176 176 176H120Q116 176 116 172Z" fill={hiredUrl("gf")} className="hd-ol" />
        <path d="M124 118H172L181 132H115Z" fill={hiredUrl("gt")} className="hd-ol" />
        <rect x="128" y="122" width="40" height="6.6" rx="3.3" className="hd-slot" />
        <path d="M116 141H180" className="hd-line" strokeWidth="1.8" opacity=".4" />
        <rect x="131" y="147" width="34" height="17" rx="3.4" fill={hiredUrl("gp")} className="hd-ol" strokeWidth="2.6" />
        <path d="M137 155.5H159" className="hd-line" strokeWidth="2" opacity=".28" />
        <circle cx="124" cy="152" r="2.6" className="hd-brass hd-ol" strokeWidth="1.8" />
        <circle cx="172" cy="152" r="2.6" className="hd-brass hd-ol" strokeWidth="1.8" />
        <path d="M120.5 146V168" className="hd-hl" strokeWidth="2.4" />
        <path d="M119 127.6L125 121.6" className="hd-hl" strokeWidth="2.4" />
      </g>

      {/* the hand-off trail from the seal to the key */}
      <path className="hd-trail" d="M106 34Q142 20 146 60" />
      <path className="hd-trail-head" d="M137.6 52L146.4 64.4L153 52.4" />

      {/* key ring with a key, dropping toward the slot */}
      <g className="hd-key">
        <g className="hd-key-in">
          <circle cx="150" cy="86" r="13.4" className="hd-ring-o" />
          <circle cx="150" cy="86" r="13.4" className="hd-ring-b" />
          <path d="M143.4 76.4A13.4 13.4 0 0 1 154 73" className="hd-hl" strokeWidth="2.4" />
          <g transform="rotate(-14 150 99)">
            <path
              d="M147.6 108H152.4V132.6L150 135.2L147.6 132.6Z"
              fill={hiredUrl("gk")}
              className="hd-ol"
              strokeWidth="2.8"
            />
            <path
              d="M152.4 119H158V123H152.4M152.4 126.4H156.6V130.4H152.4"
              fill={hiredUrl("gk")}
              className="hd-ol"
              strokeWidth="2.4"
            />
            <circle cx="150" cy="103" r="8.6" fill={hiredUrl("gk")} className="hd-ol" strokeWidth="3" />
            <circle cx="150" cy="103" r="3.2" className="hd-slot" />
            <path d="M143.6 99.4Q145.6 96 149.4 95.6" className="hd-hl" strokeWidth="2.2" />
          </g>
        </g>
      </g>

      {/* the seal: scalloped wax, embossed ring, check-star */}
      <g className="hd-seal-wrap">
        <g className="hd-seal">
          <path d={WAX_PATH} fill={hiredUrl("gw")} className="hd-ol" strokeWidth="3.8" />
          <circle cx={cx} cy={cy} r="36.4" fill={hiredUrl("gi")} className="hd-line" strokeWidth="2.4" opacity=".95" />
          <circle cx={cx - 0.9} cy={cy - 1} r="33.6" className="hd-emb-hi" strokeWidth="2.2" />
          <circle cx={cx} cy={cy} r="33.6" className="hd-emb-lo" strokeWidth="1.6" />
          <path d="M22 46Q30 26 52 20" className="hd-hl" strokeWidth="3.6" />
          <polygon points={STAR_POINTS} className="hd-star" strokeWidth="2.6" />
          <path d="M52.4 67.6L61.6 76.6L79 55.6" className="hd-check-o" />
          <path d="M52.4 67.6L61.6 76.6L79 55.6" className="hd-check" />
          <circle cx="46" cy="41" r="1.9" className="hd-hlf" opacity=".7" />
        </g>
      </g>

      {HIRED_SPARKS.map(([n, cls, d]) => (
        <g key={n} className={`hd-spk hd-spk${n}`}>
          <path className={cls} d={d} />
        </g>
      ))}
    </svg>
  );
}

/* ---------- small glyphs ---------- */

/* an initials tile drawn as shapes (a J and an N), so the scene carries no name and no extra text */
function TileGlyph() {
  return (
    <svg className="hd-tile" viewBox="0 0 50 50" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${HIRED_ID}gtile`} x1={0} y1={0} x2={1} y2={1}>
          <stop offset={0} className="hd-s-tile-hi" />
          <stop offset={1} className="hd-s-tile" />
        </linearGradient>
      </defs>
      <rect x="2.4" y="2.4" width="45.2" height="45.2" rx="11" fill={hiredUrl("gtile")} className="hd-ol" strokeWidth="3" />
      <path d="M5.4 12.4Q8 6 16 5.2" className="hd-hl" strokeWidth="2.4" />
      <path d="M15.4 13H26M21 13V28.6Q21 34 15.6 34Q12 34 10 30.6" className="hd-mono" />
      <path d="M30 34V13L42 34V13" className="hd-mono" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg className="hd-ck" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4.4 12.8l5 5L19.8 6.6" />
    </svg>
  );
}

function ArrowGlyph() {
  return (
    <svg className="hd-arrow" viewBox="0 0 84 40" aria-hidden="true" focusable="false">
      <path className="hd-arrow-o" pathLength={100} d="M4 30C20 -2 58 -4 74 26" />
      <path className="hd-arrow-o hd-arrow-oh" pathLength={100} d="M62 22L75 28L76.6 13.6" />
      <path className="hd-arrow-b" pathLength={100} d="M4 30C20 -2 58 -4 74 26" />
      <path className="hd-arrow-b hd-arrow-bh" pathLength={100} d="M62 22L75 28L76.6 13.6" />
    </svg>
  );
}

export default function HiredArt({ side, vars }: DioProps) {
  const t = useTranslations("aboutPage.art.hired");
  const ts = useTranslations("siteAbout.art.hired");
  const locale = useLocale();
  // The stamp is a fixed-width rubber block: a longer word (EINGESTELLT, PŘIJAT/A) is set smaller to fit it (the CSS
  // divides the block's width by this em width: +.07em tracking and the matching indent).
  const seal = t("seal").toLocaleUpperCase(locale);
  const sealEm = widestEm([seal], 0.07) + 0.07;
  return (
    <div className="dio dio-hired" data-side={side} style={vars}>
      <div className="bz">
        <div className="gl">
          <svg className="hd-defs" width="0" height="0" aria-hidden="true" focusable="false">
            <defs>
              <filter
                id={`${HIRED_ID}ink`}
                x="-4%"
                y="-8%"
                width="108%"
                height="116%"
                colorInterpolationFilters="sRGB"
              >
                <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="11" result="warp" />
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="warp"
                  scale="3"
                  xChannelSelector="R"
                  yChannelSelector="G"
                  result="bent"
                />
                <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="1" seed="5" result="grit" />
                <feColorMatrix
                  in="grit"
                  type="matrix"
                  values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  4.4 0 0 0 -1.12"
                  result="mask"
                />
                <feComposite in="bent" in2="mask" operator="in" />
              </filter>
            </defs>
          </svg>
          {/* the candidate card that receives the stamp */}
          <div className="hd-card paper">
            <div className="hd-who">
              <TileGlyph />
              <div className="hd-bars" aria-hidden="true">
                <i />
                <i />
              </div>
            </div>
            <div className="hd-rule" aria-hidden="true" />
            <div className="hd-ring" aria-hidden="true" />
            <div className="hd-burst" aria-hidden="true">
              {BURST_ANGLES.map((a) => (
                <i key={a} style={{ "--a": a } as CSSProperties} />
              ))}
            </div>
            <div className="hd-stamp">
              {/* today's copy, set in stamp capitals (the page it replaces uppercased it in CSS) */}
              <span className="hd-stamp-in" style={{ "--seal-em": sealEm } as CSSProperties}>
                {seal}
              </span>
            </div>
          </div>
          {/* the hand-off: arrow + a box that takes the card */}
          <div className="hd-hand">
            <ArrowGlyph />
            <div className="hd-ats">
              <div className="hd-ats-back" aria-hidden="true" />
              <div className="hd-mini" aria-hidden="true">
                <i className="hd-mini-tile" />
                <i className="hd-mini-bar" />
                <i className="hd-mini-bar hd-mini-bar2" />
              </div>
              <div className="hd-ats-front">
                <span className="hd-plate sil">{ts("ats")}</span>
              </div>
              <span className="hd-hris sil">{ts("hris")}</span>
            </div>
          </div>
          {/* the close-out checklist */}
          <div className="hd-panel paper">
            <p className="hd-cap">{t("handoff")}</p>
            <ul className="hd-list">
              {ROWS.map((row, i) => (
                <li key={row} className={`hd-row hd-row${i + 1}`}>
                  <span className="hd-tick" aria-hidden="true">
                    <CheckGlyph />
                  </span>
                  <span className="hd-row-t">{t(`tasks.${row}`)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <div className="dio-hero dio-hero--a" aria-hidden="true">
        <Hero />
      </div>
    </div>
  );
}
