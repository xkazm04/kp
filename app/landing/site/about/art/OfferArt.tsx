import { useLocale, useTranslations } from "next-intl";
import type { DioProps } from "./dio";
import { OFFER_DROPS, OFFER_GRADIENTS, OFFER_ID, OFFER_SPARKS, offerUrl } from "./offer-geom";

/*
 * Step 07 - OFFER (the prototype's about-art/s7-offer.js). A cream "Offer letter"
 * whose lines write themselves, a slammed HUMAN-APPROVED rubber-stamp impression
 * and an "accepted" chip; the hero is a wooden rubber stamp over an oxblood ink pad.
 * All motion is CSS (../../css/about-s7-offer.css), started by `.dio.is-in`, so the
 * drawing has no behaviour of its own.
 */

/** Illustrative figure on the letter (a number, not copy). */
const FIGURE = { salary: "150k" } as const;

function Gradients() {
  return (
    <>
      {OFFER_GRADIENTS.map((g) => {
        const stops = g.stops.map(([offset, cls], i) => (
          <stop key={i} offset={offset} className={`of-s-${cls}`} />
        ));
        return g.kind === "lin" ? (
          <linearGradient key={g.id} id={OFFER_ID + g.id} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}>
            {stops}
          </linearGradient>
        ) : (
          <radialGradient key={g.id} id={OFFER_ID + g.id} cx={g.cx} cy={g.cy} r={g.r}>
            {stops}
          </radialGradient>
        );
      })}
      <radialGradient id={`${OFFER_ID}sh`} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" className="of-s-sh0" />
        <stop offset="0.6" className="of-s-sh1" />
        <stop offset="1" className="of-s-sh2" />
      </radialGradient>
    </>
  );
}

/* the hero: wooden stamp (tilted, mid-press) + oxblood ink pad, viewBox 130 x 176 */
function Hero() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 130 176" aria-hidden="true" focusable="false">
      <defs>
        <Gradients />
      </defs>

      {/* contact shadow + the ink pad (a shallow round tin seen a little from above) */}
      <ellipse cx="62" cy="167" rx="66" ry="8.6" fill={offerUrl("sh")} />
      <path d="M10 146V158A52 16 0 0 0 114 158V146Z" fill={offerUrl("gc")} className="of-ol" />
      <path d="M16 151V157" className="of-hl" strokeWidth="3" />
      <path d="M14 154.4Q62 171.6 110 154.4" className="of-line" strokeWidth="1.6" opacity=".22" />
      <ellipse cx="62" cy="146" rx="52" ry="16" fill={offerUrl("gt")} className="of-ol" />
      <ellipse cx="62" cy="147.4" rx="43.5" ry="12.4" fill={offerUrl("gf")} />
      <path d="M19 146.2A43.5 12.4 0 0 1 105 146.2" className="of-line" strokeWidth="2.2" opacity=".42" />
      <ellipse cx="62" cy="147.4" rx="43.5" ry="12.4" className="of-line" strokeWidth="1.4" opacity=".55" />
      <path d="M17 142.6Q24 132.6 44 130.8" className="of-hl" strokeWidth="3" />
      <ellipse cx="44" cy="144.6" rx="9" ry="2.3" className="of-hlf" opacity=".26" transform="rotate(-8 44 144.6)" />
      <ellipse cx="62" cy="149.4" rx="26" ry="4.2" className="of-shadowfill" opacity=".4" />

      {/* the stamp: everything in .of-tool tilts (css) about the die's outer bottom corner */}
      <g className="of-tool">
        {/* wooden stock */}
        <path
          d="M32 118Q32 113 37 113H87Q92 113 92 118V131Q92 136 87 136H37Q32 136 32 131Z"
          fill={offerUrl("gw")}
          className="of-ol"
        />
        <path
          d="M38.5 121.4Q60 117.6 86 121.2M38 127Q62 123.6 86.6 127.4M40.5 132.2Q60 130.2 84 132"
          className="of-grain"
        />
        <path d="M36.6 116.6H60" className="of-hl" strokeWidth="2.6" />
        {/* rubber die + a red kiss of ink on its underside */}
        <path d="M37 136H87V143Q87 147 83 147H41Q37 147 37 143Z" fill={offerUrl("gr")} className="of-ol" />
        <path d="M40.4 139.2H58" className="of-hlsteel" strokeWidth="1.8" />
        <path d="M41.5 145.4H82.5" className="of-inkkiss" strokeWidth="3.2" />
        {/* turned neck, knob, brass ferrule */}
        <path d="M55 76Q56.6 88 53 99H71Q67.4 88 69 76Z" fill={offerUrl("gw")} className="of-ol" />
        <path d="M58.4 80Q59.4 89 57.4 96" className="of-hl" strokeWidth="2" />
        <path
          d="M62 24C49 24 42 34 42 47C42 60 51 71 62 71C73 71 82 60 82 47C82 34 75 24 62 24Z"
          fill={offerUrl("gk")}
          className="of-ol"
        />
        <path d="M51.6 62.6Q62 68 72.6 62.4" className="of-grain" />
        <path d="M47 51Q62 56.6 77.4 51" className="of-grain" />
        <path d="M48.6 42.6Q50.4 32.6 58.6 29" className="of-hl" strokeWidth="3.6" />
        <circle cx="66.6" cy="33.4" r="1.7" className="of-hlf" opacity=".55" />
        <path
          d="M44.5 99.5Q44.5 97 47 97H77Q79.5 97 79.5 99.5V111.5Q79.5 114 77 114H47Q44.5 114 44.5 111.5Z"
          fill={offerUrl("gb")}
          className="of-ol"
        />
        <path d="M46.4 101.8H77.6M46.4 109.2H77.6" className="of-line" strokeWidth="1.5" opacity=".42" />
        <path d="M50.4 100.4V110.8" className="of-hl" strokeWidth="2.4" />
      </g>

      {/* ink dots + sparkles around it */}
      {OFFER_DROPS.map((d) => (
        <g key={d.n} className={`of-dot of-dot${d.n}`}>
          <circle cx={d.x} cy={d.y} r={d.r} fill={offerUrl("gd")} />
          <circle cx={d.hx} cy={d.hy} r={d.hr} className="of-hlf" />
        </g>
      ))}
      {OFFER_SPARKS.map(([n, cls, d]) => (
        <g key={n} className={`of-spk of-spk${n}`}>
          <path className={cls} d={d} />
        </g>
      ))}
    </svg>
  );
}

/* ---------- small glyphs ---------- */
function DocGlyph() {
  return (
    <svg className="of-doc" viewBox="0 0 22 26" aria-hidden="true" focusable="false">
      <path d="M3 3.4Q3 1.4 5 1.4H14L20 7.4V22.6Q20 24.6 18 24.6H5Q3 24.6 3 22.6Z" className="of-docbody" />
      <path d="M14 1.4V7.4H20" className="of-docfold" />
      <path d="M6.6 12.6H16.4M6.6 16.4H16.4M6.6 20.2H12.4" className="of-docln" />
    </svg>
  );
}

function PenGlyph() {
  return (
    <svg className="of-gl" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M3 17l1.2-4.4L14.4 2.4l3.2 3.2L7.4 15.8z" />
      <path d="M12 4.8l3.2 3.2" />
    </svg>
  );
}

function LinkGlyph() {
  return (
    <svg className="of-gl" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg className="of-ck" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4.4 12.8l5 5L19.8 6.6" />
    </svg>
  );
}

function SquigGlyph() {
  return (
    <svg className="of-squig" viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M3 7.6C16 3.2 26 10.4 40 6.2S66 3.4 80 7.4 106 8.4 117 4.4" />
    </svg>
  );
}

export default function OfferArt({ side, vars }: DioProps) {
  const t = useTranslations("aboutPage.art.offer");
  const ts = useTranslations("siteAbout.art.offer");
  const locale = useLocale();
  return (
    <div className="dio dio-offer" data-side={side} style={vars}>
      <div className="bz">
        <div className="gl">
          {/* the ink filter lives inside the glass so the scene stays one self-contained tree */}
          <svg className="of-defs" width="0" height="0" aria-hidden="true" focusable="false">
            <defs>
              <filter
                id={`${OFFER_ID}ink`}
                x="-4%"
                y="-8%"
                width="108%"
                height="116%"
                colorInterpolationFilters="sRGB"
              >
                <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="7" result="warp" />
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="warp"
                  scale="2.6"
                  xChannelSelector="R"
                  yChannelSelector="G"
                  result="bent"
                />
                <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="1" seed="3" result="grit" />
                <feColorMatrix
                  in="grit"
                  type="matrix"
                  values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  4.4 0 0 0 -1.15"
                  result="mask"
                />
                <feComposite in="bent" in2="mask" operator="in" />
              </filter>
            </defs>
          </svg>
          {/* silkscreen strip: draft ... secure link */}
          <div className="of-top">
            <span className="of-tag of-tag-a sil">
              <i className="of-led" aria-hidden="true" />
              <PenGlyph />
              {ts("draft")}
            </span>
            <span className="of-cable" aria-hidden="true">
              <i className="of-comet" />
            </span>
            <span className="of-tag of-tag-b sil">
              <LinkGlyph />
              {ts("secureLink")}
              <i className="of-led" aria-hidden="true" />
            </span>
          </div>
          <div className="of-sheet2" aria-hidden="true" />
          <div className="of-paper paper">
            <div className="of-head">
              <DocGlyph />
              <h4 className="of-title">{t("letter")}</h4>
              <span className="of-acc">
                <CheckGlyph />
                {t("accepted")}
              </span>
            </div>
            <div className="of-figure">
              <b className="of-num">{FIGURE.salary}</b>
              <span className="of-cur">{t("currency")}</span>
              <SquigGlyph />
            </div>
            <p className="of-formula">{ts.rich("formula", { em: (chunks) => <em>{chunks}</em> })}</p>
            <div className="of-lines" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="of-stamp">
              {/* today's copy, set in stamp capitals (the page it replaces uppercased it in CSS) */}
              <span className="of-stamp-in">{t("humanApproved").toLocaleUpperCase(locale)}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="dio-hero dio-hero--a" aria-hidden="true">
        <Hero />
      </div>
    </div>
  );
}
