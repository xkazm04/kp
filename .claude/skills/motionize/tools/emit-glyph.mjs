#!/usr/bin/env node
/**
 * SVG → animatable data module for motionize. Parses a traced SVG's <path>s and
 * emits a TS array of `{ d, fill, delay }` the component maps over — so a
 * many-path trace becomes an orchestrated, per-element reveal without
 * hand-classifying paths.
 *
 * Handles the trace gotchas automatically:
 *  - drops the full-canvas background path,
 *  - recolors interior near-white "negative space" paths to `var(--color-paper)`
 *    (so links/holes read as thin lines, not solid),
 *  - assigns each path a `delay` (0..1) from its distance to the canvas centre —
 *    the reveal radiates center-out (hub → links → figures → outer accents).
 *
 * Usage:
 *   node emit-glyph.mjs --input traced.svg --output data.ts --name NETWORK_GLYPH \
 *     [--order radial|angular] [--white-keep 0.1] [--slab-min-area 0.25] \
 *     [--surface-fill "#F4B214" | "#F4B214>#7C3AED"] [--surface-tolerance 40]
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";

export function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { const k = argv[i].slice(2), n = argv[i + 1]; if (n && !n.startsWith("--")) { a[k] = n; i++; } else a[k] = true; }
  }
  return a;
}

/**
 * Parsed CLI args → the `svgToGlyphData` options, in ONE place.
 *
 * Three CLIs feed the same core (this one, `trace.mjs --emit`, `trace-set.mjs`)
 * and each used to build this object by hand. `trace.mjs` silently dropped
 * `--slab-min-area` that way — the flag the docstring advertises parsed fine and
 * then went nowhere, so a one-pass trace could not tune the slab threshold at all.
 * `overrides` is for the one option a caller genuinely resolves differently
 * (trace-set picks `surfaceFill` per glyph key from a `key=#hex` map).
 */
export function glyphOptionsFromArgs(args, overrides = {}) {
  const num = (k) => (args[k] === undefined || args[k] === true ? undefined : Number(args[k]));
  return {
    order: args.order,
    whiteKeep: num("white-keep"),
    surfaceFill: args["surface-fill"] || null,
    surfaceTolerance: num("surface-tolerance"),
    slabMinArea: num("slab-min-area") ?? null,
    ...overrides,
  };
}
const rgb = (hex) => { const m = /^#([0-9a-f]{6})$/i.exec(hex); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
// "Light" = high luminance (catches white AND light lavender/panel highlights)
// without touching saturated neon accents (amber/cyan/violet sit well below 0.82).
const nearWhite = (hex) => { const c = rgb(hex); return c ? (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255 > 0.82 : false; };
// "Near-black" = all channels very dark. STRICT (< 26) so a black BACKGROUND is
// caught but dark line-work like navy (#0D1F51, blue channel 0x51) is NOT.
const nearBlack = (hex) => { const c = rgb(hex); return c ? Math.max(c[0], c[1], c[2]) < 26 : false; };
// Either extreme CAN read as surface (white-bg or black-bg source art) — but only
// one of them at a time. See `groundIsLight` below: on kp's light-ground art the
// near-black regions are the ink line-work, and demoting them erases the drawing.
const isSurfaceFor = (hex, groundIsLight) => (groundIsLight ? nearWhite(hex) : nearWhite(hex) || nearBlack(hex));
// Distance in RGB space — the tracer quantizes one flat slab into a dozen
// near-identical hexes, so an exact match never works.
const near = (hex, target, tol) => {
  const a = rgb(hex), b = rgb(target);
  return a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= tol : false;
};
// rough bbox from all numbers in a path (exact enough to spot the full-canvas rect)
function roughBox(d) {
  const nums = (d.match(/-?\d*\.?\d+/g) || []).map(Number);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    minX = Math.min(minX, nums[i]); maxX = Math.max(maxX, nums[i]);
    minY = Math.min(minY, nums[i + 1]); maxY = Math.max(maxY, nums[i + 1]);
  }
  return { minX, maxX, minY, maxY };
}
// accurate-ish anchor: the first absolute M coordinate (element position)
function anchor(d) {
  const m = /M\s*(-?\d*\.?\d+)[ ,]+(-?\d*\.?\d+)/.exec(d);
  return m ? { x: +m[1], y: +m[2] } : { x: 512, y: 512 };
}

/**
 * Core: SVG string → { ts, elements, dropped }. Exported so trace.mjs can emit
 * the component data in one pass (--emit) as well as this standalone CLI.
 */
export function svgToGlyphData(svg, { name, order = "radial", whiteKeep = 0.1, surfaceFill = null, surfaceTolerance = 40, slabMinArea = null } = {}) {
  const vb = /viewBox="([^"]+)"/.exec(svg);
  const wh = /width="(\d+)"\s+height="(\d+)"/.exec(svg);
  const [W, H] = vb ? vb[1].split(/\s+/).slice(2).map(Number) : wh ? [+wh[1], +wh[2]] : [1024, 1024];
  const cx = W / 2, cy = H / 2, maxR = Math.hypot(cx, cy), canvasArea = W * H;

  // "#F4B214" → demote big amber to the surface; "#F4B214>#7C3AED" → repaint it violet.
  const [slabFrom, slabTo] = String(surfaceFill ?? "").split(">");
  const slabArea = slabMinArea ?? whiteKeep;

  const paths = [...svg.matchAll(/<path\s+fill="(#[0-9A-Fa-f]+)"\s+d="([^"]+)"\s*\/>/g)].map((m) => ({ fill: m[1], d: m[2] }));

  // Which extreme is the GROUND? The upstream skill assumed dark-ground art, where
  // near-black is background and light regions are line-work. kp generates the
  // opposite (ink on warm paper), and the generator renders those outlines at about
  // #040404 — squarely inside `nearBlack`. Demoting them turned whole glyphs into a
  // few floating colour blobs (hit independently by two surfaces before this fix).
  // So: decide the ground by total area, and only ever demote the ground's colour.
  const areaOf = (d) => {
    const raw = roughBox(d);
    const b = { minX: Math.max(0, raw.minX), minY: Math.max(0, raw.minY), maxX: Math.min(W, raw.maxX), maxY: Math.min(H, raw.maxY) };
    return Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
  };
  let lightArea = 0, darkArea = 0;
  for (const p of paths) {
    if (nearWhite(p.fill)) lightArea += areaOf(p.d);
    else if (nearBlack(p.fill)) darkArea += areaOf(p.d);
  }
  const groundIsLight = lightArea >= darkArea;
  const isSurface = (hex) => isSurfaceFor(hex, groundIsLight);

  // Paint order (z-order) is PRESERVED — VTracer stacks fills over outlines, so
  // reordering hides colored fills behind navy. `delay` drives timing only.
  const out = [];
  for (const p of paths) {
    const raw = roughBox(p.d);
    // Clamp to the canvas — spline control points can sit far outside it and
    // otherwise inflate the bbox, corrupting the coversCanvas / areaFrac tests.
    const box = { minX: Math.max(0, raw.minX), minY: Math.max(0, raw.minY), maxX: Math.min(W, raw.maxX), maxY: Math.min(H, raw.maxY) };
    const coversCanvas = box.minX <= 4 && box.minY <= 4 && box.maxX >= W - 4 && box.maxY >= H - 4;
    // Surface-coloured regions (white OR black) that are the bg / large negative-
    // space are RECOLORED to `var(--color-paper)` — NOT dropped: VTracer's stacked
    // output relies on them painting over accents to carve line gaps (linework art),
    // and they follow the theme for free. Small surface paths (sparks, highlights,
    // thin holes) stay as-is. Lower `whiteKeep` (e.g. 0.02) for wireframe/lattice.
    // `surfaceFill` extends the same idea to an arbitrary SLAB colour: art whose hero
    // is one big saturated fill (an amber shield, say) reads as a blob on a dark
    // surface. Naming that hex repaints its LARGE regions — to `var(--color-paper)`
    // by default, or to a target hue with `from>to` — while small regions of the same
    // colour (droplets, dots, sparks) keep it, so the accent stays sparse. Generation
    // rarely lands the exact palette; we own the coloring, the raster is only geometry.
    const areaFrac = ((box.maxX - box.minX) * (box.maxY - box.minY)) / canvasArea;
    // NOTE: a full-canvas rect is NOT automatically the background. VTracer's Stacked
    // mode sometimes lays the darkest quantized layer down first as an exact canvas
    // rect and paints the white page over it — there, the rect IS the line-work, and
    // the outlines are it showing through gaps in the layer above. Demote by COLOUR
    // (surface-like) and never by geometry alone, or every outline disappears.
    let fill = p.fill;
    if (isSurface(p.fill) && (coversCanvas || areaFrac > whiteKeep)) fill = "var(--color-paper)";
    else if (slabFrom && near(p.fill, slabFrom, surfaceTolerance) && (coversCanvas || areaFrac > slabArea)) fill = slabTo || "var(--color-paper)";
    const a = anchor(p.d);
    const dist = Math.hypot(a.x - cx, a.y - cy) / maxR; // 0 (center) .. 1 (corner)
    const ang = (Math.atan2(a.y - cy, a.x - cx) + Math.PI) / (2 * Math.PI); // 0..1 clockwise
    out.push({ d: p.d, fill, delay: Number((order === "angular" ? ang : dist).toFixed(3)) });
  }

  // Emit the SAME `TracedGlyph` shape trace-set.mjs does. The two writers used to
  // disagree (this one exported a bare array + a separate _VIEWBOX const), which
  // meant a single-glyph trace produced a module no consumer could feed straight
  // into <MotionizedGlyph data viewBox> like the committed set-traced glyphs.
  const ts = `// AUTO-GENERATED by .claude/skills/motionize (trace.mjs --emit / emit-glyph.mjs) — do not edit by hand.
import type { TracedGlyph } from '@/app/_components/glyph/MotionizedGlyph';

export const ${name}: TracedGlyph = { viewBox: "0 0 ${W} ${H}", data: ${JSON.stringify(out, null, 0)} };
`;
  return { ts, elements: out.length, dropped: paths.length - out.length };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.input || !args.output || !args.name) { console.error("Usage: --input svg --output data.ts --name NAME"); process.exit(1); }
  const svg = readFileSync(args.input, "utf8");
  const { ts, elements, dropped } = svgToGlyphData(svg, { name: args.name, ...glyphOptionsFromArgs(args) });
  const abs = resolve(args.output);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, ts);
  console.log(JSON.stringify({ success: true, output: abs, elements, dropped }, null, 2));
}

// Run as CLI only when invoked directly (not when imported by trace.mjs).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("emit-glyph.mjs")) main();
