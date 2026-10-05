import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { DioProps } from "./dio";
import {
  CHAIN_CX,
  CHAIN_STOPS,
  CODE,
  HERO_GRADS,
  LEG_L,
  PILL_W,
  chainClip,
  pillDelay,
  sparkPath,
  type Grad,
  type Stop,
} from "./assignment-geom";

/*
 * Step 05 · Assignment. A port of the prototype's about-art/s5-assignment.js:
 * a live work surface (an editor drawn as coloured bars, one line flagged), the
 * prompts on record, a four-tick tamper-evident log, a session that seals
 * itself; the hero is a specimen card with a pinned beetle (the planted flaw).
 * All motion is CSS (about-s5-assignment.css), started by `.dio.is-in`, which
 * the page controller toggles on the root; the root's className stays constant.
 * The code and the prompts are shapes, never readable text.
 */

/** Gradient / clip / symbol ids: one Assignment drawing per page. */
const P = "dio-assignment-";
const id = (k: string) => P + k;
const u = (k: string) => "url(#" + id(k) + ")";

function Stops({ list }: { list: readonly Stop[] }) {
  return (
    <>
      {list.map(([offset, cls]) => (
        <stop key={offset} offset={offset} className={cls} />
      ))}
    </>
  );
}

function Gradient({ g, gid }: { g: Grad; gid: string }) {
  return g.kind === "lin" ? (
    <linearGradient id={gid} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}>
      <Stops list={g.stops} />
    </linearGradient>
  ) : (
    <radialGradient id={gid} cx={g.cx} cy={g.cy} r={g.r}>
      <Stops list={g.stops} />
    </radialGradient>
  );
}

/* ---------------------------------------------------------------------------------------------------------
   HERO: the specimen card. viewBox 0 0 220 270. The beetle is drawn head-up in its own local frame
   (origin near the thorax) and placed on the mat; the same silhouette, offset, is its shadow on the card. */

const MAND = "M-8 -63C-23 -71 -31 -89 -17 -104";
const ANTENNA = "M-15 -54L-33 -59";
const SHELL = "M-36 -16C-45 8 -41 46 0 68C41 46 45 8 36 -16C22 -24 -22 -24 -36 -16Z";
const PRONOTUM = "M-31 -22C-34 -40 -19 -50 0 -50C19 -50 34 -40 31 -22C29 -13 15 -8 0 -8C-15 -8 -29 -13 -31 -22Z";

function Beetle() {
  return (
    <>
      <g className="h-legs" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path className="s-ink" strokeWidth="10" d={LEG_L} />
        <path className="s-leg" strokeWidth="5" d={LEG_L} />
        <g transform="scale(-1 1)">
          <path className="s-ink" strokeWidth="10" d={LEG_L} />
          <path className="s-leg" strokeWidth="5" d={LEG_L} />
        </g>
      </g>
      <g className="h-mand" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path className="s-ink" strokeWidth="12.5" d={MAND} />
        <path stroke={u("brass")} strokeWidth="7" d={MAND} />
        <path className="s-hi" strokeWidth="2" opacity=".75" d="M-10 -65C-24 -73 -33 -89 -19 -103" />
        <g transform="scale(-1 1)">
          <path className="s-ink" strokeWidth="12.5" d={MAND} />
          <path stroke={u("brass")} strokeWidth="7" d={MAND} />
        </g>
        <path className="s-ink" strokeWidth="6.4" d={ANTENNA} />
        <path className="s-leg" strokeWidth="2.6" d={ANTENNA} />
        <g transform="scale(-1 1)">
          <path className="s-ink" strokeWidth="6.4" d={ANTENNA} />
          <path className="s-leg" strokeWidth="2.6" d={ANTENNA} />
        </g>
      </g>
      <g className="h-clubs">
        <circle className="f-club s-ink" cx="-37" cy="-60.5" r="4.6" strokeWidth="2.8" />
        <circle className="f-club s-ink" cx="37" cy="-60.5" r="4.6" strokeWidth="2.8" />
      </g>
      <ellipse cx="0" cy="-55" rx="17.5" ry="14.5" fill={u("head")} className="s-ink" strokeWidth="5" />
      <path className="s-hi" fill="none" strokeWidth="3" strokeLinecap="round" opacity=".55" d="M-11 -63C-7 -67 -1 -68 4 -68" />
      <g className="h-eyes">
        <circle cx="-8.7" cy="-57.5" r="4.8" className="f-cream s-ink" strokeWidth="2.4" />
        <circle cx="8.7" cy="-57.5" r="4.8" className="f-cream s-ink" strokeWidth="2.4" />
        <circle cx="-7.7" cy="-56.6" r="2.2" className="f-ink" />
        <circle cx="9.7" cy="-56.6" r="2.2" className="f-ink" />
        <circle cx="-8.7" cy="-58.6" r=".95" className="f-white" />
        <circle cx="8.7" cy="-58.6" r=".95" className="f-white" />
      </g>
      <path d={SHELL} fill={u("shell")} className="s-ink" strokeWidth="5" />
      <path className="f-shade" d="M39 6C35 40 19 60 0 66C25 58 38 38 39 6Z" />
      <path className="s-ink" fill="none" strokeWidth="3.2" opacity=".85" d="M0 -20V66" />
      <path className="s-hi" fill="none" strokeWidth="1.6" opacity=".4" d="M2.6 -18V62" />
      <g fill="none" strokeLinecap="round" className="s-ink" strokeWidth="3.4" opacity=".32" strokeDasharray="0.1 8.2">
        <path d="M-13 -12C-15 12 -12 38 -4 58" />
        <path d="M-25 -10C-29 12 -25 36 -13 53" />
        <path d="M13 -12C15 12 12 38 4 58" />
        <path d="M25 -10C29 12 25 36 13 53" />
      </g>
      <path className="s-hi" fill="none" strokeWidth="5.4" strokeLinecap="round" opacity=".52" d="M-30 -6C-33 8 -31 22 -25 34" />
      <path className="s-hi" fill="none" strokeWidth="3" strokeLinecap="round" opacity=".5" d="M-27 -13L-22 -16" />
      <path d={PRONOTUM} fill={u("pron")} className="s-ink" strokeWidth="5" />
      <path className="s-ink" fill="none" strokeWidth="2.4" opacity=".4" d="M0 -46V-12" />
      <path className="s-hi" fill="none" strokeWidth="4.6" strokeLinecap="round" opacity=".55" d="M-23 -34C-19 -41 -9 -45 2 -45" />
    </>
  );
}

/* the pin: shaft from the shoulder, ball head, a flag planted on top */
function Pin() {
  return (
    <g className="h-pin">
      <g className="h-sway">
        <path d="M16 -11L58 -50" fill="none" className="s-ink" strokeWidth="6.6" strokeLinecap="round" />
        <path d="M16 -11L58 -50" fill="none" stroke={u("brass")} strokeWidth="3" strokeLinecap="round" />
        <g className="h-flag">
          <path d="M58 -50L58 -90" fill="none" className="s-ink" strokeWidth="5.6" strokeLinecap="round" />
          <path d="M58 -50L58 -90" fill="none" stroke={u("brass")} strokeWidth="2.4" strokeLinecap="round" />
          <g className="h-pennant">
            <g className="h-flut">
              <path d="M60 -89L92 -80L86 -71L93 -62L60 -63Z" fill={u("flag")} className="s-ink" strokeWidth="3.6" strokeLinejoin="round" />
              <path className="s-hi" fill="none" strokeWidth="2.2" strokeLinecap="round" opacity=".75" d="M64 -85L84 -80" />
            </g>
          </g>
        </g>
        <circle cx="58" cy="-50" r="10" fill={u("ball")} className="s-ink" strokeWidth="3.6" />
        <circle cx="54.6" cy="-53.6" r="2.8" className="f-white" opacity=".85" />
      </g>
    </g>
  );
}

function HeroSvg() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="as-hero-svg"
      viewBox="0 0 220 270"
      aria-hidden="true"
      focusable="false"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <defs>
        {/* one silhouette group, reused as the beetle's shadow: body shapes carry stroke="none" (fill from the
            <use>), legs carry fill="none" (stroke from the <use>) */}
        <g id={id("sil")}>
          <path stroke="none" d={SHELL} />
          <path stroke="none" d={PRONOTUM} />
          <ellipse stroke="none" cx="0" cy="-55" rx="17.5" ry="14.5" />
          <path fill="none" strokeWidth="10" d={LEG_L} />
          <path fill="none" strokeWidth="10" transform="scale(-1 1)" d={LEG_L} />
        </g>
        {HERO_GRADS.map((g) => (
          <Gradient key={g.key} g={g} gid={id(g.key)} />
        ))}
      </defs>
      <g className="h-card">
        <g className="h-float">
          <g transform="rotate(-4 110 135)">
            <rect x="12" y="13" width="204" height="252" rx="15" className="f-edge s-ink" strokeWidth="5" />
            <rect x="8" y="6" width="204" height="252" rx="15" fill={u("card")} className="s-ink" strokeWidth="5" />
            <path className="s-white" fill="none" strokeWidth="3.2" strokeLinecap="round" opacity=".85" d="M17 44V26Q17 15 28 15H150" />
            <rect x="24" y="22" width="172" height="176" rx="9" fill={u("mat")} className="s-ink" strokeWidth="3" strokeOpacity=".6" />
            <path className="s-ink" fill="none" strokeWidth="4.4" strokeLinecap="round" opacity=".14" d="M27 78V32Q27 25 34 25H120" />
            <path className="s-white" fill="none" strokeWidth="3" strokeLinecap="round" opacity=".7" d="M193 140V188Q193 195 186 195H120" />
            <rect x="30" y="207" width="156" height="38" rx="6" className="f-white s-ink" strokeWidth="3" />
            <path className="s-ink" fill="none" strokeWidth="5.4" strokeLinecap="round" opacity=".55" d="M43 220H120" />
            <path className="s-ink" fill="none" strokeWidth="5.4" strokeLinecap="round" opacity=".28" d="M43 233H94" />
            <circle cx="166" cy="226" r="9" fill={u("dot")} className="s-ink" strokeWidth="3" />
            <circle cx="163" cy="222.6" r="2.4" className="f-white" opacity=".8" />
            <g className="h-bug">
              <g transform="translate(110 125) scale(.83) rotate(-3)">
                <use href={"#" + id("sil")} className="f-drop" transform="translate(9 13)" />
                <g className="h-bugbody">
                  <Beetle />
                </g>
                <Pin />
              </g>
            </g>
            <path className="f-sheen" d="M24 31Q24 22 33 22H132L24 150Z" />
            <path className="s-white" fill="none" strokeWidth="2" strokeLinecap="round" opacity=".5" d="M141 22L24 158" />
            <g className="h-tape" transform="translate(27 12) rotate(-38)">
              <rect x="-27" y="-10" width="54" height="20" rx="3" fill={u("tape")} className="s-ink" strokeWidth="3" strokeOpacity=".85" />
              <path className="s-white" fill="none" strokeWidth="2" strokeLinecap="round" opacity=".55" d="M-21 -5H12" />
            </g>
          </g>
          <g className="h-sp">
            <g className="h-sp1">
              <path className="f-spark" d={sparkPath(210, 44, 10)} />
            </g>
            <g className="h-sp2">
              <path className="f-spark2" d={sparkPath(6, 152, 6)} />
            </g>
            <g className="h-sp3">
              <path className="f-spark2" d={sparkPath(186, 253, 5)} />
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}

/* ---------------------------------------------------------------------------------------------------------
   THE SCREEN */

function FlagIcon() {
  return (
    <svg className="as-flag" viewBox="0 0 24 28" aria-hidden="true" focusable="false" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3V25" className="s-ink" fill="none" strokeWidth="3.6" />
      <path d="M6 3V25" className="s-brass" fill="none" strokeWidth="1.6" />
      <path d="M7.5 4.5L22 9.2L7.5 14.4Z" className="f-flag s-ink" strokeWidth="2.4" />
      <path d="M9.8 7.5L16.4 9.5" className="s-white" fill="none" strokeWidth="1.4" opacity=".8" />
    </svg>
  );
}

function ChevronDot() {
  return (
    <svg className="as-cv" viewBox="0 0 20 20" aria-hidden="true" focusable="false" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="8.6" className="f-brassdot s-ink" strokeWidth="1.8" />
      <path d="M8 6.4L11.8 10L8 13.6" className="s-ink" fill="none" strokeWidth="2.4" />
      <path d="M4.6 7.6Q6 4.6 9 4" className="s-white" fill="none" strokeWidth="1.4" opacity=".7" />
    </svg>
  );
}

function Tick() {
  return (
    <svg className="as-tk" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 12.6L10.4 17L18.4 7.6" pathLength={1} />
    </svg>
  );
}

const SHACKLE = "M8.4 14V9.6A5.6 5.6 0 0 1 19.6 9.6V14";

function LockIcon() {
  return (
    <svg className="as-lock" viewBox="0 0 28 32" aria-hidden="true" focusable="false" strokeLinecap="round" strokeLinejoin="round">
      <g className="as-shackle">
        <path className="s-ink" fill="none" strokeWidth="7" d={SHACKLE} />
        <path className="s-silver" fill="none" strokeWidth="3" d={SHACKLE} />
      </g>
      <rect x="3" y="13" width="22" height="16" rx="4.6" className="f-lockbody s-ink" strokeWidth="2.8" />
      <path d="M6.4 16.6H17" className="s-white" fill="none" strokeWidth="1.8" opacity=".85" />
      <circle cx="14" cy="20.6" r="2.5" className="f-ink" />
      <path d="M14 21.4V25" className="s-ink" fill="none" strokeWidth="2.4" />
    </svg>
  );
}

/* a small chain: five interlocked links, woven (each ring passes over its neighbour at the top crossing and under
   it at the bottom one). Every ring is a group so the links can be reeled in and close. */
function ChainIcon() {
  const over = [1, 2, 3, 4];
  return (
    <svg className="as-chain-svg" viewBox="0 0 136 30" aria-hidden="true" focusable="false" strokeLinecap="round" strokeLinejoin="round">
      <defs>
        <linearGradient id={id("ch")} x1={0} y1={0} x2={0} y2={1}>
          <Stops list={CHAIN_STOPS} />
        </linearGradient>
        <g id={id("rg")}>
          <rect x="-15" y="4.6" width="30" height="20.8" rx="10.4" fill="none" className="s-ink" strokeWidth="10" />
          <rect x="-15" y="4.6" width="30" height="20.8" rx="10.4" fill="none" stroke={u("ch")} strokeWidth="6" />
          <path d="M-14.6 14Q-14 8 -8 6.4" fill="none" className="s-white" strokeWidth="1.8" opacity=".9" />
        </g>
        {over.map((k) => {
          const c = chainClip(k);
          return (
            <clipPath key={k} id={id("c" + k)}>
              <rect x={c.x} y="0" width={c.width} height="15" />
            </clipPath>
          );
        })}
      </defs>
      {CHAIN_CX.map((cx, k) => (
        <g key={"b" + k} className={"as-lk as-lk" + (k + 1)}>
          <use href={"#" + id("rg")} x={cx} />
        </g>
      ))}
      {over.map((k) => (
        <g key={"o" + k} className={"as-lk as-lk" + k}>
          <use href={"#" + id("rg")} x={CHAIN_CX[k - 1]} clipPath={u("c" + k)} />
        </g>
      ))}
    </svg>
  );
}

function Squiggle() {
  return (
    <svg className="as-sq" viewBox="0 0 54 6" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M0 3Q4.5 -.6 9 3T18 3T27 3T36 3T45 3T54 3" />
    </svg>
  );
}

function Code() {
  return (
    <>
      {CODE.map(([indent, segs, flaw], i) => (
        <div
          key={i}
          className={"as-ln" + (flaw ? " is-flaw" : "")}
          style={{ "--i": i, "--in": indent } as CSSProperties}
        >
          <span className="as-gut">{flaw ? <FlagIcon /> : <b />}</span>
          {segs.map(([w, kind], j) => (
            <i key={j} className={"as-s " + kind} style={{ "--w": w, "--j": j } as CSSProperties}>
              {flaw && kind === "f" ? <Squiggle /> : null}
            </i>
          ))}
        </div>
      ))}
    </>
  );
}

export default function AssignmentArt({ side, vars }: DioProps) {
  const t = useTranslations("aboutPage.art.assignment");
  const ts = useTranslations("siteAbout.art.assignment");
  const steps = [t("events.opened"), t("events.asked"), t("events.logged"), t("chips.flaw")];

  return (
    <div className="dio dio-assignment" data-side={side} style={vars}>
      <div className="bz">
        <div className="gl">
          <div className="as-win">
            <header className="as-bar">
              <span className="as-led" aria-hidden="true" />
              <p className="as-title">{t("surfaceTitle")}</p>
              <span className="as-chain" aria-hidden="true">
                <ChainIcon />
              </span>
              <p className="as-seal">
                <LockIcon />
                <span>{t("meta")}</span>
              </p>
              <span className="as-glint" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path className="f-spark" d={sparkPath(12, 12, 11)} />
                </svg>
              </span>
            </header>
            <div className="as-body">
              <div className="as-ed">
                <div className="as-tabs" aria-hidden="true">
                  <i className="as-tab is-on" />
                  <i className="as-tab" />
                </div>
                <div className="as-code" aria-hidden="true">
                  <Code />
                </div>
                <div className="as-status">
                  <i className="as-sb" aria-hidden="true" />
                  <i className="as-sb as-sb2" aria-hidden="true" />
                  <span className="as-ai sil">
                    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                      <path
                        d="M4.6 10.6L8.4 14.4L15.6 6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    {ts("aiAllowed")}
                  </span>
                </div>
              </div>
              <div className="as-side">
                <section className="as-prompts">
                  <p className="as-h">
                    <span className="as-rec" aria-hidden="true" />
                    {t("chips.prompts")}
                  </p>
                  <ul className="as-pills" aria-hidden="true">
                    {PILL_W.map((w, i) => (
                      <li key={i} className="as-pill" style={{ "--w": w + "%", "--d": pillDelay(i) } as CSSProperties}>
                        <ChevronDot />
                        <i className="as-pb" />
                        <i className="as-pb as-pb2" />
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="as-log">
                  <p className="as-h2 sil">{ts("logTitle")}</p>
                  <ol className="as-steps">
                    {steps.map((label, i) => (
                      <li key={i} className="as-st" style={{ "--n": i } as CSSProperties}>
                        <span className="as-node">
                          <Tick />
                        </span>
                        <span className="as-lbl">{label}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="dio-hero dio-hero--a" aria-hidden="true">
        <HeroSvg />
      </div>
    </div>
  );
}
