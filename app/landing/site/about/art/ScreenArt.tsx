"use client";

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { reducedMotionNow, useDioEnter, type DioProps, type Side } from "./dio";
import { sparkD } from "./intake-geom";
import { sheetLines, threads } from "./screen-geom";

/*
 * Step 04 - SCREEN: "Every CV, read for real". Port of the prototype's
 * about-art/s4-screen.js (html(side) + mount(el)); styled by
 * ../../css/about-s4-screen.css.
 * Screen: a CV sheet behind a fairness-gate barrier arm (it lifts first); a scan
 * bar reads the sheet line by line; evidence lines turn coral and trace threads
 * run to three chips; a big 87 counts up on a 0-100 ruler that splits "held for a
 * human" from "advances". Hero: a chunky loupe (coral handle, brass rim) over the
 * sheet's corner. Stylised key art with sample data; the sheet carries no
 * readable text.
 */

/** Gradient / clip ids: one screen drawing per page, so a fixed prefix is unique. */
const P = "dio-screen-";
const id = (k: string) => P + k;
const url = (k: string) => "url(#" + id(k) + ")";

/** Sample figures (not copy): the score, the ruler's range, when the count-up runs. */
const SCORE = { final: 87, lowBelow: 75, range: "0–100", delayMs: 2450, durMs: 1300 } as const;

const cssVars = (v: Record<`--${string}`, string | number>) => v as CSSProperties;

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

/* ---------- threads: three thin coral traces from the evidence lines to the chip ports (desktop) ---------- */
function Threads() {
  return (
    <svg className="sc-svg" viewBox="0 0 40.6 29.6" aria-hidden="true" focusable="false">
      {threads().map((th, i) => (
        <g key={i} className={"sc-th sc-th" + (i + 1)} style={cssVars({ "--i": i })}>
          <path className="th-under" pathLength={1} d={th.d} />
          <path className="th-line" pathLength={1} d={th.d} />
          <circle className="th-knot" cx={th.x0} cy={th.y0} r=".3" />
          <circle className="th-knot th-knot2" cx={th.x1} cy={th.y1} r=".3" />
        </g>
      ))}
    </svg>
  );
}

/* ---------- the sheet ---------- */
function Sheet() {
  return (
    <div className="sc-sheet">
      <div className="sc-head">
        <i className="sc-av"></i>
        <span className="sc-hb">
          <i style={cssVars({ "--w": "82%" })}></i>
          <i style={cssVars({ "--w": "54%" })}></i>
        </span>
        <i className="sc-tag"></i>
      </div>
      <div className="sc-lines">
        {sheetLines().map((ln, i) => (
          <i key={i} className={ln.cls} style={cssVars({ "--w": ln.w, "--d": ln.d })}></i>
        ))}
      </div>
      <i className="sc-scan"></i>
    </div>
  );
}

/* ---------- HERO: a chunky loupe (viewBox 300 x 300): coral handle, brass ferrule + rim, paper lens with a traced line ---------- */
function Hero({ side }: { side: Side }) {
  const flip = side === "r";
  const fx = (x: number) => (flip ? 300 - x : x);
  // mirror about the lens centre (x=188), so the highlights stay top-left on both sides
  const lx = (x: number) => (flip ? 376 - x : x);
  // a mirrored group also mirrors an arc's sweep, so the light stays top-left on both sides
  const sw = flip ? 0 : 1;
  return (
    <svg viewBox="0 0 300 300" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id("br")} x1={flip ? 1 : 0} y1={0} x2={flip ? 0 : 1} y2={1}>
          <Stops list={[[0, "br0"], [0.3, "br1"], [0.62, "br2"], [1, "br3"]]} />
        </linearGradient>
        <linearGradient id={id("hd")} x1={0} y1={0} x2={0} y2={1}>
          <Stops list={[[0, "hd0"], [0.35, "hd1"], [1, "hd2"]]} />
        </linearGradient>
        <linearGradient id={id("gl")} x1={0} y1={0} x2={1} y2={1}>
          <Stops list={[[0, "lg0"], [1, "lg1"]]} />
        </linearGradient>
        <radialGradient id={id("sh")} cx={0.5} cy={0.5} r={0.5}>
          <Stops list={[[0, "sh0"], [0.6, "sh1"], [1, "sh2"]]} />
        </radialGradient>
        <clipPath id={id("lens")}>
          <circle cx="188" cy="116" r="66" />
        </clipPath>
      </defs>
      <g transform={flip ? "translate(300 0) scale(-1 1)" : undefined}>
        <ellipse cx="150" cy="284" rx="132" ry="9" fill={url("sh")} />
        {/* handle: coral, grip ridges, brass end cap, brass ferrule (drawn along +x, rotated to point at the lens) */}
        <g transform="translate(58 246) rotate(-45)">
          <rect x="-8" y="-21" width="112" height="42" rx="21" fill={url("hd")} className="lp-ink" />
          <path d="M22 -13V13M38 -13V13M54 -13V13M70 -13V13" className="lp-grip" />
          <path d="M8 -13.5H92" className="lp-hi" />
          <rect x="-14" y="-17" width="20" height="34" rx="9" fill={url("br")} className="lp-ink" />
          <rect x="92" y="-27" width="30" height="54" rx="10" fill={url("br")} className="lp-ink" />
          <path d="M99 -19H115" className="lp-hi" />
        </g>
        {/* rim */}
        <circle cx="188" cy="116" r="86" fill={url("br")} className="lp-ink" />
        <circle cx="188" cy="116" r="72.5" className="lp-ring" />
        <path d={"M" + lx(122) + " 66A80 80 0 0 " + sw + " " + lx(178) + " 34"} className="lp-rimhi" />
        <circle cx="150" cy="150" r="3.6" className="lp-rivet" />
        <circle cx="226" cy="182" r="3.6" className="lp-rivet" />
        <circle cx="252" cy="96" r="3.6" className="lp-rivet" />
        {/* the lens: paper, magnified lines, the traced one lit coral */}
        <circle cx="188" cy="116" r="67" fill={url("gl")} />
        <g clipPath={url("lens")}>
          <g className="lp-page">
            <rect x="110" y="78" width="120" height="13" rx="6.5" className="lp-bar" />
            <rect x="104" y="99" width="150" height="36" rx="10" className="lp-evbg" />
            <rect x="116" y="110" width="118" height="14" rx="7" className="lp-ev" />
            <circle cx="240" cy="117" r="6.5" className="lp-evdot" />
            <rect x="110" y="146" width="96" height="13" rx="6.5" className="lp-bar" />
            <g className="lp-glintband">
              <rect x="100" y="30" width="26" height="170" className="lp-band" transform="rotate(24 190 116)" />
            </g>
          </g>
        </g>
        <circle cx="188" cy="116" r="67" className="lp-glassedge" />
        <path d={"M" + lx(140) + " 92A54 54 0 0 " + sw + " " + lx(170) + " 62"} className="lp-glint" />
        <circle cx={lx(134)} cy="106" r="3.6" className="lp-glintdot" />
        <g className="hs-sparks">
          <Spark x={lx(112)} y={48} s={17} cls="hs-sp hs-sp1" />
          <Spark x={fx(262)} y={210} s={9} cls="hs-sp hs-sp2" />
          <Spark x={fx(24)} y={178} s={7} cls="hs-sp hs-sp3" />
        </g>
      </g>
    </svg>
  );
}

/* ---------- count-up: 87 climbs on the ruler once the last thread has landed; the server markup already says 87 ---------- */
function useScore(root: RefObject<HTMLDivElement | null>): number {
  const [v, setV] = useState<number>(SCORE.final);

  // Waiting to enter: the score reads 0, not the answer (as the prototype's mount did).
  useEffect(() => {
    const el = root.current;
    if (!el || reducedMotionNow() || el.classList.contains("is-in")) return;
    const raf = requestAnimationFrame(() => setV(0));
    return () => cancelAnimationFrame(raf);
  }, [root]);

  useDioEnter(root, () => {
    if (reducedMotionNow()) {
      setV(SCORE.final);
      return;
    }
    setV(0);
    let raf = 0;
    const tick = (t0: number) => (now: number) => {
      const t = (now - t0) / SCORE.durMs;
      if (t >= 1) {
        setV(SCORE.final);
        raf = 0;
        return;
      }
      setV(Math.round(SCORE.final * (1 - Math.pow(1 - t, 3))));
      raf = requestAnimationFrame(tick(t0));
    };
    const timer = window.setTimeout(() => {
      raf = requestAnimationFrame(tick(performance.now()));
    }, SCORE.delayMs);
    return () => {
      window.clearTimeout(timer);
      if (raf) cancelAnimationFrame(raf);
    };
  });

  return v;
}

export default function ScreenArt({ side, vars }: DioProps) {
  const t = useTranslations("aboutPage.art.screen");
  const ts = useTranslations("siteAbout.art.screen");
  const root = useRef<HTMLDivElement>(null);
  const v = useScore(root);

  return (
    <div className="dio dio-screen" data-side={side} style={vars} ref={root}>
      <div className="bz">
        <div className="gl">
          <div className="sc-stage">
            {/* the fairness gate: a boom-barrier that lifts before anything is read */}
            <div className="sc-gate" aria-hidden="true">
              <i className="sc-tail"></i>
              <i className="sc-arm"></i>
              <i className="sc-post">
                <b className="sc-lamp"></b>
              </i>
            </div>
            <span className="sil sc-gl">{ts("fairnessGate")}</span>
            <Sheet />
            <Threads />
            <ul className="sc-chips">
              <li className="sc-chip sc-chip1" style={cssVars({ "--i": 0 })}>
                <i className="sc-port"></i>
                <span className="sc-ct">{t("factors.skills")}</span>
                <span className="sc-m">
                  <i style={cssVars({ "--w": "92%" })}></i>
                </span>
              </li>
              <li className="sc-chip sc-chip2" style={cssVars({ "--i": 1 })}>
                <i className="sc-port"></i>
                <span className="sc-ct">{t("factors.seniority")}</span>
                <span className="sc-m">
                  <i style={cssVars({ "--w": "84%" })}></i>
                </span>
              </li>
              <li className="sc-chip sc-chip3" style={cssVars({ "--i": 2 })}>
                <i className="sc-port"></i>
                <span className="sc-ct">{t("factors.evidence")}</span>
                <span className="sc-m sc-m3">
                  <i></i>
                </span>
              </li>
            </ul>
            <div className={"sc-score" + (v < SCORE.lowBelow ? " is-low" : "")} style={cssVars({ "--v": v })}>
              <b className="sc-num">{v}</b>
              <span className="sil sc-range">{SCORE.range}</span>
              <span className="sc-adv sil">{ts("advances")}</span>
              <div className="sc-rule">
                <i className="sc-zone"></i>
                <i className="sc-fill"></i>
                <i className="sc-thr"></i>
                <i className="sc-mark"></i>
              </div>
              <span className="sil sc-held">{ts("heldForHuman")}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="dio-hero dio-hero--a" aria-hidden="true">
        <Hero side={side} />
      </div>
    </div>
  );
}
