import type { CSSProperties, ReactNode } from "react";
import { PLATE_MARKS } from "./samples";

/*
 * The three proof plates (prototype land/proof-art.js: A/1's drawings re-inked to
 * the landing's palette). Stylised illustrations, never screenshots; each plate
 * is captioned as such by the band. Pure markup: the band renders each twice, as
 * the sticky plate (desktop) and as the pillar's mini card (phones).
 *
 *   samples  a code card with three planted flaws ringed and numbered, the
 *            prompts beside it, a distance meter
 *   defend   two decision cards (A, B) feeding one microphone, CZ / EN
 *   sealed   four linked blocks, the last one sealed, a signature line
 *
 * The only words drawn are the plate marks (codes, from samples.ts) and the seal
 * plate's "signed by a named human", which comes in translated.
 */

export type ProofArtKey = "samples" | "defend" | "sealed";

/** Each plate's paper, behind the drawing (the prototype's PBG). */
export const PLATE_BG: Record<ProofArtKey, string> = {
  samples: "#f7f1e3",
  defend: "#f3ece0",
  sealed: "#eef2e8"
};

const INK = "#17202a";
const PAPER = "#fffdf8";
const CORAL = "#d65a4a";
const AMBER = "#caa54c";
const MOSS = "#526b4f";
const STEEL = "#42606f";
const LIME = "#dce7d0";

const K = { stroke: INK, strokeWidth: 3, strokeLinejoin: "round", strokeLinecap: "round" } as const;
const K2 = { stroke: INK, strokeWidth: 2.5, strokeLinejoin: "round", strokeLinecap: "round" } as const;
const DISP: CSSProperties = { fontFamily: "var(--f-disp)" };
const BODY: CSSProperties = { fontFamily: "var(--f-body)" };

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 360 270" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

function Star({ x, y, r, fill }: { x: number; y: number; r: number; fill: string }) {
  const s = r * 0.32;
  const d = `M${x} ${y - r} L${x + s} ${y - s} L${x + r} ${y} L${x + s} ${y + s} L${x} ${y + r} L${x - s} ${y + s} L${x - r} ${y} L${x - s} ${y - s} Z`;
  return <path d={d} fill={fill} {...K2} />;
}

/** Text-like bars: n rounded strokes stepping down. */
function Lines({ x, y, n, step, widths, fill, op = 0.35 }: { x: number; y: number; n: number; step: number; widths: number[]; fill: string; op?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <rect key={i} x={x} y={y + i * step} width={widths[i % widths.length]} height="5" rx="2.5" fill={fill} opacity={op} />
      ))}
    </>
  );
}

const CODE_ROWS: [number, number, string][] = [
  [40, 60, STEEL],
  [60, 90, INK],
  [60, 50, MOSS],
  [80, 110, INK],
  [60, 70, INK],
  [40, 40, STEEL],
  [60, 120, INK],
  [80, 64, MOSS],
  [40, 86, INK]
];

function Flaw({ x, y, n }: { x: number; y: number; n: number }) {
  return (
    <>
      <circle cx={x} cy={y} r="14" fill={CORAL} {...K2} />
      <text x={x} y={y + 6} textAnchor="middle" fontWeight="800" fontSize="17" fill={PAPER} style={DISP}>
        {n}
      </text>
    </>
  );
}

function SamplesPlate() {
  return (
    <Svg>
      <rect x="0" y="0" width="360" height="270" fill={PLATE_BG.samples} />
      <rect x="28" y="28" width="206" height="214" rx="12" fill={PAPER} {...K} />
      <path d="M28 40 a12 12 0 0 1 12 -12 h182 a12 12 0 0 1 12 12 v14 h-206 Z" fill={AMBER} {...K} />
      <circle cx="44" cy="41" r="4" fill={INK} />
      <circle cx="58" cy="41" r="4" fill={INK} />
      <circle cx="72" cy="41" r="4" fill={INK} />
      {CODE_ROWS.map(([x, w, fill], i) => (
        <rect key={i} x={x + 12} y={70 + i * 17} width={w} height="7" rx="3.5" fill={fill} opacity={fill === INK ? 0.28 : 0.7} />
      ))}
      <ellipse cx="120" cy="108" rx="66" ry="13" fill="none" stroke={CORAL} strokeWidth="3" strokeDasharray="7 6" />
      <ellipse cx="104" cy="176" rx="58" ry="13" fill="none" stroke={CORAL} strokeWidth="3" strokeDasharray="7 6" />
      <ellipse cx="116" cy="210" rx="52" ry="12" fill="none" stroke={CORAL} strokeWidth="3" strokeDasharray="7 6" />
      <Flaw x={196} y={108} n={1} />
      <Flaw x={172} y={176} n={2} />
      <Flaw x={180} y={210} n={3} />
      <g transform="rotate(3 290 110)">
        <rect x="248" y="40" width="96" height="136" rx="12" fill={LIME} {...K} />
        <rect x="260" y="56" width="72" height="22" rx="8" fill={PAPER} {...K2} />
        <rect x="268" y="64" width="44" height="5" rx="2.5" fill={INK} opacity=".4" />
        <rect x="260" y="88" width="72" height="22" rx="8" fill={PAPER} {...K2} />
        <rect x="268" y="96" width="56" height="5" rx="2.5" fill={INK} opacity=".4" />
        <rect x="260" y="120" width="72" height="22" rx="8" fill={PAPER} {...K2} />
        <rect x="268" y="128" width="36" height="5" rx="2.5" fill={INK} opacity=".4" />
        <circle cx="332" cy="46" r="10" fill={AMBER} {...K2} />
      </g>
      <rect x="252" y="200" width="92" height="14" rx="7" fill={PAPER} {...K2} />
      <rect x="254" y="202" width="58" height="10" rx="5" fill={MOSS} />
      <path d="M312 192 v30" stroke={CORAL} strokeWidth="4" strokeLinecap="round" />
      <Star x={318} y={234} r={9} fill={AMBER} />
    </Svg>
  );
}

function DecisionCard({ x, tone, dot, mark, turn }: { x: number; tone: string; dot: string; mark: string; turn: string }) {
  return (
    <g transform={turn}>
      <rect x={x} y="44" width="116" height="84" rx="8" fill={PAPER} {...K} />
      <rect x={x + 12} y="58" width="30" height="24" rx="6" fill={tone} {...K2} />
      <text x={x + 27} y="76" textAnchor="middle" fontWeight="800" fontSize="17" fill={PAPER} style={DISP}>
        {mark}
      </text>
      <Lines x={x + 50} y={62} n={2} step={11} widths={[54, 40]} fill={INK} op={0.35} />
      <Lines x={x + 12} y={96} n={2} step={11} widths={[90, 70]} fill={INK} op={0.3} />
      <circle cx={x + 58} cy="46" r="7" fill={dot} {...K2} />
    </g>
  );
}

function DefendPlate() {
  return (
    <Svg>
      <rect x="0" y="0" width="360" height="270" fill={PLATE_BG.defend} />
      <rect x="20" y="22" width="320" height="130" rx="14" fill="#e3cf94" {...K} />
      <rect x="30" y="32" width="300" height="110" rx="10" fill="#f0e2b6" opacity=".6" />
      <DecisionCard x={44} tone={CORAL} dot={STEEL} mark={PLATE_MARKS.a} turn="rotate(-4 100 86)" />
      <DecisionCard x={200} tone={STEEL} dot={CORAL} mark={PLATE_MARKS.b} turn="rotate(5 260 86)" />
      <path
        d="M100 128 C 110 170, 150 170, 170 190 M260 128 C 250 170, 210 170, 190 190"
        fill="none"
        stroke={INK}
        strokeWidth="2.5"
        strokeDasharray="4 6"
        strokeLinecap="round"
      />
      <rect x="160" y="170" width="40" height="62" rx="20" fill={CORAL} {...K} />
      <path d="M146 212 v4 a34 34 0 0 0 68 0 v-4" fill="none" {...K} />
      <path d="M180 250 v12" {...K} />
      <path
        d="M128 206 A60 60 0 0 0 128 240 M232 206 A60 60 0 0 1 232 240"
        fill="none"
        stroke={CORAL}
        strokeWidth="4"
        strokeLinecap="round"
        opacity=".45"
      />
      <rect x="40" y="200" width="60" height="34" rx="12" fill={PAPER} {...K2} />
      <text x="70" y="223" textAnchor="middle" fontWeight="800" fontSize="17" fill={INK} style={BODY}>
        {PLATE_MARKS.cz}
      </text>
      <rect x="262" y="200" width="60" height="34" rx="12" fill={LIME} {...K2} />
      <text x="292" y="223" textAnchor="middle" fontWeight="800" fontSize="17" fill={INK} style={BODY}>
        {PLATE_MARKS.en}
      </text>
    </Svg>
  );
}

function SealedPlate({ signedBy }: { signedBy: string }) {
  const rowY = (i: number) => 64 + (i % 2) * 22;
  return (
    <Svg>
      <rect x="0" y="0" width="360" height="270" fill={PLATE_BG.sealed} />
      {[0, 1, 2].map((i) => {
        const x = 22 + i * 84;
        const y = rowY(i);
        const ny = rowY(i + 1) + 40;
        const d = `M${x + 62} ${y + 40} C ${x + 76} ${y + 40}, ${x + 76} ${ny}, ${x + 88} ${ny}`;
        return (
          <g key={i}>
            <path d={d} fill="none" stroke={INK} strokeWidth="7" strokeLinecap="round" />
            <path d={d} fill="none" stroke={AMBER} strokeWidth="3" strokeLinecap="round" />
          </g>
        );
      })}
      {[0, 1, 2, 3].map((i) => {
        const x = 22 + i * 84;
        const y = rowY(i);
        return (
          <g key={i}>
            <rect x={x} y={y} width="66" height="80" rx="9" fill={i === 3 ? LIME : PAPER} {...K} />
            <rect x={x + 10} y={y + 12} width="30" height="6" rx="3" fill={INK} opacity=".75" />
            <Lines x={x + 10} y={y + 28} n={3} step={11} widths={[46, 36, 42]} fill={STEEL} op={0.4} />
          </g>
        );
      })}
      <circle cx="300" cy="170" r="26" fill="#bf4536" {...K} />
      <circle cx="300" cy="170" r="17" fill="none" stroke="#f3d9cf" strokeWidth="2" opacity=".6" />
      <path d="M290 170 l7 7 l13 -15" fill="none" stroke="#f8e4dc" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M40 222 c 12 -18, 20 6, 32 -6 s 14 -8, 20 2 s 16 -10, 26 -2 s 12 4, 20 -4"
        fill="none"
        stroke={STEEL}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M36 236 H200" stroke={INK} strokeWidth="2.5" opacity=".5" />
      <text x="36" y="258" fontWeight="700" fontSize="15" fill={INK} opacity=".7" style={BODY}>
        {signedBy}
      </text>
    </Svg>
  );
}

export function ProofArt({ art, signedBy }: { art: ProofArtKey; signedBy: string }) {
  if (art === "samples") return <SamplesPlate />;
  if (art === "defend") return <DefendPlate />;
  return <SealedPlate signedBy={signedBy} />;
}
