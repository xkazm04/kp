"use client";

import { useRef, useState, type CSSProperties, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { reducedMotionNow, useDioEnter, type DioProps, type Side } from "./dio";
import {
  BOWL,
  DIGITS,
  INK,
  KO_CARDS,
  OK_CARDS,
  RANK_CARDS,
  TEETH,
  cardTile,
  rankCardGeom,
  sparkD,
  type RankCardSpec,
} from "./source-geom";

/*
 * STEP 02 - SOURCE. "One role, a ranked shortlist." Port of the prototype's
 * about-art/s2-source.js: a pool of paper CV cards drifts down a funnel toward a
 * comb of knock-out gates; the cards the gates stop turn dashed and hatched
 * (knocked out, not deleted); three survivors slide out and land as a ranked
 * list whose bars fill to their scores. Hero: a brass-and-silver sieve with three
 * cards rising out of it, each wearing a rank ribbon. Every drawing is
 * aria-hidden; styles live in ../../css/about-s2-source.css.
 */

/** One drawing per page, so the SVG ids carry a fixed prefix. */
const P = "dio-source-";
const url = (id: string) => `url(#${P}${id})`;

type RoleKey = "backend" | "fullStack";

/* Sample people, tech tags and scores: data, not copy. */
const SHORTLIST: readonly { rank: string; name: string; role: { key: RoleKey } | { tag: string }; score: number }[] = [
  { rank: "1", name: "Jana N.", role: { key: "backend" }, score: 88 },
  { rank: "2", name: "Petr K.", role: { key: "fullStack" }, score: 74 },
  { rank: "3", name: "Alex T.", role: { tag: "Java" }, score: 61 },
];
const FINAL_SCORES = SHORTLIST.map((r) => r.score);
const COUNT_DELAY_MS = 2350;
const COUNT_MS = 1000;

type Vars = CSSProperties & Record<`--${string}`, string | number>;

function Spark({ x, y, r, cls }: { x: number; y: number; r: number; cls: string }) {
  return <path className={cls} d={sparkD(x, y, r)} />;
}

/* ---------- the funnel: pool cards, comb of gates, hatched knock-outs (viewBox 0 0 146 150) ---------- */
function CardBody({ i }: { i: number }) {
  return (
    <>
      <rect x="-11" y="-14" width="22" height="28" rx="3.2" fill={url("pp")} stroke={INK} strokeWidth="2.4" />
      <rect x="-8" y="-11" width="7" height="7" rx="2" fill={cardTile(i)} stroke={INK} strokeOpacity=".55" strokeWidth="1.4" />
      <path d="M1 -9H8M-8 -0.5H8M-8 4.5H8M-8 9H2" stroke={INK} strokeOpacity=".5" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M-9 -12.4H6" stroke="#fff" strokeOpacity=".85" strokeWidth="1.4" strokeLinecap="round" />
    </>
  );
}

function CvCard({ x, y, rot, i, ko }: { x: number; y: number; rot: number; i: number; ko: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      {ko ? (
        <g className="sr-c sr-ko" style={{ "--i": i } as Vars}>
          <g className="sr-ko-base">
            <CardBody i={i} />
          </g>
          <g className="sr-ko-mark">
            <rect x="-11" y="-14" width="22" height="28" rx="3.2" fill="#0f1b20" fillOpacity=".24" />
            <rect x="-11" y="-14" width="22" height="28" rx="3.2" fill={url("ht")} />
            <rect x="-12.6" y="-15.6" width="25.2" height="31.2" rx="4.2" fill="none" stroke="#f3ecd9" strokeOpacity=".85" strokeWidth="1.6" strokeDasharray="4 3.4" />
          </g>
        </g>
      ) : (
        <g className="sr-c sr-ok" style={{ "--i": i } as Vars}>
          <CardBody i={i} />
        </g>
      )}
    </g>
  );
}

function FunnelSvg() {
  return (
    <svg viewBox="0 0 146 150" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={P + "pp"} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fffaf0" />
          <stop offset="1" stopColor="#e3d8c1" />
        </linearGradient>
        <linearGradient id={P + "mt"} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4f7f9" />
          <stop offset=".55" stopColor="#b9c1c9" />
          <stop offset="1" stopColor="#7d8994" />
        </linearGradient>
        <linearGradient id={P + "br"} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#f8e5a4" />
          <stop offset=".5" stopColor="#e6c46a" />
          <stop offset="1" stopColor="#a9822f" />
        </linearGradient>
        <linearGradient id={P + "fn"} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#dbe1e6" stopOpacity=".07" />
          <stop offset="1" stopColor="#dbe1e6" stopOpacity=".2" />
        </linearGradient>
        <pattern id={P + "ht"} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <path d="M0 0V5" stroke="#f3ecd9" strokeOpacity=".7" strokeWidth="1.4" />
        </pattern>
      </defs>
      <path d="M2 12 96 48V106L2 138Z" fill={url("fn")} stroke="#dbe1e6" strokeOpacity=".55" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M10 18 90 49" stroke="#fff" strokeOpacity=".35" strokeWidth="2" strokeLinecap="round" />
      <g className="sr-cards">
        {OK_CARDS.map(([x, y, rot], i) => (
          <CvCard key={`ok${i}`} x={x} y={y} rot={rot} i={i} ko={false} />
        ))}
        {KO_CARDS.map(([x, y, rot], i) => (
          <CvCard key={`ko${i}`} x={x} y={y} rot={rot} i={OK_CARDS.length + i} ko />
        ))}
      </g>
      <g className="sr-comb">
        {TEETH.map((d) => (
          <path key={d} d={d} fill={url("mt")} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
        ))}
        <rect x="92" y="34" width="10" height="90" rx="4.6" fill={url("br")} stroke={INK} strokeWidth="2.8" />
        <path d="M95 40V116" stroke="#fff" strokeOpacity=".7" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="97" cy="39" r="1.6" fill={INK} />
        <circle cx="97" cy="119" r="1.6" fill={INK} />
      </g>
      <g className="sr-sp sr-sp1">
        <Spark x={104} y={28} r={6} cls="sr-spf" />
      </g>
    </svg>
  );
}

/* three survivors in flight: small cards leaving the gates */
function Flies() {
  return (
    <>
      {[1, 2, 3].map((n) => (
        <svg key={n} className={`sr-fly sr-fly${n}`} viewBox="-14 -17 28 34" aria-hidden="true" focusable="false">
          <rect x="-11" y="-14" width="22" height="28" rx="3.2" fill="#fffaf0" stroke={INK} strokeWidth="2.6" />
          <path d="M-7 -6H7M-7 -0.5H7M-7 5H1" stroke={INK} strokeOpacity=".5" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M-9 -11.6H5" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      ))}
    </>
  );
}

/* ---------- hero: brass-and-silver sieve with three ranked cards rising out of it (viewBox 0 0 190 190) ---------- */
function RankCard({ spec, digitSign }: { spec: RankCardSpec; digitSign: number }) {
  const { n, x, y, rot, w, h, tails } = spec;
  const g = rankCardGeom(n, w);
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <g className={`sr-hc sr-hc${n}`}>
        <rect x={-g.hw} y="0" width={w} height={h} rx="6" fill={url("hp")} stroke={INK} strokeWidth="3.4" />
        <rect x={-g.hw + 6} y="7" width="15" height="15" rx="4" fill={g.tile} stroke={INK} strokeOpacity=".6" strokeWidth="2" />
        <path d={g.lines} stroke={INK} strokeOpacity=".45" strokeWidth="3" strokeLinecap="round" />
        <path d={g.glint} stroke="#fff" strokeOpacity=".85" strokeWidth="2" strokeLinecap="round" />
        <g className={`sr-rib sr-rib${n}`} transform={g.ribbon}>
          <path d="M-5 8 -9 26 -3 22 1 28 3 10Z" fill={tails[0]} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
          <path d="M3 8 9 26 3 21 -1 28 -3 10Z" fill={tails[1]} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
          <circle cx="0" cy="2" r="12" fill={url("ro" + n)} stroke={INK} strokeWidth="3" />
          <circle cx="0" cy="2" r="8.4" fill="none" stroke={INK} strokeOpacity=".28" strokeWidth="1.4" />
          <g transform={`translate(0 2.4) scale(${0.78 * digitSign} .78)`}>
            <path d={DIGITS[n]} fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </g>
          <path d="M-8 -4Q-6 -8 -1 -8.6" fill="none" stroke="#fff" strokeOpacity=".85" strokeWidth="2" strokeLinecap="round" />
        </g>
      </g>
    </g>
  );
}

function SieveSvg({ side }: { side: Side }) {
  const digitSign = side === "r" ? -1 : 1;
  return (
    <svg viewBox="0 0 190 190" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={P + "hp"} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fffaf0" />
          <stop offset="1" stopColor="#e3d8c1" />
        </linearGradient>
        <linearGradient id={P + "sv"} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f7fafb" />
          <stop offset=".45" stopColor="#c3cbd2" />
          <stop offset="1" stopColor="#77828d" />
        </linearGradient>
        <linearGradient id={P + "bs"} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f8e5a4" />
          <stop offset=".45" stopColor="#e6c46a" />
          <stop offset="1" stopColor="#a9822f" />
        </linearGradient>
        <linearGradient id={P + "hd"} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4f7f9" />
          <stop offset=".5" stopColor="#b9c1c9" />
          <stop offset="1" stopColor="#6f7b86" />
        </linearGradient>
        <radialGradient id={P + "ro1"} cx=".35" cy=".3" r=".8">
          <stop offset="0" stopColor="#fff4c4" />
          <stop offset=".6" stopColor="#e6c46a" />
          <stop offset="1" stopColor="#a9822f" />
        </radialGradient>
        <radialGradient id={P + "ro2"} cx=".35" cy=".3" r=".8">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".6" stopColor="#cfd6dc" />
          <stop offset="1" stopColor="#8a95a0" />
        </radialGradient>
        <radialGradient id={P + "ro3"} cx=".35" cy=".3" r=".8">
          <stop offset="0" stopColor="#eaf5f1" />
          <stop offset=".6" stopColor="#a5d3c8" />
          <stop offset="1" stopColor="#5f9a8e" />
        </radialGradient>
        <radialGradient id={P + "sh"} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#03090c" stopOpacity=".5" />
          <stop offset=".6" stopColor="#03090c" stopOpacity=".18" />
          <stop offset="1" stopColor="#03090c" stopOpacity="0" />
        </radialGradient>
        <pattern id={P + "mh"} width="9" height="9" patternUnits="userSpaceOnUse">
          <circle cx="4.5" cy="4.5" r="2.3" fill="#17202a" fillOpacity=".55" />
        </pattern>
        <clipPath id={P + "bc"}>
          <path d={BOWL} />
        </clipPath>
      </defs>
      <g transform={side === "r" ? "translate(190 0) scale(-1 1)" : undefined}>
        <ellipse cx="112" cy="182" rx="58" ry="7" fill={url("sh")} />
        {/* handle */}
        <g className="sr-handle">
          <path d="M52 106 8 84" stroke={INK} strokeWidth="17" strokeLinecap="round" />
          <path d="M52 106 8 84" stroke={url("hd")} strokeWidth="11" strokeLinecap="round" />
          <path d="M49 100 14 82" stroke="#fff" strokeOpacity=".7" strokeWidth="2.6" strokeLinecap="round" />
          <rect x="36" y="88" width="10" height="24" rx="3" fill={url("bs")} stroke={INK} strokeWidth="3" transform="rotate(-6 41 100)" />
        </g>
        {/* inside of the mouth */}
        <ellipse cx="112" cy="112" rx="62" ry="16" fill="#0f1b20" stroke={INK} strokeWidth="3" />
        <g className="sr-hcs">
          {RANK_CARDS.map((spec) => (
            <RankCard key={spec.n} spec={spec} digitSign={digitSign} />
          ))}
        </g>
        {/* front of the bowl: silver mesh */}
        <path d={BOWL} fill={url("sv")} />
        <g clipPath={url("bc")}>
          <rect x="40" y="108" width="140" height="74" fill={url("mh")} />
          <path d="M60 116Q64 156 96 170" fill="none" stroke="#fff" strokeOpacity=".8" strokeWidth="5" strokeLinecap="round" />
          <path d="M112 112V178M80 112Q86 170 112 178M144 112Q138 170 112 178" fill="none" stroke={INK} strokeOpacity=".16" strokeWidth="2" />
        </g>
        <path d={BOWL} fill="none" stroke={INK} strokeWidth="4.2" strokeLinejoin="round" />
        <path d="M50 112Q112 138 174 112" fill="none" stroke={url("bs")} strokeWidth="10" strokeLinecap="round" />
        <path d="M50 112Q112 138 174 112" fill="none" stroke={INK} strokeOpacity=".9" strokeWidth="1.6" transform="translate(0 5.4)" />
        <path d="M50 112Q112 138 174 112" fill="none" stroke={INK} strokeWidth="1.6" transform="translate(0 -5.4)" />
        <path d="M56 108Q90 118 120 118" fill="none" stroke="#fff" strokeOpacity=".75" strokeWidth="2.4" strokeLinecap="round" />
        <rect x="88" y="174" width="48" height="9" rx="4.5" fill={url("bs")} stroke={INK} strokeWidth="3" />
        <g className="sr-sp sr-sp2">
          <Spark x={174} y={60} r={8} cls="sr-spf" />
        </g>
        <g className="sr-sp sr-sp3">
          <Spark x={24} y={150} r={5} cls="sr-spf2" />
        </g>
      </g>
    </svg>
  );
}

/**
 * The three scores count up as their bars fill, each time the scene (re)enters.
 * The initial state is the final scores, so the server markup already holds them.
 */
function useScoreCountUp(ref: RefObject<HTMLDivElement | null>) {
  const [scores, setScores] = useState<readonly number[]>(FINAL_SCORES);
  useDioEnter(ref, () => {
    if (reducedMotionNow()) {
      setScores(FINAL_SCORES);
      return;
    }
    let raf = 0;
    setScores(FINAL_SCORES.map(() => 0));
    const timer = window.setTimeout(() => {
      let t0 = 0;
      const step = (ts: number) => {
        if (!t0) t0 = ts;
        const k = Math.min(1, (ts - t0) / COUNT_MS);
        const e = 1 - Math.pow(1 - k, 3);
        if (k < 1) {
          setScores(FINAL_SCORES.map((v) => Math.round(v * e)));
          raf = requestAnimationFrame(step);
        } else {
          raf = 0;
          setScores(FINAL_SCORES);
        }
      };
      raf = requestAnimationFrame(step);
    }, COUNT_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      if (raf) cancelAnimationFrame(raf);
    };
  });
  return scores;
}

export default function SourceArt({ side, vars }: DioProps) {
  const t = useTranslations("siteAbout.art.source");
  const ref = useRef<HTMLDivElement>(null);
  const scores = useScoreCountUp(ref);

  return (
    <div className="dio dio-source" data-side={side} style={vars} ref={ref}>
      <div className="bz">
        <div className="gl">
          <div className="sr-grid" aria-hidden="true" />
          <div className="sr-glow" aria-hidden="true" />
          <div className="sr-hd">
            <span className="sil sr-l sr-l-pool">{t("talentPool")}</span>
            <span className="sil sr-l sr-l-gate">{t("knockoutGates")}</span>
          </div>
          <div className="sr-hd sr-hd2">
            <span className="sil sr-l sr-l-rank">{t("ranked")}</span>
            <span className="sil sr-l sr-l-arch">{t("archetypeAware")}</span>
          </div>
          <div className="sr-fun" aria-hidden="true">
            <FunnelSvg />
          </div>
          <div className="sr-flies" aria-hidden="true">
            <Flies />
          </div>
          <ol className="sr-list">
            {SHORTLIST.map((row, i) => (
              <li key={row.rank} className="sr-row" style={{ "--i": i } as Vars}>
                <span className="sr-rk">{row.rank}</span>
                <div className="sr-mid">
                  <p className="sr-nm">
                    {t("candidateRow", {
                      name: row.name,
                      role: "key" in row.role ? t(`roles.${row.role.key}`) : row.role.tag,
                    })}
                  </p>
                  <div className="sr-bar">
                    <i className="sr-trk" />
                    <b className="sr-fill" style={{ "--w": `${row.score}%` } as Vars} />
                    <span className="sr-sc" data-v={row.score}>
                      {scores[i]}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <ul className="sr-pills">
            <li className="sil">{t("deterministic")}</li>
            <li className="sil">{t("explainable")}</li>
          </ul>
        </div>
      </div>
      <div className="dio-hero dio-hero--a" aria-hidden="true">
        <SieveSvg side={side} />
      </div>
    </div>
  );
}
