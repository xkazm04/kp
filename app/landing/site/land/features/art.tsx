import type { ReactNode } from "react";
import type { FeatureKey } from "./featureData";
import { SAMPLE } from "./sample";

/*
 * The nine medallions (prototype land/art.js): flat drawn key art, never a
 * screenshot, always aria-hidden. The same drawing serves the ring, the scene's
 * big art and its "Look closer" thumbnail; the micro-motion (doors, dial, waves,
 * bubbles, radar sweep, seal, tick) is CSS in css/land-scene.css, keyed on the
 * class names below, and calms itself under prefers-reduced-motion there.
 * Numerals in the drawings (the 87 dial, the medallist's 2) are sample figures
 * from ./sample, not copy.
 */
const INK = "#17202a";
const CREAM = "#fdf8ee";
const CORAL = "#d65a4a";
const AMBER = "#caa54c";
const MOSS = "#526b4f";
const LIME = "#dce7d0";
const STEEL = "#42606f";
const DISP = "Bricolage Grotesque,Trebuchet MS,Segoe UI,sans-serif";

const f1 = (n: number) => n.toFixed(1);

function Ticks({ cx, cy, r1, r2, n, stroke, w, op = 1 }: { cx: number; cy: number; r1: number; r2: number; n: number; stroke: string; w: number; op?: number }) {
  const lines: ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    lines.push(
      <line
        key={i}
        x1={f1(cx + Math.cos(a) * r1)}
        y1={f1(cy + Math.sin(a) * r1)}
        x2={f1(cx + Math.cos(a) * r2)}
        y2={f1(cy + Math.sin(a) * r2)}
        stroke={stroke}
        strokeWidth={w}
        strokeLinecap="round"
        opacity={op}
      />
    );
  }
  return <>{lines}</>;
}

function wavy(cx: number, cy: number, r: number, bumps: number, amp: number): string {
  let d = "";
  const N = 72;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const rr = r + amp * Math.sin(a * bumps);
    d += (i ? "L" : "M") + f1(cx + Math.cos(a) * rr) + " " + f1(cy + Math.sin(a) * rr);
  }
  return d + "Z";
}

function Medallion({ ground, cls, children }: { ground: string; cls: string; children: ReactNode }) {
  return (
    <svg className={`art ${cls}`} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <circle cx="100" cy="100" r="94" fill={ground} stroke={INK} strokeWidth="4" />
      <circle cx="100" cy="100" r="84" fill="none" stroke="#fff" strokeOpacity=".28" strokeWidth="2" strokeDasharray="2 7" strokeLinecap="round" />
      <path d="M26 86A76 76 0 0 1 92 27" fill="none" stroke="#fff" strokeOpacity=".3" strokeWidth="7" strokeLinecap="round" />
      {children}
    </svg>
  );
}

function InboxArt() {
  const xs = [38, 69, 100, 131, 162];
  const ys = [58, 46, 40, 46, 58];
  const tones = [LIME, CREAM, CORAL, CREAM, LIME];
  return (
    <Medallion ground="#3b7f7d" cls="a-inbox">
      {xs.map((x, i) => (
        <g key={i}>
          <path d={`M${x} ${ys[i] + 36}Q${x} 118 100 126`} fill="none" stroke={CREAM} strokeWidth="2.6" strokeDasharray="1 6" strokeLinecap="round" opacity=".9" />
          <g className={`door d${i}`} transform={`translate(${x} ${ys[i]})`}>
            <path d="M-11 30V2a11 11 0 0 1 22 0v28Z" fill={tones[i]} stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
            <circle cx="5" cy="17" r="2.2" fill={INK} />
          </g>
        </g>
      ))}
      <path d="M54 128H146L136 162H64Z" fill={CREAM} stroke={INK} strokeWidth="4" strokeLinejoin="round" />
      <rect className="paper" x="72" y="116" width="56" height="18" rx="3" fill={LIME} stroke={INK} strokeWidth="3" />
      <path d="M80 125h24M80 130h16" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
    </Medallion>
  );
}

function ScoreArt() {
  return (
    <Medallion ground={MOSS} cls="a-score">
      <Ticks cx={100} cy={102} r1={64} r2={70} n={24} stroke={CREAM} w={3} op={0.55} />
      <circle cx="100" cy="102" r="50" fill="none" stroke={CREAM} strokeOpacity=".3" strokeWidth="15" />
      <circle className="arc" cx="100" cy="102" r="50" fill="none" stroke={LIME} strokeWidth="15" strokeLinecap="round" strokeDasharray="273.3 314.2" transform="rotate(-90 100 102)" />
      <circle cx="100" cy="102" r="30" fill={INK} />
      <text x="100" y="114" textAnchor="middle" fontFamily={DISP} fontWeight="800" fontSize="34" fill={CREAM}>
        {SAMPLE.fit}
      </text>
      <g transform="translate(150 48)">
        <circle r="15" fill={CORAL} stroke={INK} strokeWidth="3.5" />
        <path d="M-6 0l4.5 5 8-9.5" fill="none" stroke={CREAM} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </Medallion>
  );
}

function RediscoverArt() {
  return (
    <Medallion ground="#8fa39a" cls="a-redis">
      <g transform="rotate(-6 100 140)">
        <rect x="52" y="124" width="96" height="44" rx="6" fill={LIME} stroke={INK} strokeWidth="3.5" />
      </g>
      <g transform="rotate(4 100 136)">
        <rect x="50" y="114" width="100" height="44" rx="6" fill={CREAM} stroke={INK} strokeWidth="3.5" />
        <path d="M62 128h40M62 139h26" stroke={STEEL} strokeWidth="3.5" strokeLinecap="round" />
      </g>
      <g className="medal-float">
        <path d="M84 86l-10 30 14-6 8 12 6-40z" fill={CORAL} stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
        <path d="M116 86l10 30-14-6-8 12-6-40z" fill={STEEL} stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
        <circle cx="100" cy="68" r="30" fill="#e8eef0" stroke={INK} strokeWidth="4" />
        <circle cx="100" cy="68" r="21" fill="none" stroke="#9aa9b0" strokeWidth="3" strokeDasharray="2 5" strokeLinecap="round" />
        <text x="100" y="79" textAnchor="middle" fontFamily={DISP} fontWeight="800" fontSize="30" fill={INK}>
          {SAMPLE.medallistRank}
        </text>
      </g>
      <path d="M40 60c-8 10-8 26 0 36" fill="none" stroke={CREAM} strokeWidth="4" strokeLinecap="round" />
      <path d="M36 88l4 9 9-3" fill="none" stroke={CREAM} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </Medallion>
  );
}

function VoiceArt() {
  return (
    <Medallion ground={CORAL} cls="a-voice">
      <g className="waves">
        <path className="w1" d="M58 78a44 44 0 0 0 0 44" fill="none" stroke={CREAM} strokeWidth="5" strokeLinecap="round" />
        <path className="w2" d="M44 68a60 60 0 0 0 0 64" fill="none" stroke={CREAM} strokeWidth="5" strokeLinecap="round" opacity=".7" />
        <path className="w1" d="M142 78a44 44 0 0 1 0 44" fill="none" stroke={CREAM} strokeWidth="5" strokeLinecap="round" />
        <path className="w2" d="M156 68a60 60 0 0 1 0 64" fill="none" stroke={CREAM} strokeWidth="5" strokeLinecap="round" opacity=".7" />
      </g>
      <rect x="82" y="44" width="36" height="66" rx="18" fill={CREAM} stroke={INK} strokeWidth="4" />
      <path d="M90 62h20M90 72h20M90 82h20" stroke={CORAL} strokeWidth="3" strokeLinecap="round" opacity=".8" />
      <path d="M70 96a30 30 0 0 0 60 0" fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" />
      <path d="M100 126v22M80 150h40" stroke={INK} strokeWidth="5" strokeLinecap="round" />
    </Medallion>
  );
}

function CasesArt() {
  return (
    <Medallion ground="#7a5478" cls="a-cases">
      <path d="M75 116H125L137 131Q143 152 122 153H78Q57 152 63 131Z" fill={LIME} />
      <path d="M88 38H112M92 38V80L64 132Q56 154 80 155H120Q144 154 136 132L108 80V38" fill="none" stroke={INK} strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" />
      <g className="bubbles">
        <circle className="bb1" cx="88" cy="138" r="5" fill={CREAM} />
        <circle className="bb2" cx="106" cy="130" r="4" fill={CREAM} />
        <circle className="bb3" cx="118" cy="142" r="3.4" fill={CREAM} />
      </g>
      <g className="bug" transform="translate(148 64)">
        <circle r="24" fill="none" stroke={CREAM} strokeWidth="3.5" strokeDasharray="3 5" strokeLinecap="round" />
        <ellipse rx="10" ry="13" fill={CORAL} stroke={INK} strokeWidth="3.5" />
        <circle cy="-15" r="5.5" fill={INK} />
        <path d="M-10 -4l-9 -5M-10 4l-10 1M-9 11l-8 6M10 -4l9 -5M10 4l10 1M9 11l8 6M-3 -20l-4 -6M3 -20l4 -6" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      </g>
      <path d="M46 64l10 10 20-24" fill="none" stroke={LIME} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    </Medallion>
  );
}

function ScheduleArt() {
  const cells: ReactNode[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      const picked = r === 1 && c === 2;
      cells.push(
        <rect
          key={`${r}-${c}`}
          className={picked ? "pick" : ""}
          x={56 + c * 24}
          y={92 + r * 20}
          width="18"
          height="14"
          rx="3"
          fill={picked ? MOSS : LIME}
          stroke={INK}
          strokeWidth={picked ? 3 : 2}
        />
      );
    }
  }
  return (
    <Medallion ground="#4f6d8f" cls="a-sched">
      <rect x="42" y="50" width="116" height="106" rx="12" fill={CREAM} stroke={INK} strokeWidth="4" />
      <path d="M42 62a12 12 0 0 1 12-12h92a12 12 0 0 1 12 12v18H42Z" fill={CORAL} stroke={INK} strokeWidth="4" strokeLinejoin="round" />
      <rect x="66" y="40" width="8" height="20" rx="4" fill={INK} />
      <rect x="126" y="40" width="8" height="20" rx="4" fill={INK} />
      <circle cx="66" cy="68" r="4" fill={CREAM} />
      <circle cx="82" cy="68" r="4" fill={CREAM} opacity=".6" />
      <circle cx="98" cy="68" r="4" fill={CREAM} opacity=".6" />
      {cells}
      <path className="cursor" d="M114 120l0 22 6-6 5 12 6-3-5-11 9 0z" fill={INK} stroke={CREAM} strokeWidth="2" strokeLinejoin="round" />
    </Medallion>
  );
}

function SalaryArt() {
  return (
    <Medallion ground="#c9a13f" cls="a-salary">
      <circle cx="100" cy="90" r="62" fill={INK} />
      <circle cx="100" cy="90" r="44" fill="none" stroke={LIME} strokeOpacity=".45" strokeWidth="2" />
      <circle cx="100" cy="90" r="27" fill="none" stroke={LIME} strokeOpacity=".45" strokeWidth="2" />
      <circle cx="100" cy="90" r="10" fill="none" stroke={LIME} strokeOpacity=".45" strokeWidth="2" />
      <path d="M38 90h124M100 28v124" stroke={LIME} strokeOpacity=".3" strokeWidth="2" />
      <g className="sweep">
        <path d="M100 90V28A62 62 0 0 1 152 56Z" fill={LIME} fillOpacity=".5" />
        <path d="M100 90V28" stroke={LIME} strokeWidth="3" strokeLinecap="round" />
      </g>
      <circle cx="128" cy="68" r="5" fill={CORAL} />
      <circle cx="78" cy="110" r="4.5" fill={CREAM} />
      <circle cx="112" cy="116" r="4" fill={CORAL} />
      <rect x="58" y="164" width="84" height="14" rx="7" fill={CREAM} stroke={INK} strokeWidth="3.5" />
      <rect x="80" y="164" width="40" height="14" fill={MOSS} stroke={INK} strokeWidth="3.5" />
      <path d="M100 150l-7 10h14z" fill={CORAL} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
    </Medallion>
  );
}

const SEAL_PATH = wavy(0, 0, 27, 10, 2.6);

function OfferArt() {
  return (
    <Medallion ground="#9c3d3a" cls="a-offer">
      <g transform="rotate(-5 100 96)">
        <rect x="50" y="38" width="98" height="116" rx="7" fill={CREAM} stroke={INK} strokeWidth="4" />
        <path d="M64 60h44M64 74h60M64 88h52" stroke={STEEL} strokeWidth="4.5" strokeLinecap="round" opacity=".75" />
        <path d="M64 128c8-14 14 8 22-4s10-6 16 0" fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
        <path d="M64 140h48" stroke={INK} strokeWidth="2" opacity=".5" />
      </g>
      <g className="seal" transform="translate(132 136)">
        <path d="M-14 22l-8 22 12-6 6 10 6-24z" fill={CORAL} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        <path d="M14 22l8 22-12-6-6 10-6-24z" fill={AMBER} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        <path d={SEAL_PATH} fill={CORAL} stroke={INK} strokeWidth="4" strokeLinejoin="round" />
        <circle r="16" fill="none" stroke={INK} strokeOpacity=".55" strokeWidth="2.5" />
        <path d="M-8 0l6 6 11-13" fill="none" stroke={CREAM} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </Medallion>
  );
}

function GatesArt() {
  return (
    <Medallion ground="#1d2a37" cls="a-gates">
      <path d="M96 34L146 52V96C146 128 124 148 96 162 68 148 46 128 46 96V52Z" fill={MOSS} stroke={LIME} strokeWidth="5" strokeLinejoin="round" />
      <path className="tick" d="M74 98l16 16 32-36" fill="none" stroke={CREAM} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      <g transform="translate(150 116)">
        <path d="M-16 -38H16V34l-5.3-6-5.4 6-5.3-6-5.4 6-5.3-6-5.3 6z" fill={CREAM} stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
        <path d="M-9 -26h18M-9 -16h18M-9 -6h12" stroke={STEEL} strokeWidth="3.5" strokeLinecap="round" />
      </g>
      <g transform="translate(46 150)">
        <circle r="14" fill={CORAL} stroke={CREAM} strokeWidth="3.5" />
        <path d="M0 -6v7" stroke={CREAM} strokeWidth="4" strokeLinecap="round" />
      </g>
    </Medallion>
  );
}

const ART: Record<FeatureKey, () => ReactNode> = {
  inbox: InboxArt,
  score: ScoreArt,
  rediscover: RediscoverArt,
  voice: VoiceArt,
  cases: CasesArt,
  schedule: ScheduleArt,
  salary: SalaryArt,
  offer: OfferArt,
  gates: GatesArt
};

/** The medallion drawing for one feature. */
export function FeatureArt({ feature }: { feature: FeatureKey }) {
  const Art = ART[feature];
  return <Art />;
}
