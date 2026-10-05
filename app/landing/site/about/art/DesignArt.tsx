"use client";

import { useRef, useState, type CSSProperties, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { reducedMotionNow, useDioEnter, type DioProps, type Side } from "./dio";
import { INK, ROWS, plateGeom, pencilGeom, ruleTicksD, sparkD, type Lit, type Stop } from "./design-geom";

/*
 * STEP 01 - DESIGN. "Describe the role. Get the rubric." Port of the prototype's
 * about-art/s1-design.js: a brief scrap is pressed through a slotted plate and
 * leaves as three cables that plug into the JD card (tile, title, company,
 * must-have chips, salary band); a rubric sheet slides out from behind it. Hero:
 * a clay pencil leaning across the bezel corner and a small brass rule it has
 * just ruled a line along. Every drawing is aria-hidden; styles live in
 * ../../css/about-s1-design.css.
 */

/** One drawing per page, so the SVG ids carry a fixed prefix. */
const P = "dio-design-";
const url = (id: string) => `url(#${P}${id})`;

/* Tech tags and illustrative figures: data, not copy. */
const CHIPS = [
  { tag: "Java", color: "#d65a4a" },
  { tag: "Spring", color: "#caa54c" },
  { tag: "SQL", color: "#7fb3a8" },
  { tag: "REST", color: "#6d93a5" },
] as const;
const RUBRIC_FILLS = [92, 80, 68, 56] as const;
const GHOST_CHIPS = [2.8, 3.8, 2.4] as const;
/** The salary band in thousands of CZK; the count-up starts from `from*`. */
const BAND = { low: 120, high: 165, fromLow: 96, fromHigh: 128, thousands: "k", dash: "–" } as const;
const COUNT_DELAY_MS = 2450;
const COUNT_MS = 820;

type Vars = CSSProperties & Record<`--${string}`, string | number>;

function Spark({ x, y, r, cls }: { x: number; y: number; r: number; cls: string }) {
  return <path className={cls} d={sparkD(x, y, r)} />;
}

/** Gradient whose FIRST stop sits on the lit edge. */
function VGrad({ id, lit, stops }: { id: string; lit: Lit; stops: readonly Stop[] }) {
  return (
    <linearGradient id={P + id} x1="0" y1={lit === "top" ? 0 : 1} x2="0" y2={lit === "top" ? 1 : 0}>
      {stops.map(([o, c]) => (
        <stop key={o} offset={o} stopColor={c} />
      ))}
    </linearGradient>
  );
}

/* ---------- left column: brief scrap -> slotted press plate -> three straight cables.
   The three layers share one frame (viewBox 0 0 104 98) so their paths line up. ---------- */
function ScrapLayer() {
  return (
    <svg viewBox="0 0 104 98" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={P + "sg"} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fffaf0" />
          <stop offset="1" stopColor="#e6dac2" />
        </linearGradient>
        <radialGradient id={P + "ss"} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#03090c" stopOpacity=".55" />
          <stop offset=".6" stopColor="#03090c" stopOpacity=".2" />
          <stop offset="1" stopColor="#03090c" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g transform="rotate(-4 30 48)">
        <ellipse cx="31" cy="87" rx="30" ry="4.4" fill={url("ss")} />
        <path d="M6 11H43L55 23V80Q55 84 51 84H10Q6 84 6 80Z" fill={url("sg")} stroke={INK} strokeWidth="2.9" strokeLinejoin="round" />
        <path d="M43 11V20Q43 23 46 23H55Z" fill="#d9caab" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M10 15.6H34" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" opacity=".9" />
        <g className="dd-sq" fill="none" stroke={INK} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 35q3.3-7.6 6.6-.3t6.6.5 6.6-.6 6.4.4 5.6-.2" />
          <path d="M13 50q2.9-6.2 5.8 0t5.8-.2 5.8.4 5.8-.4 5.8.3 5.2-.2" />
          <path d="M13 65q3.7-7.2 7.4 0t7.4-.4 7.4.5 6.2-.3" />
        </g>
        <g transform="rotate(-7 30 9)">
          <rect x="12" y="1.5" width="36" height="12" rx="1.9" fill="#7fb3a8" fillOpacity=".85" stroke={INK} strokeOpacity=".6" strokeWidth="1.6" />
          <path d="M15.5 5.2H43" stroke="#fff" strokeOpacity=".65" strokeWidth="1.4" strokeLinecap="round" />
        </g>
      </g>
    </svg>
  );
}

function CablesLayer() {
  return (
    <svg viewBox="0 0 104 98" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={P + "cb"} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#dff3ec" />
          <stop offset=".5" stopColor="#a5d3c8" />
          <stop offset="1" stopColor="#6fa89b" />
        </linearGradient>
        <linearGradient id={P + "pl"} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f8e5a4" />
          <stop offset=".55" stopColor="#e6c46a" />
          <stop offset="1" stopColor="#b98f3a" />
        </linearGradient>
      </defs>
      {ROWS.map((y, i) => (
        <g key={y} className={`dd-cab dd-cab${i + 1}`}>
          <path className="dd-cwo" pathLength={100} d={`M56 ${y}H99`} stroke={INK} strokeWidth="6.4" strokeLinecap="round" fill="none" />
          <path className="dd-cw" pathLength={100} d={`M56 ${y}H99`} stroke={url("cb")} strokeWidth="3.6" strokeLinecap="round" fill="none" />
          <path d={`M58 ${y - 1}H97`} stroke="#fff" strokeOpacity=".75" strokeWidth="1" strokeLinecap="round" fill="none" />
          <g className="dd-plug">
            <rect x="97.4" y={y - 5} width="6.4" height="10" rx="2.4" fill={url("pl")} stroke={INK} strokeWidth="2.2" />
            <path d={`M99.2 ${y - 2.6}V${y + 2.6}`} stroke="#fff" strokeOpacity=".7" strokeWidth="1.2" strokeLinecap="round" />
          </g>
        </g>
      ))}
    </svg>
  );
}

function PlateLayer() {
  const { outer, slots, rims } = plateGeom();
  return (
    <svg viewBox="0 0 104 98" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={P + "pg"} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c9ece3" />
          <stop offset=".45" stopColor="#8dc3b6" />
          <stop offset="1" stopColor="#4f8b7f" />
        </linearGradient>
      </defs>
      <path fillRule="evenodd" d={outer + slots} fill={url("pg")} />
      <path d={outer} fill="none" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      <path d={slots} fill="none" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      {rims.map((d) => (
        <path key={d} d={d} stroke="#fff" strokeOpacity=".55" strokeWidth="1.3" strokeLinecap="round" transform="translate(0 1.6)" />
      ))}
      <path d="M49 12Q49.5 8.6 53 8.6H62" fill="none" stroke="#fff" strokeOpacity=".8" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M47.6 20V44" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M50 85.6H70" fill="none" stroke={INK} strokeOpacity=".28" strokeWidth="2" strokeLinecap="round" />
      <circle cx="60" cy="14.2" r="2.1" fill="#e6c46a" stroke={INK} strokeWidth="1.3" />
      <circle cx="60" cy="81.8" r="2.1" fill="#e6c46a" stroke={INK} strokeWidth="1.3" />
      <g className="dd-sp dd-sp4">
        <Spark x={78} y={6} r={4.6} cls="dd-spf" />
      </g>
    </svg>
  );
}

/* ---------- the hero: a chunky clay pencil leaning across the bezel corner ---------- */
function PencilSvg({ side }: { side: Side }) {
  const g = pencilGeom(side);
  const lit = g.lit;
  return (
    <svg viewBox="0 0 160 230" aria-hidden="true" focusable="false">
      <defs>
        <VGrad id="er" lit={lit} stops={[[0, "#f79b86"], [0.4, "#e2705d"], [1, "#a13a2c"]]} />
        <VGrad id="fe" lit={lit} stops={[[0, "#fbeab0"], [0.32, "#e9c96e"], [0.7, "#c9a24a"], [1, "#86662a"]]} />
        <VGrad id="wd" lit={lit} stops={[[0, "#fbf1d8"], [0.5, "#e9d9b1"], [1, "#c2aa7c"]]} />
        <linearGradient id={P + "ld"} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8a99a6" />
          <stop offset="1" stopColor="#2a3947" />
        </linearGradient>
        <radialGradient id={P + "sh"} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#03090c" stopOpacity=".5" />
          <stop offset=".6" stopColor="#03090c" stopOpacity=".18" />
          <stop offset="1" stopColor="#03090c" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g transform={side === "r" ? "translate(160 0) scale(-1 1)" : undefined}>
        <ellipse cx="109" cy="217" rx="26" ry="4.4" fill={url("sh")} />
        {/* eraser end at (23,25), 65 degrees down and toward the tip */}
        <g className="dd-pen" transform="translate(23 25) rotate(65)">
          <path d={g.eraser.outline} fill={url("er")} stroke={INK} strokeWidth="3.6" strokeLinejoin="round" />
          <path d={g.eraser.glint} fill="none" stroke="#fff" strokeOpacity=".75" strokeWidth="2.5" strokeLinecap="round" />
          <path d={g.eraser.band} stroke="#fff" strokeOpacity=".55" strokeWidth="2.5" strokeLinecap="round" />
          <path d={g.ferrule.outline} fill={url("fe")} stroke={INK} strokeWidth="3.6" strokeLinejoin="round" />
          <path d={g.ferrule.grooves} stroke="#6b5220" strokeOpacity=".62" strokeWidth="1.8" />
          <path d={g.ferrule.glints} stroke="#fff" strokeOpacity=".5" strokeWidth="1.2" />
          <rect x="27.6" y={g.yLit - 1.5} width="22.8" height="3" rx="1.5" fill="#fff" opacity=".5" />
          <path d={g.body.outline} fill={g.bandBase} />
          <path d={g.body.top} fill={g.top} />
          <path d={g.body.bottom} fill={g.bot} />
          <path d={g.body.facets} stroke={INK} strokeOpacity=".3" strokeWidth="1.4" />
          <path d={g.body.stripes} stroke="#fdf8ee" strokeOpacity=".8" strokeWidth="2.6" />
          <rect x="80" y={g.yLit - 1.7} width="68" height="3.4" rx="1.7" fill="#fff" opacity=".72" />
          <path d={g.body.outline} fill="none" stroke={INK} strokeWidth="3.6" strokeLinejoin="round" />
          <path d={g.wood} fill={url("wd")} />
          <path d="M170 -3.6L192 -1.8M170 3.6L192 1.8" stroke={INK} strokeOpacity=".32" strokeWidth="1.4" strokeLinecap="round" />
          <path d={g.wood} fill="none" stroke={INK} strokeWidth="3.4" strokeLinejoin="round" />
          <path d="M192 -5.4L206 -1.4Q209.4 0 206 1.4L192 5.4Z" fill={url("ld")} stroke={INK} strokeWidth="3.2" strokeLinejoin="round" />
          <path d={g.leadGlint} stroke="#fff" strokeOpacity=".6" strokeWidth="1.4" strokeLinecap="round" />
        </g>
        <g className="dd-sp dd-sp1">
          <Spark x={20} y={25} r={9} cls="dd-spf" />
        </g>
        <g className="dd-sp dd-sp2">
          <Spark x={60} y={7} r={5.4} cls="dd-spf2" />
        </g>
      </g>
    </svg>
  );
}

/* ---------- hero B: a small brass rule under the bezel, the fresh ruled line, curled shavings ---------- */
function Curl({ x, y, s, rot }: { x: number; y: number; s: number; rot: number }) {
  return (
    <g className="dd-curl" transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
      <path d="M0 0C2.6-9 16-11 18.6-2.4 20 4.6 10.6 7.4 6.6 3 4-.2 9-3 12-.8" fill="#f8eed3" stroke={INK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3-3.6C6-8 12.6-8.6 15.6-4.6" fill="none" stroke="#7fb3a8" strokeWidth="2.2" strokeLinecap="round" />
    </g>
  );
}

function RuleSvg({ side }: { side: Side }) {
  return (
    <svg viewBox="0 0 240 40" aria-hidden="true" focusable="false">
      <defs>
        <VGrad id="rb" lit="top" stops={[[0, "#f8e5a4"], [0.4, "#e6c46a"], [1, "#b98f3a"]]} />
      </defs>
      <g transform={side === "r" ? "translate(240 0) scale(-1 1)" : undefined}>
        <rect x="30" y="26" width="190" height="13.6" rx="3.2" fill={url("rb")} stroke={INK} strokeWidth="2.7" />
        <path d="M34 28.1H214" stroke="#fff" strokeOpacity=".7" strokeWidth="1.5" strokeLinecap="round" />
        <path d={ruleTicksD()} stroke={INK} strokeOpacity=".85" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="210" cy="34.4" r="2.6" fill="#5b4315" stroke={INK} strokeWidth="1.2" />
        <path className="dd-line-glow" pathLength={100} d="M141.3 22.6H107.3" fill="none" stroke="#e8f6f1" strokeOpacity=".3" strokeWidth="6" strokeLinecap="round" />
        <path className="dd-line" pathLength={100} d="M141.3 22.6H107.3" fill="none" stroke="#eef5f3" strokeWidth="3" strokeLinecap="round" />
        <Curl x={50} y={25.6} s={1.05} rot={-6} />
        <Curl x={79} y={25.8} s={0.72} rot={10} />
        <circle cx="94" cy="23.6" r="1.1" fill="#dfe8ec" opacity=".85" />
        <circle cx="89" cy="21.6" r=".9" fill="#dfe8ec" opacity=".7" />
        <circle cx="99" cy="21" r=".8" fill="#dfe8ec" opacity=".6" />
        <g className="dd-sp dd-sp3">
          <Spark x={160} y={12} r={6} cls="dd-spf" />
        </g>
      </g>
    </svg>
  );
}

/**
 * The salary figures count up each time the scene (re)enters. The initial state
 * is the final figures, so the server-rendered markup already holds them.
 */
function useBandCountUp(ref: RefObject<HTMLDivElement | null>) {
  const [nums, setNums] = useState<{ low: number; high: number }>({ low: BAND.low, high: BAND.high });
  useDioEnter(ref, () => {
    if (reducedMotionNow()) {
      setNums({ low: BAND.low, high: BAND.high });
      return;
    }
    let raf = 0;
    setNums({ low: BAND.fromLow, high: BAND.fromHigh });
    const timer = window.setTimeout(() => {
      let t0 = 0;
      const step = (ts: number) => {
        if (!t0) t0 = ts;
        const k = Math.min(1, (ts - t0) / COUNT_MS);
        const e = 1 - Math.pow(1 - k, 3);
        if (k < 1) {
          setNums({
            low: Math.round(BAND.fromLow + (BAND.low - BAND.fromLow) * e),
            high: Math.round(BAND.fromHigh + (BAND.high - BAND.fromHigh) * e),
          });
          raf = requestAnimationFrame(step);
        } else {
          raf = 0;
          setNums({ low: BAND.low, high: BAND.high });
        }
      };
      raf = requestAnimationFrame(step);
    }, COUNT_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      if (raf) cancelAnimationFrame(raf);
    };
  });
  return nums;
}

export default function DesignArt({ side, vars }: DioProps) {
  const ta = useTranslations("aboutPage.art.design");
  const t = useTranslations("siteAbout.art.design");
  const ref = useRef<HTMLDivElement>(null);
  const nums = useBandCountUp(ref);

  return (
    <div className="dio dio-design" data-side={side} style={vars} ref={ref}>
      <div className="bz">
        <div className="gl">
          <div className="dd-grid" aria-hidden="true" />
          <div className="dd-glow" aria-hidden="true" />
          <span className="sil dd-l dd-l-brief">{t("brief")}</span>
          <div className="dd-press" aria-hidden="true">
            <div className="dd-lay dd-scrap">
              <ScrapLayer />
            </div>
            <div className="dd-lay dd-cables">
              <CablesLayer />
            </div>
            <div className="dd-lay dd-plate">
              <PlateLayer />
            </div>
          </div>
          <div className="dd-rub" aria-hidden="true">
            <span className="sil dd-l-rub">{t("rubric")}</span>
            <ul>
              {CHIPS.map((c, i) => (
                <li key={c.tag} style={{ "--c": c.color, "--w": `${RUBRIC_FILLS[i]}%`, "--i": i } as Vars}>
                  <i>
                    <b />
                  </i>
                </li>
              ))}
            </ul>
          </div>
          <span className="sil dd-l dd-l-jd">{t("jobDescription")}</span>
          <div className="dd-jd paper">
            <div className="dd-band" aria-hidden="true" />
            <div className="dd-in">
              <div className="dd-head">
                <span className="dd-tile">{ta("badge")}</span>
                <div className="dd-tt">
                  <p className="dd-title">{ta("roleTitle")}</p>
                  <p className="dd-co">{ta("employer")}</p>
                </div>
              </div>
              <div className="dd-sec dd-must">
                <span className="sil">{ta("mustHaves")}</span>
                <ul className="dd-chips">
                  {CHIPS.map((c, i) => (
                    <li key={c.tag} style={{ "--c": c.color, "--i": i } as Vars}>
                      {c.tag}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="dd-sec dd-nice">
                <span className="sil">{t("niceToHaves")}</span>
                <ul className="dd-chips dd-ghost" aria-hidden="true">
                  {GHOST_CHIPS.map((w) => (
                    <li key={w} style={{ "--w": w } as Vars} />
                  ))}
                </ul>
              </div>
              <div className="dd-sec dd-sal">
                <span className="sil">{ta("salaryBand")}</span>
                <div className="dd-sal-row">
                  <div className="dd-range" aria-hidden="true">
                    <i className="dd-trk" />
                    <i className="dd-bf" />
                    <i className="dd-cap dd-cap1" />
                    <i className="dd-cap dd-cap2" />
                    <i className="dd-mk" />
                  </div>
                  <b className="dd-num">
                    <span className="dd-n1">{nums.low}</span>
                    {BAND.thousands + BAND.dash}
                    <span className="dd-n2">{nums.high}</span>
                    {BAND.thousands}
                  </b>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="dio-hero dio-hero--a" aria-hidden="true">
        <PencilSvg side={side} />
      </div>
      <div className="dio-hero dio-hero--b" aria-hidden="true">
        <RuleSvg side={side} />
      </div>
    </div>
  );
}
