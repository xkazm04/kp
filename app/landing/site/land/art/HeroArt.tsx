/*
 * The hero's static drawings (prototype index.html `.hero` + the sun-dial ticks
 * app.js drew at start-up): the lit sky with its three cut-paper hills, the sun
 * dial, the eyebrow's spark and the paper-plane knob of the autopilot switch.
 * Pure markup with no hooks, so both the server hero and its client parts use it.
 * Every drawing is decorative (aria-hidden); the copy beside it carries the meaning.
 */

const INK = "#17202a";
const MOSS = "#526b4f";

/** 72 ticks round the dial, every sixth one long: computed once, at module load. */
const SUN_TICKS = Array.from({ length: 72 }, (_, i) => {
  const a = (i / 72) * Math.PI * 2;
  const big = i % 6 === 0;
  const r1 = big ? 318 : 330;
  const r2 = big ? 346 : 344;
  return {
    x1: (400 + Math.cos(a) * r1).toFixed(1),
    y1: (400 + Math.sin(a) * r1).toFixed(1),
    x2: (400 + Math.cos(a) * r2).toFixed(1),
    y2: (400 + Math.sin(a) * r2).toFixed(1),
    op: big ? 0.7 : 0.35,
    w: big ? 5 : 3
  };
});

export function HeroSky() {
  return (
    <div className="sky" aria-hidden="true">
      <div className="glow" />
      <div className="beam" />
      <svg className="hills" viewBox="0 0 3200 320" preserveAspectRatio="xMidYMax slice" focusable="false">
        <g className="hill h-back">
          <path d="M0 320V232C520 222 960 196 1420 144S2360 72 3200 60V320Z" fill="#c7d8b4" />
        </g>
        <g className="hill h-mid">
          <path d="M0 320V266C540 256 1000 236 1460 194S2400 132 3200 124V320Z" fill={MOSS} />
          <path d="M0 266C540 256 1000 236 1460 194S2400 132 3200 124" fill="none" stroke={INK} strokeWidth="4" />
        </g>
        <g className="hill h-front">
          <path d="M0 320V298C560 294 1060 282 1520 254S2440 216 3200 212V320Z" fill="#42606f" />
          <path d="M0 298C560 294 1060 282 1520 254S2440 216 3200 212" fill="none" stroke={INK} strokeWidth="4" />
        </g>
      </svg>
      <div className="grain" />
    </div>
  );
}

export function HeroSun() {
  return (
    <div className="sun" aria-hidden="true">
      <svg viewBox="0 0 800 800" focusable="false">
        <circle cx="400" cy="400" r="392" fill="#dce7d0" />
        <circle cx="400" cy="400" r="392" fill="none" stroke={INK} strokeWidth="5" />
        <g className="dial-ring">
          <circle
            cx="400"
            cy="400"
            r="352"
            fill="none"
            stroke={MOSS}
            strokeOpacity=".55"
            strokeWidth="3"
            strokeDasharray="2 14"
            strokeLinecap="round"
          />
        </g>
        <g>
          {SUN_TICKS.map((tk, i) => (
            <line
              key={i}
              x1={tk.x1}
              y1={tk.y1}
              x2={tk.x2}
              y2={tk.y2}
              stroke={MOSS}
              strokeOpacity={tk.op}
              strokeWidth={tk.w}
              strokeLinecap="round"
            />
          ))}
        </g>
        <path d="M120 250A300 300 0 0 1 400 100" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="16" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export function SparkGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" fill="currentColor" />
    </svg>
  );
}

/** The paper plane inside the switch's knob (also the plane that flies to the pile). */
export function PlaneGlyph() {
  return (
    <svg viewBox="0 0 48 48" focusable="false">
      <path d="M3 21L45 3 33 45 22 30z" fill="#fdf8ee" stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M22 30L45 3M22 30l-2 11" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
