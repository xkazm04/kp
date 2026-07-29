#!/usr/bin/env node
/**
 * Batch tracer for an ICON SET. Traces every `<key>-flat.png` (or `<key>.png`) in a
 * directory and emits either
 *   - one keyed TS map (default):
 *       export const <NAME>: Record<string, { viewBox: string; data: {d,fill,delay}[] }>
 *     for components that look a glyph up at runtime (e.g. by archetype id), or
 *   - one module per glyph (`--split`, `--output` is then a DIRECTORY):
 *       export const <KEY>_GLYPH: TracedGlyph
 *     so each consumer only bundles the glyph it renders. Prefer `--split` — path data
 *     runs tens of KB gzipped per glyph and a shared Record lands all of it in whatever
 *     chunk the importing component belongs to.
 * Same trace + emit-glyph gotcha handling as trace.mjs.
 *
 * Usage:
 *   node trace-set.mjs --input-dir out/archetypes --output src/.../archetypeGlyphData.ts \
 *     --name ARCHETYPE_GLYPHS [--color-precision 4] [--filter-speckle 6] [--white-keep 0.1] [--order radial] \
 *     [--surface-fill "ratelimit=#F4B214>#7C3AED,other=#123456"] [--slab-min-area 0.25]
 *
 * `--surface-fill` is per-key (`<key>=<hex>` or `<key>=<hex>><target>`, comma-separated):
 * only some glyphs in a set have a big saturated slab to demote or repaint. See emit-glyph.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { dirname, resolve, join, basename } from "path";
import { vectorize, ColorMode, Hierarchical, PathSimplifyMode } from "@neplex/vectorizer";
import { optimize } from "svgo";
import { svgToGlyphData } from "./emit-glyph.mjs";

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { const k = argv[i].slice(2), n = argv[i + 1]; if (n && !n.startsWith("--")) { a[k] = n; i++; } else a[k] = true; }
  }
  return a;
}
const MODE = { spline: PathSimplifyMode.Spline, polygon: PathSimplifyMode.Polygon, pixel: PathSimplifyMode.None };

async function traceOne(buf, args) {
  const config = {
    colorMode: ColorMode.Color,
    colorPrecision: Number(args["color-precision"] ?? 4),
    filterSpeckle: Number(args["filter-speckle"] ?? 6),
    spliceThreshold: 45,
    cornerThreshold: 60,
    hierarchical: Hierarchical.Stacked,
    mode: MODE[args.mode || "spline"] ?? PathSimplifyMode.Spline,
    layerDifference: 5,
    lengthThreshold: Number(args["length-threshold"] ?? 6),
    maxIterations: 10,
    pathPrecision: 5,
  };
  let svg = await vectorize(buf, config);
  svg = optimize(svg, { multipass: true, plugins: [{ name: "preset-default", params: { overrides: { removeViewBox: false } } }] }).data;
  return svg;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args["input-dir"] || !args.output || !args.name) { console.error("Usage: --input-dir <dir> --output data.ts --name NAME"); process.exit(1); }
  const dir = resolve(args["input-dir"]);
  const files = readdirSync(dir).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f)).sort();

  // "key=#hex,key2=#hex>#target" → { key: "#hex", key2: "#hex>#target" }
  const surfaceFills = Object.fromEntries(
    String(args["surface-fill"] ?? "").split(",").filter(Boolean).map((pair) => {
      const i = pair.indexOf("=");
      return [pair.slice(0, i).trim(), pair.slice(i + 1).trim()];
    }),
  );

  const entries = [];
  for (const f of files) {
    const key = basename(f).replace(/\.(png|jpg|jpeg|webp)$/i, "").replace(/-flat$/, "");
    const svg = await traceOne(readFileSync(join(dir, f)), args);
    // Reuse the same core → { viewBox, data }; strip the module wrapper, keep the array.
    const { ts, elements } = svgToGlyphData(svg, {
      name: "_TMP",
      order: args.order,
      whiteKeep: args["white-keep"] ? Number(args["white-keep"]) : undefined,
      surfaceFill: surfaceFills[key] ?? null,
      surfaceTolerance: args["surface-tolerance"] ? Number(args["surface-tolerance"]) : undefined,
      slabMinArea: args["slab-min-area"] ? Number(args["slab-min-area"]) : null,
    });
    // Parse the CURRENT emit-glyph shape: one `export const _TMP: TracedGlyph =
    // { viewBox: "…", data: […] };`. It used to emit a separate `_TMP_VIEWBOX`
    // const plus a bare array, and these regexes still expected that — so every
    // `--split` run died on the first glyph with "Cannot read properties of null".
    const viewBox = /viewBox:\s*"([^"]+)"/.exec(ts)[1];
    const data = /data:\s*(\[.*\])\s*}/s.exec(ts)[1];
    entries.push({ key, viewBox, data, elements });
    process.stderr.write(`  ${key}: ${elements} paths\n`);
  }

  // `--split`: one module per glyph, into the `--output` DIRECTORY. Path data is
  // heavy (tens of KB gzipped per glyph); a single keyed Record forces every consumer
  // to pull the whole set into its chunk. Split modules let each feature import only
  // the glyph it renders. Use the keyed Record only when a component genuinely looks
  // a glyph up at runtime (e.g. by archetype id).
  if (args.split) {
    const outDir = resolve(args.output);
    mkdirSync(outDir, { recursive: true });
    for (const e of entries) {
      const constName = `${e.key.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}_GLYPH`;
      const file = join(outDir, `${e.key.replace(/[^a-z0-9]+/gi, "-")}Glyph.ts`);
      writeFileSync(file, `// AUTO-GENERATED by .claude/skills/motionize/tools/trace-set.mjs — do not edit by hand.
import type { TracedGlyph } from '@/app/_components/glyph/MotionizedGlyph';

export const ${constName}: TracedGlyph = { viewBox: ${JSON.stringify(e.viewBox)}, data: ${e.data} };
`);
    }
    console.log(JSON.stringify({ success: true, split: true, outDir, glyphs: entries.length, keys: entries.map((e) => e.key) }, null, 2));
    return;
  }

  // `--key-type` additionally emits a literal union of the keys, so callers get
  // compile-time checking instead of a silent `undefined` on a typo. Opt-in: the
  // Record stays `string`-indexed, which existing callers (archetype ids) rely on.
  const keyType = args["key-type"]
    ? `\nexport type ${args["key-type"]} = ${entries.map((e) => JSON.stringify(e.key)).join(" | ")};\n`
    : "";

  const body = `// AUTO-GENERATED by .claude/skills/motionize/tools/trace-set.mjs — do not edit by hand.
${keyType}
export const ${args.name}: Record<string, { viewBox: string; data: { d: string; fill: string; delay: number }[] }> = {
${entries.map((e) => `  ${JSON.stringify(e.key)}: { viewBox: ${JSON.stringify(e.viewBox)}, data: ${e.data} },`).join("\n")}
};
`;
  const abs = resolve(args.output);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  console.log(JSON.stringify({ success: true, output: abs, glyphs: entries.length, keys: entries.map((e) => e.key) }, null, 2));
}
main().catch((e) => { console.error(JSON.stringify({ error: String(e?.message || e) }, null, 2)); process.exit(1); });
