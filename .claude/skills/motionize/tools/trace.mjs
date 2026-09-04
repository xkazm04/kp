#!/usr/bin/env node
/**
 * Raster → SVG tracer for motionize. Wraps @neplex/vectorizer (VTracer/Rust,
 * fast, one <path> per color region) + SVGO cleanup, tuned for the flat
 * trace-friendly art /leonardo produces. Output: a clean multi-path SVG whose
 * every element is individually addressable for motion/Remotion reveals.
 *
 * Usage:
 *   node trace.mjs --input flat.png --output icon.svg \
 *     [--mode spline|polygon|pixel] [--color-precision 6] [--filter-speckle 4] \
 *     [--corner-threshold 60] [--path-precision 5] [--no-optimize] \
 *     [--emit data.ts --name GLYPH_NAME [--order radial|angular] [--white-keep 0.1]
 *      [--slab-min-area 0.25] [--surface-fill "#F4B214>#7C3AED"] [--surface-tolerance 40]]   # one-pass component data
 * Prefer a FLAT source (solid fills, hard edges, no glow/gradients) — glow is a
 * later SVG/CSS filter, not something to trace.
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { vectorize, ColorMode, Hierarchical, PathSimplifyMode } from "@neplex/vectorizer";
import { optimize } from "svgo";
import { svgToGlyphData, parseArgs, glyphOptionsFromArgs } from "./emit-glyph.mjs";
const MODE = { spline: PathSimplifyMode.Spline, polygon: PathSimplifyMode.Polygon, pixel: PathSimplifyMode.None };

async function main() {
  const args = parseArgs(process.argv);
  if (!args.input || !args.output) { console.error('Usage: --input flat.png --output icon.svg'); process.exit(1); }

  const buf = readFileSync(args.input);
  const config = {
    colorMode: args.mono ? ColorMode.Binary : ColorMode.Color,
    colorPrecision: Number(args["color-precision"] ?? 6),
    filterSpeckle: Number(args["filter-speckle"] ?? 4),
    spliceThreshold: Number(args["splice-threshold"] ?? 45),
    cornerThreshold: Number(args["corner-threshold"] ?? 60),
    hierarchical: Hierarchical.Stacked,
    mode: MODE[args.mode || "spline"] ?? PathSimplifyMode.Spline,
    layerDifference: Number(args["layer-difference"] ?? 5),
    lengthThreshold: Number(args["length-threshold"] ?? 5),
    maxIterations: 10,
    pathPrecision: Number(args["path-precision"] ?? 5),
  };

  let svg = await vectorize(buf, config);

  if (!args["no-optimize"]) {
    const res = optimize(svg, {
      multipass: true,
      plugins: [
        { name: "preset-default", params: { overrides: { removeViewBox: false } } },
        // keep path data addressable; don't merge everything into one blob
        { name: "cleanupIds", params: { minify: false } },
      ],
    });
    svg = res.data;
  }

  const abs = resolve(args.output);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, svg);
  const pathCount = (svg.match(/<path/g) || []).length;
  const result = { success: true, output: abs, bytes: svg.length, paths: pathCount, config };

  // One-pass component data: trace → animatable {d,fill,delay}[] TS module.
  if (args.emit && args.name) {
    // Every emit option in one place (emit-glyph.mjs) — hand-built copies here
    // are how `--slab-min-area` went missing from this path for a whole release.
    const { ts, elements, dropped } = svgToGlyphData(svg, { name: args.name, ...glyphOptionsFromArgs(args) });
    const emitAbs = resolve(args.emit);
    mkdirSync(dirname(emitAbs), { recursive: true });
    writeFileSync(emitAbs, ts);
    result.emit = { output: emitAbs, elements, dropped };
  }

  console.log(JSON.stringify(result, null, 2));
}
main().catch((e) => { console.error(JSON.stringify({ error: String(e?.message || e) }, null, 2)); process.exit(1); });
