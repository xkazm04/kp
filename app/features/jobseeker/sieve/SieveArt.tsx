import { useId, type CSSProperties } from "react";

// The Arrive hero's illustration: the Sieve as a picture of itself. Postings rain into a
// meshed funnel, most of them are caught on the mesh (the gates, each named in the
// landing's hand), and a handful fall through into the tray - "the few worth your
// evening". Decoration: the whole drawing is aria-hidden, and the words it carries are
// the catalog's (passed in), so it speaks the reader's language.
//
// Motion is CSS (sieve.css "hero art"): every dot rests at its FINAL position in the
// markup and falls into it from above on a loop, so a reader who asked for reduced
// motion - and a browser that runs no animation at all - sees the finished composition,
// never an empty funnel. Colours are the flow's tokens, so both themes draw it.

type Dot = { x: number; y: number };

// Caught on the mesh: the funnel's walls are x = 145 + 0.7·(y − 210) and its mirror, so
// every resting place below sits inside them. The canvas is wider than the funnel so the
// hand-written gate names sit OUTSIDE its walls, each pointing in.
const CAUGHT: Dot[] = [
  { x: 202, y: 250 }, { x: 236, y: 262 }, { x: 272, y: 248 }, { x: 310, y: 259 }, { x: 350, y: 247 },
  { x: 390, y: 261 }, { x: 428, y: 252 }, { x: 456, y: 244 }, { x: 220, y: 290 }, { x: 260, y: 301 },
  { x: 300, y: 288 }, { x: 342, y: 299 }, { x: 382, y: 290 }, { x: 416, y: 284 }, { x: 252, y: 333 },
  { x: 289, y: 342 }, { x: 328, y: 331 }, { x: 369, y: 339 }, { x: 310, y: 374 },
];
// Through: the tray. Tier colours in rank order - two strong, two promising, one more.
const PASSED: { x: number; tone: "strong" | "promising" }[] = [
  { x: 267, tone: "strong" },
  { x: 293, tone: "strong" },
  { x: 319, tone: "promising" },
  { x: 345, tone: "promising" },
  { x: 371, tone: "strong" },
];
const TRAY_Y = 503;
const RAIN_TOP = 34;

export function SieveArt({ labels }: { labels: { mode: string; level: string; pay: string; few: string } }) {
  const mesh = `sv-mesh-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg className="sieve-art" viewBox="0 0 640 600" aria-hidden focusable="false">
      <defs>
        <pattern id={mesh} width="14" height="14" patternUnits="userSpaceOnUse">
          <path d="M14 0H0V14" className="art-mesh" />
        </pattern>
      </defs>
      <circle cx="320" cy="300" r="238" className="art-halo" />

      {/* the funnel: body, mesh, rim, spout */}
      <path d="M145 210 L285 410 L355 410 L495 210 Z" className="art-body" />
      <path d="M145 210 L285 410 L355 410 L495 210 Z" fill={`url(#${mesh})`} className="art-meshfill" />
      <path d="M145 210 L285 410 M495 210 L355 410" className="art-wall" />
      <ellipse cx="320" cy="210" rx="175" ry="30" className="art-rim" />
      <path d="M285 410 L285 446 M355 410 L355 446" className="art-wall" />

      {/* caught: each dot falls onto the mesh and stays, greyed */}
      {CAUGHT.map((d, i) => (
        <circle key={`c${i}`} cx={d.x} cy={d.y} r="8.5" className="art-dot caught" style={{ "--i": i, "--from": `${RAIN_TOP - d.y}px` } as CSSProperties} />
      ))}

      {/* the tray, and the few that came through */}
      <rect x="230" y="478" width="180" height="50" rx="25" className="art-tray" />
      {PASSED.map((d, i) => (
        <g key={`p${i}`} className="art-pass" style={{ "--i": i, "--from": `${RAIN_TOP - TRAY_Y}px` } as CSSProperties}>
          <circle cx={d.x} cy={TRAY_Y} r="15" className={`art-glow ${d.tone}`} />
          <circle cx={d.x} cy={TRAY_Y} r="9.5" className={`art-dot ${d.tone}`} />
        </g>
      ))}

      {/* the gates, named in the hand - outside the walls, each pointing at the mesh */}
      <g className="art-note">
        <path d="M138 262 C 158 262, 176 260, 196 254" className="art-arrow" />
        <text x="130" y="268" textAnchor="end">
          {labels.mode}
        </text>
        <path d="M508 300 C 490 300, 468 298, 424 290" className="art-arrow" />
        <text x="514" y="306">{labels.level}</text>
        <path d="M206 372 C 226 366, 240 356, 250 342" className="art-arrow" />
        <text x="198" y="382" textAnchor="end">
          {labels.pay}
        </text>
        <path d="M424 506 C 440 512, 452 524, 458 540" className="art-arrow" />
        <text x="460" y="566" textAnchor="middle" className="art-few">
          {labels.few}
        </text>
      </g>
    </svg>
  );
}
