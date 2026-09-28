/*
 * The orbit's canvas painting and the flight (ported from the winner's drawOrbit / drawDot / runFlight).
 * Colours are READ from the live design tokens on <html>, never written here, so Studio Light and
 * Spark Dark both paint and a token edit re-tones the canvas; the caller re-reads them on a theme flip.
 */
import { anchorOf, DEG, TAU, type CalloutPlace, type Dot, type DotKind, type OrbitGeo } from "./orbitLayout.ts";

type RGB = [number, number, number];
export type Palette = {
  paper: RGB; ink: RGB; coral: RGB; amber: RGB; moss: RGB; calm: RGB; rule: RGB; rule2: RGB; quiet: RGB; dark: boolean; font: string;
};

function parse(v: string): RGB {
  const s = v.trim();
  if (s.startsWith("#")) {
    const h = s.length === 4 ? s.slice(1).split("").map((c) => c + c).join("") : s.slice(1, 7);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const m = s.match(/(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [128, 128, 128];
}
const mix = (a: RGB, b: RGB, t: number): RGB => [Math.round(a[0] * t + b[0] * (1 - t)), Math.round(a[1] * t + b[1] * (1 - t)), Math.round(a[2] * t + b[2] * (1 - t))];
const rgba = (c: RGB, al = 1) => `rgba(${c[0]},${c[1]},${c[2]},${al})`;

export function readPalette(): Palette {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const g = (n: string) => parse(cs.getPropertyValue(n));
  const paper = g("--color-paper");
  const ink = g("--color-ink");
  return {
    paper, ink, coral: g("--color-coral"), amber: g("--color-dial-amber"), moss: g("--color-moss"),
    calm: mix(g("--color-steel"), paper, 0.58), rule: g("--color-stone-200"), rule2: g("--color-stone-300"),
    quiet: mix(ink, paper, 0.62), dark: root.getAttribute("data-theme") === "dark",
    font: getComputedStyle(document.body).fontFamily,
  };
}

const dotColor = (c: Palette, k: DotKind) => (k === "w" ? c.coral : k === "a" ? c.amber : k === "h" ? c.moss : c.calm);

export function sizeCanvas(cv: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D | null {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  cv.style.width = `${w}px`;
  cv.style.height = `${h}px`;
  const x = cv.getContext("2d");
  x?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return x;
}

/** Solid = a move is recorded (walked); a ring = placed, never moved. A waiting dot carries a halo. */
export function drawDot(x: CanvasRenderingContext2D, c: Palette, d: Pick<Dot, "k" | "p">, px: number, py: number, rad: number, alpha: number) {
  const col = dotColor(c, d.k);
  if (d.p.walked) {
    x.fillStyle = rgba(col, alpha);
    x.beginPath(); x.arc(px, py, rad, 0, TAU); x.fill();
  } else {
    x.strokeStyle = rgba(col, alpha);
    x.lineWidth = Math.max(1, rad * 0.55);
    x.beginPath(); x.arc(px, py, Math.max(0.8, rad - x.lineWidth / 2), 0, TAU); x.stroke();
  }
  if (d.k === "w" && rad > 1.6) {
    x.strokeStyle = rgba(c.coral, 0.35 * alpha);
    x.lineWidth = 1;
    x.beginPath(); x.arc(px, py, rad + 1.6, 0, TAU); x.stroke();
  }
}

export type DrawOptions = {
  /** The hovered or focused sector's group key: everything else dims. */
  hot: string | null;
  /** A focused stage (axis index), from Today: every other ring's people dim. */
  ring: number | null;
  places: readonly CalloutPlace[];
  height: number;
  ringLabels: readonly string[];
};

export function drawOrbit(cv: HTMLCanvasElement, geo: OrbitGeo, c: Palette, { hot, ring, places, height, ringLabels }: DrawOptions) {
  const x = sizeCanvas(cv, geo.W, height);
  if (!x) return;
  const { R, cx, cy, rings } = geo;
  x.clearRect(0, 0, geo.W, height);
  rings.forEach((rg, i) => {
    x.beginPath();
    x.arc(cx, cy, rg[1] * R + 2, 0, TAU);
    x.arc(cx, cy, Math.max(0, rg[0] * R - 2), 0, TAU, true);
    x.fillStyle = rgba(i % 2 ? c.paper : mix(c.ink, c.paper, c.dark ? 0.05 : 0.035));
    x.fill("evenodd");
    x.strokeStyle = rgba(c.rule); x.lineWidth = 1;
    x.beginPath(); x.arc(cx, cy, rg[1] * R + 2, 0, TAU); x.stroke();
  });
  const inner = rings[rings.length - 1][0];
  for (const s of geo.sectors) {
    if (hot != null && s.g.key === hot) {
      x.beginPath(); x.moveTo(cx, cy);
      x.arc(cx, cy, R + 6 + s.rimRows * 8, s.a0 - Math.PI / 2, s.a1 - Math.PI / 2);
      x.closePath();
      x.fillStyle = rgba(c.ink, c.dark ? 0.09 : 0.06); x.fill();
    }
    for (const th of [s.a0 - 0.35 * DEG, s.a1 + 0.35 * DEG]) {
      x.strokeStyle = rgba(c.paper); x.lineWidth = 1.5;
      x.beginPath();
      x.moveTo(cx + inner * R * Math.sin(th), cy - inner * R * Math.cos(th));
      x.lineTo(cx + (R + 3) * Math.sin(th), cy - (R + 3) * Math.cos(th));
      x.stroke();
    }
  }
  const dim = hot != null;
  for (const d of geo.dots) {
    const off = (dim && d.g !== hot) || (ring != null && d.p.si !== ring);
    drawDot(x, c, d, d.x, d.y, d.r, off ? (ring != null && d.p.si !== ring ? 0.16 : 0.28) : 1);
  }
  for (const s of geo.sectors) {
    const al = dim && s.g.key !== hot ? 0.3 : 1;
    for (const m of s.rim) {
      if (m.absence === "draft") {
        x.strokeStyle = rgba(c.quiet, al); x.lineWidth = 1.2; x.setLineDash([2, 1.5]);
        x.strokeRect(m.x - 2.6, m.y - 2.6, 5.2, 5.2); x.setLineDash([]);
        x.beginPath(); x.moveTo(m.x - 2.6, m.y + 2.6); x.lineTo(m.x + 2.6, m.y - 2.6); x.stroke();
      } else {
        x.strokeStyle = rgba(c.ink, al); x.lineWidth = 1.6;
        x.strokeRect(m.x - 2.8, m.y - 2.8, 5.6, 5.6);
      }
    }
  }
  const byKey = new Map(places.map((p) => [p.key, p]));
  for (const s of geo.sectors) {
    const co = byKey.get(s.g.key);
    if (!co) continue;
    const al = dim && s.g.key !== hot ? 0.25 : 0.7;
    const a = anchorOf(geo, s);
    const col = s.g.wait ? c.coral : c.rule2;
    x.strokeStyle = rgba(col, al); x.lineWidth = s.g.wait ? 1.3 : 1;
    const nx = Math.sin(s.mid);
    const ny = -Math.cos(s.mid);
    const hdl = Math.min(90, Math.hypot(co.lineEnd - a.x, co.lineY - a.y) * 0.45);
    x.beginPath(); x.moveTo(a.x, a.y);
    x.bezierCurveTo(a.x + nx * hdl, a.y + ny * hdl, co.lineEnd + (co.lineTip > co.lineEnd ? -1 : 1) * hdl * 0.6, co.lineY, co.lineEnd, co.lineY);
    x.lineTo(co.lineTip, co.lineY); x.stroke();
    x.fillStyle = rgba(col, al); x.beginPath(); x.arc(a.x, a.y, 2.2, 0, TAU); x.fill();
  }
  // The ring names in the 12 o'clock wedge, outside in; the terminal name sits in the hub.
  x.font = `600 14px ${c.font}`;
  x.textAlign = "center"; x.textBaseline = "middle";
  rings.forEach((rg, i) => {
    const last = i === rings.length - 1;
    x.fillStyle = rgba(ring === i ? c.ink : last ? c.moss : c.quiet);
    x.fillText(ringLabels[i] ?? "", cx, last ? cy : cy - ((rg[0] + rg[1]) / 2) * R);
  });
}

/* ---------------------------------------------------------------- the flight */

/** One travelling dot: from (fx,fy,fr,fa) to (tx,ty,tr,ta), in viewport coordinates. */
export type Part = {
  d: Pick<Dot, "k" | "p">; fx: number; fy: number; tx: number; ty: number; fr: number; tr: number; fa: number; ta: number;
  delay: number; arc?: number; nx?: number; ny?: number; fast?: boolean;
};

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Run a flight on the fixed overlay canvas. Returns a cancel that ends it at once (and still calls done). */
export function runFlight(cv: HTMLCanvasElement, c: Palette, parts: readonly Part[], dur: number, done: () => void): () => void {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const x = sizeCanvas(cv, W, H);
  if (!x) { done(); return () => {}; }
  cv.style.display = "block";
  const t0 = performance.now();
  let raf = 0;
  let over = false;
  const finish = () => {
    if (over) return;
    over = true;
    cancelAnimationFrame(raf);
    clearTimeout(settle);
    x.clearRect(0, 0, W, H);
    cv.style.display = "none";
    done();
  };
  const frame = (now: number) => {
    const T = (now - t0) / dur;
    x.clearRect(0, 0, W, H);
    for (const p of parts) {
      const k = Math.max(0, Math.min(1, (T - p.delay) / (1 - p.delay)));
      const e = ease(k);
      let px = p.fx + (p.tx - p.fx) * e;
      let py = p.fy + (p.ty - p.fy) * e;
      if (p.arc) { const bend = Math.sin(Math.PI * e) * p.arc; px += bend * (p.nx ?? 0); py += bend * (p.ny ?? 0); }
      const rad = p.fr + (p.tr - p.fr) * e;
      const al = p.fast ? p.fa + (p.ta - p.fa) * Math.min(1, k * 2.4) : p.fa + (p.ta - p.fa) * e;
      if (px < -20 || py < -20 || px > W + 20 || py > H + 20 || al <= 0.01) continue;
      drawDot(x, c, p.d, px, py, rad, al);
    }
    if (T < 1) raf = requestAnimationFrame(frame);
    else finish();
  };
  raf = requestAnimationFrame(frame);
  // A hidden tab never runs rAF: the settle timer lands the flight anyway (contest improvement log, 2026-09-25).
  const settle = setTimeout(finish, dur + 400);
  return finish;
}
