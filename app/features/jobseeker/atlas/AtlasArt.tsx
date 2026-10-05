import type { ReactNode } from "react";
import type { FitTier, PostingStatus } from "@/app/_lib/jobseeker/types";

// The Atlas's drawn instruments (contest winner me-hub A/3): seven brass-rimmed dials, 96 x 96,
// no text in them - the words sit beside them as real HTML. Every colour is a class that
// atlas.css resolves through the app's tokens (`--a-ink`, `--a-lit`, `--a-face`), so Spark Dark
// repaints them and a LOCKED instrument (`.is-locked`) re-points the same variables at stone.
// They are stylised drawings: decoration, hidden from assistive tech.

function Dial({ children, className = "art" }: { children: ReactNode; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 96 96" aria-hidden="true" focusable="false">
      <circle className="a-brass" cx="48" cy="48" r="44" />
      <circle className="a-face" cx="48" cy="48" r="41" />
      <circle className="a-hair" cx="48" cy="48" r="37" />
      {children}
    </svg>
  );
}

export function ArtSieve() {
  const cx = 48;
  const cy = 45;
  const R = 29;
  const mesh: string[] = [];
  for (let k = -4; k <= 4; k++) {
    const d = k * 7;
    const h = Math.sqrt(Math.max(0, R * R - d * d));
    mesh.push(`M${cx + d} ${cy - h}V${cy + h}M${cx - h} ${cy + d}H${cx + h}`);
  }
  return (
    <Dial>
      <path className="a-mesh" d={mesh.join("")} />
      <circle className="a-ink" cx={cx} cy={cy} r={R} />
      <circle className="a-lit-f" cx="41" cy="37" r="3.2" />
      <circle className="a-lit-f" cx="57" cy="43" r="3.2" />
      <circle className="a-lit-f" cx="47" cy="55" r="3.2" />
      <circle className="a-ink-f" cx="36" cy="82" r="2.2" />
      <circle className="a-ink-f" cx="52" cy="86" r="2.2" />
      <circle className="a-ink-f" cx="62" cy="80" r="2.2" />
    </Dial>
  );
}

export function ArtEvening() {
  return (
    <Dial>
      <path className="a-ink" d="M48 12v12" />
      <path className="a-tint a-ink" d="M31 46 38 24h20l7 22Z" />
      <path className="a-cone" d="M31 46 65 46 76 80H20Z" />
      <path className="a-star" d="M48 52l2.6 7.4 7.4 2.6-7.4 2.6L48 72l-2.6-7.4L38 62l7.4-2.6Z" />
      <path className="a-ink" d="M26 70l-4 4M70 70l4 4" />
    </Dial>
  );
}

export function ArtWeigh() {
  return (
    <Dial>
      <path className="a-ink2" d="M20 35 76 27" />
      <circle className="a-ink-f" cx="48" cy="31" r="3.4" />
      <path className="a-ink2" d="M48 31v42M36 75h24" />
      <path className="a-ink" d="M20 35l-9 19h18zM76 27l-9 15h18z" />
      <path className="a-tint a-ink" d="M9 54q11 12 22 0zM65 42q11 10 22 0z" />
      <path className="a-star" d="M20 39l1.7 4.3 4.3 1.7-4.3 1.7L20 51l-1.7-4.3L14 45l4.3-1.7Z" />
    </Dial>
  );
}

function Dome({ x, w, kind }: { x: number; w: number; kind: "A" | "B" | "C" }) {
  const h = w * 0.5;
  const y = 66;
  return (
    <>
      <path className="a-tint a-ink" d={`M${x - w / 2} ${y}a${w / 2} ${h} 0 0 1 ${w} 0Z`} />
      <rect className="a-paper a-ink" x={x - w / 2 + 2} y={y} width={w - 4} height="9" />
      {kind === "A" ? <path className="a-lit-s" d={`M${x} ${y - h + 1}V${y - 1}`} /> : null}
      {kind === "B" ? (
        <>
          <rect className="a-ink-f" x={x - 3.6} y={y + 2} width="7.2" height="5.4" rx="1" />
          <path className="a-ink" d={`M${x - 2.6} ${y + 2}v-2a2.6 2.6 0 0 1 5.2 0v2`} />
        </>
      ) : null}
      {kind === "C" ? <path className="a-ink a-dash" d={`M${x - w / 2} ${y - 1}L${x + w / 2} ${y + 9}M${x + w / 2} ${y - 1}L${x - w / 2} ${y + 9}`} /> : null}
    </>
  );
}

/** Sources: three domes - the tiers A (open), B (a lock: acknowledge first), C (refused). */
export function ArtSources() {
  return (
    <Dial>
      <path className="a-ink" d="M14 75H82" />
      <Dome x={28} w={22} kind="A" />
      <Dome x={50} w={22} kind="B" />
      <Dome x={72} w={20} kind="C" />
      <path className="a-star" d="M48 18l1.8 5 5 1.8-5 1.8L48 32l-1.8-5.4-5-1.8 5-1.8Z" />
    </Dial>
  );
}

export function ArtLens() {
  return (
    <Dial>
      <rect className="a-paper a-ink" x="20" y="16" width="40" height="54" rx="3" />
      <path className="a-faint" d="M27 27h26M27 35h20M27 43h26M27 51h16M27 59h22" />
      <rect className="a-lit-w" x="26" y="31" width="24" height="8" rx="2" />
      <circle className="a-glass a-ink2" cx="58" cy="56" r="17" />
      <path className="a-ink2" d="M70 68l12 12" style={{ strokeWidth: 5.5 }} />
      <path className="a-glare" d="M49 50a10 10 0 0 1 8-6" />
    </Dial>
  );
}

/** Spectrum: four skill bars whose SHAPE is where the claim comes from (solid work, half
 *  side project, ring study, dashed stated only). */
export function ArtSpectrum() {
  const line = (y: number, w: number, k: "solid" | "half" | "ring" | "dashed") => {
    if (k === "solid") return <rect key={y} className="a-ink-f" x="18" y={y - 3.5} width={w} height="7" rx="3.5" />;
    if (k === "half")
      return (
        <g key={y}>
          <rect className="a-ink" x="18" y={y - 3.5} width={w} height="7" rx="3.5" />
          <path className="a-ink-f" d={`M21.5 ${y - 3.5}H${18 + w / 2}V${y + 3.5}H21.5a3.5 3.5 0 0 1 0-7Z`} />
        </g>
      );
    if (k === "ring") return <rect key={y} className="a-ink" x="18" y={y - 3.5} width={w} height="7" rx="3.5" />;
    return <path key={y} className="a-ink a-dash" d={`M18 ${y}H${18 + w}`} style={{ strokeWidth: 3.4 }} />;
  };
  return (
    <Dial>
      {line(24, 58, "solid")}
      {line(38, 44, "half")}
      {line(52, 52, "ring")}
      {line(66, 32, "dashed")}
      <path className="a-lit-s" d="M18 78H74" style={{ strokeWidth: 1.4 }} />
    </Dial>
  );
}

/** Bearing: six points round a compass, one per card of "What you want"; a point is lit when set. */
export function ArtBearing({ flags }: { flags: readonly boolean[] }) {
  return (
    <Dial>
      <circle className="a-ink" cx="48" cy="48" r="29" />
      {Array.from({ length: 6 }, (_, i) => {
        const a = ((-90 + i * 60) * Math.PI) / 180;
        const x = +(48 + 29 * Math.cos(a)).toFixed(1);
        const y = +(48 + 29 * Math.sin(a)).toFixed(1);
        return flags[i] ? <circle key={i} className="a-lit-f a-ink" cx={x} cy={y} r="6" /> : <circle key={i} className="a-paper a-ink a-dash" cx={x} cy={y} r="5.4" />;
      })}
      <path className="a-needle" d="M48 30 54 48 48 66 42 48Z" />
      <circle className="a-ink-f" cx="48" cy="48" r="3" />
    </Dial>
  );
}

/** The tier as a glyph: a ray-star (strong), a haloed dot (promising), a plain dot (partial). */
export function TierGlyph({ tier }: { tier: FitTier }) {
  return (
    <svg className={`gl gl-${tier}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {tier === "strong" ? (
        <>
          <path className="gl-ray" d="M12 1.5v4.6M12 17.9v4.6M1.5 12h4.6M17.9 12h4.6" />
          <circle className="gl-core" cx="12" cy="12" r="4.6" />
        </>
      ) : tier === "promising" ? (
        <>
          <circle className="gl-halo" cx="12" cy="12" r="8.6" />
          <circle className="gl-core" cx="12" cy="12" r="4.2" />
        </>
      ) : (
        <circle className="gl-core" cx="12" cy="12" r="3.4" />
      )}
    </svg>
  );
}

/** A decision as a mark: filled square (applied), dot (shortlisted), cross (let go), dashed ring (gone). */
export function DecisionMark({ status }: { status: PostingStatus }) {
  if (status === "new") return null;
  return (
    <svg className={`dm dm-${status}`} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {status === "applied" ? <rect className="dm-fill" x="3.4" y="3.4" width="9.2" height="9.2" rx="1" /> : null}
      {status === "shortlisted" ? <circle className="dm-fill" cx="8" cy="8" r="4.4" /> : null}
      {status === "dismissed" ? <path className="dm-x" d="M3.8 3.8l8.4 8.4M12.2 3.8l-8.4 8.4" /> : null}
    </svg>
  );
}
