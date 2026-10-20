"use client";

import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { reducedMotionNow, useDioEnter, type DioProps, type Side } from "./dio";
import {
  BAND_H,
  BAND_Y,
  BAY_Y,
  LANE_L,
  LANE_R,
  SX,
  Y1,
  cubic,
  heroTubes,
  offsetLine,
  r,
  sparkD,
  tiesD,
  tokenPath,
  tubePts,
} from "./intake-geom";

/*
 * Step 03 - INTAKE: "Five doors, one pipeline". Port of the prototype's
 * about-art/s3-intake.js (html(side) + mount(el)); styled by
 * ../../css/about-s3-intake.css.
 * Screen: five glass tubes (Apply, Email, Boards, Sourcing, Manual) fan in through
 * brass nozzles onto ONE lane; a chequered start line between two brass pylons;
 * five tokens land on it at the same instant; a counter reaches 47.
 * Hero: a brass pneumatic-tube manifold (five coloured tubes, one collector, one
 * capsule in the outlet). Stylised key art with sample data.
 */

/** Gradient / clip ids: one intake drawing per page, so a fixed prefix is unique. */
const P = "dio-intake-";
const id = (k: string) => P + k;
const url = (k: string) => "url(#" + id(k) + ")";

/** The sample figure the counter climbs to (not copy: a bare number). */
const COUNT = { final: 47, delayMs: 1150, durMs: 1900 } as const;

const CHANNELS = ["apply", "email", "boards", "sourcing", "manual"] as const;

type Stop = [number, string];

function Stops({ list }: { list: Stop[] }) {
  return (
    <>
      {list.map(([offset, cls]) => (
        <stop key={cls} offset={offset} className={cls} />
      ))}
    </>
  );
}

function Spark({ x, y, s, cls }: { x: number; y: number; s: number; cls: string }) {
  return <path className={cls} d={sparkD(x, y, s)} />;
}

/* ---------- the five door badges: a brass ring, a cream face, a hand-drawn glyph ---------- */
const GLYPHS: ReactNode[] = [
  /* Apply: a portal window with a coloured title bar, a line and a button */
  <>
    <rect x="-.88" y="-.7" width="1.76" height="1.4" rx=".22" className="gf" />
    <path d="M-.88 -.32H.88" className="gs" />
    <path d="M-.88 -.48V-.48Q-.88 -.7 -.66 -.7H.66Q.88 -.7 .88 -.48V-.32H-.88Z" className="ga" />
    <path d="M-.52 .04H.4M-.52 .36H.06" className="gs g-dim" />
    <rect x=".18" y=".2" width=".52" height=".36" rx=".1" className="ga gk" />
  </>,
  /* Email: an envelope with a wax dot */
  <>
    <rect x="-.9" y="-.62" width="1.8" height="1.24" rx=".22" className="gf" />
    <path d="M-.86 -.5L0 .16L.86 -.5" className="gs" />
    <circle cx="0" cy=".22" r=".2" className="ga gk" />
  </>,
  /* Boards: a job board, four listing tiles and a pin */
  <>
    <rect x="-.92" y="-.74" width="1.84" height="1.5" rx=".24" className="gf" />
    <rect x="-.64" y="-.4" width=".58" height=".46" rx=".1" className="ga gk" />
    <rect x=".06" y="-.4" width=".58" height=".46" rx=".1" className="gf gk" />
    <rect x="-.64" y=".14" width=".58" height=".4" rx=".1" className="gf gk" />
    <rect x=".06" y=".14" width=".58" height=".4" rx=".1" className="ga gk" />
    <circle cx="0" cy="-.64" r=".17" className="gs gp" />
  </>,
  /* Sourcing: a search glass with a person in it */
  <>
    <path d="M.4 .4L.9 .9" className="gs gh" />
    <path d="M.4 .4L.9 .9" className="gs ga2" />
    <circle cx="-.14" cy="-.14" r=".68" className="gf" />
    <circle cx="-.14" cy="-.34" r=".19" className="ga gk" />
    <path d="M-.52 .12Q-.14 -.18 .24 .12" className="gs g-dim" />
  </>,
  /* Manual: a hand-drawn plus, still warm from the pencil */
  <>
    <path d="M-.06 -.72Q.04 -.02 -.02 .72M-.74 .04Q-.02 -.06 .72 .02" className="gs gh" />
    <path d="M-.06 -.72Q.04 -.02 -.02 .72M-.74 .04Q-.02 -.06 .72 .02" className="gs ga2" />
    <circle cx=".64" cy="-.64" r=".17" className="ga gk" />
  </>,
];

function Badge({ k }: { k: number }) {
  return (
    <svg className="in-badge" viewBox="-1.95 -1.95 3.9 3.9" aria-hidden="true" focusable="false">
      <circle r="1.74" className="b-ring" />
      <path d="M-1.38 -.7A1.55 1.55 0 0 1 -.6 -1.44" className="b-hi" />
      <path d="M1.42 .5A1.55 1.55 0 0 1 .5 1.42" className="b-lo" />
      <circle r="1.2" className="b-face" />
      <circle r="1.2" className="b-in" />
      <g className="b-glyph">{GLYPHS[k]}</g>
    </svg>
  );
}

/* ---------- a token: a little CV card in the door's colour ---------- */
function Token({ i }: { i: number }) {
  return (
    <g className={"in-tok in-tok" + (i + 1)} style={{ offsetPath: "path('" + tokenPath(i) + "')" }}>
      <g className="in-tok-in">
        <rect x="-1.4" y="-1.7" width="2.8" height="3.4" rx=".5" className="t-card" />
        <path d="M-1.4 -1.2Q-1.4 -1.7 -.9 -1.7H.9Q1.4 -1.7 1.4 -1.2V-.55H-1.4Z" className="t-tab" />
        <path d="M-.95 -1.36H.2" className="t-hi" />
        <circle cx="-.6" cy=".22" r=".4" className="t-av" />
        <path d="M0 .1H.95M-.95 1H.95" className="t-ln" />
        <rect x="-1.4" y="-1.7" width="2.8" height="3.4" rx=".5" className="t-edge" />
      </g>
    </g>
  );
}

const I5 = [0, 1, 2, 3, 4];
const iVar = (i: number) => ({ "--i": i }) as CSSProperties;

/* ---------- the screen graphics (desktop): docking bay, lane, tubes, start line, tokens ---------- */
function ScreenSvg({ side }: { side: Side }) {
  const cx = side === "r" ? 19.4 : 21.2;
  const laneW = LANE_R - LANE_L;
  return (
    <svg className="in-svg" viewBox="0 0 40.6 29.6" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id("br")} x1={0} y1={0} x2={0} y2={1}>
          <Stops list={[[0, "br0"], [0.32, "br1"], [0.64, "br2"], [1, "br3"]]} />
        </linearGradient>
        <linearGradient id={id("bay")} x1={0} y1={0} x2={0} y2={1}>
          <Stops list={[[0, "by0"], [1, "by1"]]} />
        </linearGradient>
        <linearGradient id={id("lane")} x1={0} y1={0} x2={0} y2={1}>
          <Stops list={[[0, "ln0"], [1, "ln1"]]} />
        </linearGradient>
        <linearGradient id={id("fade")} x1={0} y1={BAND_Y + BAND_H} x2={0} y2={29.6} gradientUnits="userSpaceOnUse">
          <Stops list={[[0, "dh0"], [1, "dh1"]]} />
        </linearGradient>
        <linearGradient id={id("glow")} x1={0} y1={0} x2={0} y2={1}>
          <Stops list={[[0, "gw0"], [1, "gw1"]]} />
        </linearGradient>
        <pattern id={id("chk")} x={LANE_L} y={BAND_Y} width="1.6" height="1.6" patternUnits="userSpaceOnUse">
          <rect width="1.6" height="1.6" className="ck0" />
          <rect width=".8" height=".8" className="ck1" />
          <rect x=".8" y=".8" width=".8" height=".8" className="ck1" />
        </pattern>
      </defs>
      {/* the docking bay above the line and the track below it */}
      <rect className="in-bay" x={LANE_L} y={BAY_Y} width={laneW} height={r(BAND_Y - BAY_Y)} fill={url("bay")} />
      {I5.map((i) => (
        <rect key={i} x={r(SX[i] - 2.15)} y={BAY_Y + 0.35} width="4.3" height={r(BAND_Y - BAY_Y - 0.35)} rx=".5" className="in-slot" />
      ))}
      <path className="in-track" fill={url("lane")} d={"M" + LANE_L + " " + (BAND_Y + BAND_H) + "H" + LANE_R + "V29.6H" + LANE_L + "Z"} />
      <path
        className="in-edges"
        stroke={url("fade")}
        d={"M" + LANE_L + " " + (BAND_Y + BAND_H) + "V29.6M" + LANE_R + " " + (BAND_Y + BAND_H) + "V29.6"}
      />
      <path className="in-ties" stroke={url("fade")} d={tiesD()} />
      {/* tubes, then the line and its pylons, then the tokens riding INSIDE the glass, then the glass sheen, then nozzles */}
      <g className="in-tubes">
        {I5.map((i) => {
          const d = cubic(tubePts(i));
          return (
            <g key={i} className={"in-tb in-tb" + (i + 1)} style={iVar(i)}>
              <path className="tb-ink" pathLength={1} d={d} />
              <path className="tb-rim" pathLength={1} d={d} />
              <path className="tb-body" pathLength={1} d={d} />
              <path className="tb-lum" pathLength={1} d={d} />
            </g>
          );
        })}
      </g>
      <rect className="in-bandglow" x={LANE_L} y={BAND_Y + BAND_H} width={laneW} height="3.6" fill={url("glow")} />
      <g className="in-band">
        <rect x={LANE_L} y={BAND_Y + BAND_H} width={laneW} height=".3" className="band-curb" />
        <rect x={LANE_L} y={BAND_Y} width={laneW} height={BAND_H} fill={url("chk")} />
        <rect x={LANE_L} y={BAND_Y} width={laneW} height={BAND_H} className="band-edge" />
        <path d={"M" + (LANE_L + 0.2) + " " + (BAND_Y - 0.12) + "H" + (LANE_R - 0.2)} className="band-hi" />
      </g>
      <g className="in-pylons">
        {[LANE_L - 1.15, LANE_R].map((x, k) => (
          <g key={k} transform={"translate(" + r(x) + " 0)"}>
            <rect x="0" y={BAND_Y - 1.5} width="1.15" height={r(BAND_H + 3.1)} rx=".42" fill={url("br")} className="n-ink" />
            <circle cx=".575" cy={BAND_Y - 1.5} r=".78" fill={url("br")} className="n-ink" />
            <path d={"M" + (k ? 0.38 : 0.34) + " " + (BAND_Y - 0.5) + "V" + (BAND_Y + BAND_H + 0.9)} className="n-hi" />
            <circle cx=".575" cy={BAND_Y + 0.4} r=".14" className="n-riv" />
            <circle cx=".575" cy={BAND_Y + BAND_H + 0.9} r=".14" className="n-riv" />
          </g>
        ))}
      </g>
      <g className="in-hooks">
        <rect x={r(cx - 4.9)} y={BAND_Y + BAND_H - 0.1} width=".42" height=".95" rx=".12" className="hk" />
        <rect x={r(cx + 4.48)} y={BAND_Y + BAND_H - 0.1} width=".42" height=".95" rx=".12" className="hk" />
      </g>
      <g className="in-toks">
        {I5.map((i) => (
          <Token key={i} i={i} />
        ))}
      </g>
      <g className="in-glass">
        {I5.map((i) => {
          const p = tubePts(i);
          return (
            <g key={i} className={"in-tb in-tb" + (i + 1)} style={iVar(i)}>
              <path className="tb-light" pathLength={1} d={offsetLine(p, 0.5, 0.03, 0.97, 28)} />
              <path className="tb-shade" pathLength={1} d={offsetLine(p, -0.66, 0.03, 0.97, 28)} />
              <path className="tb-sheen" pathLength={1} d={offsetLine(p, 0.82, 0.06, 0.94, 28)} />
              <path className="tb-sheen2" pathLength={1} d={offsetLine(p, -0.88, 0.08, 0.92, 28)} />
            </g>
          );
        })}
      </g>
      <g className="in-nozs">
        {I5.map((i) => (
          <g key={i} transform={"translate(" + SX[i] + " " + Y1 + ")"} className={"in-noz in-noz" + (i + 1)} style={iVar(i)}>
            <path d="M-2.2 -.3H2.2L1.72 .98Q1.66 1.12 1.5 1.12H-1.5Q-1.66 1.12 -1.72 .98Z" fill={url("br")} className="n-ink" />
            <rect x="-2.6" y="-.92" width="5.2" height=".74" rx=".3" fill={url("br")} className="n-ink" />
            <path d="M-2.1 -.68H2.1" className="n-hi" />
            <path d="M-1.36 .1V.7" className="n-hi" />
            <circle cx="-2.1" cy="-.55" r=".13" className="n-riv" />
            <circle cx="2.1" cy="-.55" r=".13" className="n-riv" />
          </g>
        ))}
      </g>
      <g className="in-lands">
        {I5.map((i) => (
          <g key={i} className={"in-land in-land" + (i + 1)} transform={"translate(" + SX[i] + " " + (BAND_Y - 0.2) + ")"}>
            <Spark x={0} y={-0.6} s={1.25} cls="in-sp" />
            <Spark x={1.55} y={0.1} s={0.55} cls="in-sp in-sp2" />
            <Spark x={-1.5} y={0.05} s={0.45} cls="in-sp in-sp2" />
          </g>
        ))}
      </g>
      <g className="in-decor">
        <Spark x={38.6} y={9.2} s={0.62} cls="in-dc" />
        <Spark x={1.7} y={15.6} s={0.46} cls="in-dc in-dc2" />
        <Spark x={36.2} y={12.4} s={0.4} cls="in-dc in-dc2" />
      </g>
    </svg>
  );
}

/* ---------- HERO: the brass pneumatic-tube manifold (viewBox 332 x 290, lit from the top-left) ---------- */
function Hero({ side }: { side: Side }) {
  const flip = side === "r";
  const L = flip ? -1 : 1;
  const tubes = heroTubes(L);
  const riv = (x: number, ys: number[]) =>
    ys.map((y) => (
      <Fragment key={y}>
        <circle cx={x} cy={y} r="4.4" className="hb-riv" />
        <circle cx={r(x - 1.3 * L)} cy={y - 1.4} r="1.4" className="hb-rivhi" />
      </Fragment>
    ));
  return (
    <svg viewBox="0 0 332 290" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id("bv")} x1={0} y1={0} x2={0} y2={1}>
          <Stops list={[[0, "br0"], [0.2, "br1"], [0.55, "br2"], [0.88, "br3"], [1, "br4"]]} />
        </linearGradient>
        <linearGradient id={id("bh")} x1={flip ? 1 : 0} y1={0} x2={flip ? 0 : 1} y2={0}>
          <Stops list={[[0, "br0"], [0.34, "br1"], [0.72, "br2"], [1, "br3"]]} />
        </linearGradient>
        <linearGradient id={id("gp")} x1={0} y1={0} x2={0} y2={1}>
          <Stops list={[[0, "gp0"], [0.5, "gp1"], [1, "gp2"]]} />
        </linearGradient>
        <linearGradient id={id("cp")} x1={0} y1={0} x2={0} y2={1}>
          <Stops list={[[0, "cp0"], [0.5, "cp1"], [1, "cp2"]]} />
        </linearGradient>
        <radialGradient id={id("sh")} cx={0.5} cy={0.5} r={0.5}>
          <Stops list={[[0, "sh0"], [0.6, "sh1"], [1, "sh2"]]} />
        </radialGradient>
        <clipPath id={id("win")}>
          <rect x="264" y="190" width="56" height="46" rx="4" />
        </clipPath>
      </defs>
      <g transform={flip ? "translate(332 0) scale(-1 1)" : undefined}>
        <ellipse cx="166" cy="272" rx="156" ry="9" fill={url("sh")} />
        {/* feet */}
        <path d="M78 248L84 270H128L134 248Z" className="hb-brk" />
        <path d="M170 248L176 270H220L226 248Z" className="hb-brk" />
        {/* left cap nut + barrel + end collars */}
        <rect x="14" y="198" width="34" height="46" rx="9" fill={url("bh")} className="hb-ink2" />
        <path d="M25 203V239M35 203V239" className="hb-facet" />
        <rect x="40" y="180" width="212" height="70" rx="22" fill={url("bv")} className="hb-ink2" />
        <rect x="66" y="188" width="150" height="9" rx="4.5" className="hb-glare" />
        <rect x="66" y="238" width="150" height="3.4" rx="1.7" className="hb-bounce" />
        <path d="M112 218l10 8-10 8M132 218l10 8-10 8M152 218l10 8-10 8" className="hb-chev" />
        {/* tubes, then their couplings over the tube feet */}
        <g className="hh-tubes">
          {tubes.map((tb, k) => (
            <g key={k} className={"hh-tb hh-tb" + (k + 1)}>
              <path className="hb-ink" d={tb.d} />
              <path className="hb-rim" d={tb.d} />
              <path className="hb-body" d={tb.d} />
              <path className="hb-lum" d={tb.d} />
              <path className="hb-light" d={tb.light} />
              <path className="hb-shade" d={tb.shade} />
              <path className="hb-sheen" d={tb.sheen} />
              <path className="hb-sheen2" d={tb.sheen2} />
              <path className="hb-glint" pathLength={1} d={tb.glint} style={{ "--gi": k } as CSSProperties} />
            </g>
          ))}
        </g>
        <g className="hh-nuts">
          {tubes.map(({ bx }, k) => (
            <Fragment key={k}>
              <rect x={bx - 16} y="152" width="32" height="30" rx="6" fill={url("bh")} className="hb-ink2" />
              <rect x={bx - 19} y="146" width="38" height="12" rx="4.6" fill={url("bh")} className="hb-ink2" />
              <path d={"M" + (bx - 12 * L) + " 165V176"} className="hb-fhi" />
              <path d={"M" + (bx - 13 * L) + " 150.4H" + (bx + 10 * L)} className="hb-fhi" />
            </Fragment>
          ))}
        </g>
        <g className="hh-mouths">
          {tubes.map((tb, k) => (
            <g
              key={k}
              transform={"translate(" + tb.tx + " " + tb.ty + ") rotate(" + tb.ang + ")"}
              className={"hh-tb hh-tb" + (k + 1) + " hh-mouth"}
            >
              <path d="M-17.5 20Q-18.5 7 -25 -3H25Q18.5 7 17.5 20Z" fill={url("bh")} className="hb-ink2" />
              <path d={"M" + (-15 * L) + " 18Q" + (-15.6 * L) + " 8 " + (-20 * L) + " 0"} className="hb-fhi" />
              <ellipse cx="0" cy="-3" rx="25" ry="9.8" className="hm-lip" />
              <ellipse cx="0" cy="-3.4" rx="18.6" ry="6.8" className="hm-hole" />
              <ellipse cx="0" cy="-2.2" rx="14" ry="4.2" className="hm-glow" />
              <path d={"M" + (-21 * L) + " -6Q" + (-16 * L) + " -11.4 " + (-6.4 * L) + " -12.6"} className="hm-hi" />
            </g>
          ))}
        </g>
        {/* collars with rivets */}
        <rect x="36" y="170" width="30" height="90" rx="10" fill={url("bh")} className="hb-ink2" />
        {riv(51, [188, 215, 242])}
        <rect x="230" y="170" width="30" height="90" rx="10" fill={url("bh")} className="hb-ink2" />
        {riv(245, [188, 215, 242])}
        {/* the glass outlet and the one capsule sliding through it */}
        <rect x="262" y="188" width="60" height="50" rx="6" fill={url("gp")} className="hb-ink2" />
        <g clipPath={url("win")}>
          <g className="hh-cap">
            <g transform="translate(292 214)">
              <rect x="-24" y="-16" width="48" height="32" rx="16" fill={url("cp")} className="cp-ink" />
              <rect x="-7" y="-16" width="14" height="32" className="cp-band" />
              <path d="M-2.6 -9.5V9.5M2.6 -9.5V9.5" className="cp-ln" />
              <rect x="-24" y="-16" width="48" height="32" rx="16" className="cp-edge" />
              <path d="M-18.5 -8.5Q-16 -12.6 -9 -12.8" className="cp-hi" />
            </g>
          </g>
        </g>
        <path d="M268 195H316" className="hb-pipehi" />
        <rect x="314" y="176" width="16" height="74" rx="7" fill={url("bh")} className="hb-ink2" />
        {riv(322, [190, 213, 236])}
        <g className="hh-sparks">
          <Spark x={300} y={134} s={12} cls="hh-sp hh-sp1" />
          <Spark x={16} y={160} s={7.5} cls="hh-sp hh-sp2" />
          <Spark x={250} y={36} s={6.5} cls="hh-sp hh-sp3" />
        </g>
      </g>
    </svg>
  );
}

/* ---------- the counter: climbs to 47 while the tokens fall; the server markup already says 47 ---------- */
function useCountUp(root: RefObject<HTMLDivElement | null>): number {
  const [v, setV] = useState<number>(COUNT.final);

  // Waiting to enter: the counter reads 00, not the answer (as the prototype's mount did).
  useEffect(() => {
    const el = root.current;
    if (!el || reducedMotionNow() || el.classList.contains("is-in")) return;
    const raf = requestAnimationFrame(() => setV(0));
    return () => cancelAnimationFrame(raf);
  }, [root]);

  useDioEnter(root, () => {
    if (reducedMotionNow()) {
      setV(COUNT.final);
      return;
    }
    setV(0);
    let raf = 0;
    const tick = (t0: number) => (now: number) => {
      const t = (now - t0) / COUNT.durMs;
      if (t >= 1) {
        setV(COUNT.final);
        raf = 0;
        return;
      }
      setV(Math.round(COUNT.final * (1 - Math.pow(1 - t, 3))));
      raf = requestAnimationFrame(tick(t0));
    };
    const timer = window.setTimeout(() => {
      raf = requestAnimationFrame(tick(performance.now()));
    }, COUNT.delayMs);
    return () => {
      window.clearTimeout(timer);
      if (raf) cancelAnimationFrame(raf);
    };
  });

  return v;
}

/* ---------- markup ---------- */
export default function IntakeArt({ side, vars }: DioProps) {
  const t = useTranslations("aboutPage.art.intake");
  const ts = useTranslations("siteAbout.art.intake");
  const root = useRef<HTMLDivElement>(null);
  const v = useCountUp(root);
  const tens = v >= 10 ? Math.floor(v / 10) : 0;
  const ones = v % 10;

  return (
    <div className="dio dio-intake" data-side={side} style={vars} ref={root}>
      <div className="bz">
        <div className="gl">
          <ScreenSvg side={side} />
          <ul className="in-doors">
            {CHANNELS.map((ch, i) => (
              <li key={ch} className={"in-door in-door" + (i + 1)} style={iVar(i)}>
                <span className="in-lab">{t(`channels.${ch}`)}</span>
                <Badge k={i} />
                <span className="in-pt" aria-hidden="true">
                  <i className="in-ptk"></i>
                </span>
              </li>
            ))}
          </ul>
          <div className="in-plate paper">
            <b className="in-plate-t">{t("onePipeline")}</b>
            <span className="sil in-plate-s">{ts("sameStartingLine")}</span>
          </div>
          <div className="in-odo">
            <div className="in-odo-c">
              <b className={v >= 10 ? undefined : "is-dim"}>{tens}</b>
              <b>{ones}</b>
            </div>
            <span className="in-dots" aria-hidden="true">
              <i></i>
              <i></i>
              <i></i>
              <i></i>
              <i></i>
            </span>
          </div>
        </div>
      </div>
      <div className="dio-hero dio-hero--a" aria-hidden="true">
        <Hero side={side} />
      </div>
    </div>
  );
}
