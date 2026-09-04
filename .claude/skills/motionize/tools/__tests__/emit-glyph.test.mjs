/**
 * Fixtures for the motionize conversion core (`emit-glyph.mjs`).
 *
 * This function is the whole skill's load-bearing pure part — every glyph in
 * `app/_components/glyph/glyphs/` came out of it — and it had no test at all
 * while its own docstring recorded two regressions: the ground-polarity bug that
 * erased ink line-work on kp's light-ground art, and the emitted-module shape
 * that stopped matching what `<MotionizedGlyph>` consumes. Both are pinned here.
 *
 * Run: node --test .claude/skills/motionize/tools/__tests__/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { svgToGlyphData, glyphOptionsFromArgs, parseArgs } from "../emit-glyph.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const TOOLS = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The emitter parses `<path fill="#hex" d="…"/>` — build fixtures in that shape. */
const svg = (...paths) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${paths
    .map(([fill, d]) => `<path fill="${fill}" d="${d}"/>`)
    .join("")}</svg>`;

const FULL = "M0 0 L100 0 L100 100 L0 100 Z"; // the whole canvas
const BIG = "M10 10 L90 10 L90 90 L10 90 Z"; // 64% of the canvas
const CENTRE = "M48 48 L52 48 L52 52 L48 52 Z"; // 0.16%, dead centre
const CORNER = "M2 2 L6 2 L6 6 L2 6 Z"; // 0.16%, top-left corner

const fills = (svgStr, opts = {}) =>
  JSON.parse(/data:\s*(\[.*\])\s*}/s.exec(svgToGlyphData(svgStr, { name: "T", ...opts }).ts)[1]);

test("light ground: the paper canvas is demoted, the ink line-work survives", () => {
  // The 2026-08 regression: kp's generator draws outlines at ~#040404, which is
  // inside `nearBlack`. Demoting BOTH extremes left three floating colour blobs.
  const out = fills(svg(["#ffffff", FULL], ["#040404", BIG], ["#d65a4a", CENTRE]));
  assert.equal(out[0].fill, "var(--color-paper)", "full-canvas white is the ground");
  assert.equal(out[1].fill, "#040404", "ink line-work must NOT be demoted on light-ground art");
  assert.equal(out[2].fill, "#d65a4a", "accents are never touched");
  assert.equal(out.length, 3, "paths are recoloured, never dropped (they carve line gaps)");
});

test("dark ground: near-black is the ground and small light regions stay literal", () => {
  const out = fills(svg(["#000000", FULL], ["#ffffff", CENTRE], ["#d65a4a", BIG]));
  assert.equal(out[0].fill, "var(--color-paper)", "full-canvas black is the ground here");
  assert.equal(out[1].fill, "#ffffff", "a small highlight is below whiteKeep — kept literal");
  assert.equal(out[2].fill, "#d65a4a");
});

test("slab: a large named fill is repainted, a small one of the same colour is not", () => {
  const out = fills(svg(["#ffffff", FULL], ["#f4b214", BIG], ["#f4b214", CENTRE]), {
    surfaceFill: "#F4B214>#7C3AED",
    slabMinArea: 0.25,
  });
  assert.equal(out[1].fill, "#7C3AED", "64% of the canvas is a slab");
  assert.equal(out[2].fill, "#f4b214", "0.16% is a spark — the accent stays sparse");
});

test("slab: --slab-min-area is honoured and is independent of --white-keep", () => {
  const withDefault = fills(svg(["#ffffff", FULL], ["#f4b214", BIG]), { surfaceFill: "#F4B214" });
  assert.equal(withDefault[1].fill, "var(--color-paper)", "unset slab area falls back to whiteKeep (0.1)");

  // The flag `trace.mjs` used to parse and then silently drop: raising the slab
  // threshold above the region's area must leave it alone.
  const raised = fills(svg(["#ffffff", FULL], ["#f4b214", BIG]), { surfaceFill: "#F4B214", slabMinArea: 0.9 });
  assert.equal(raised[1].fill, "#f4b214", "a 64% region is below a 0.9 slab threshold");
});

test("delay: radial orders by distance to centre, angular by bearing", () => {
  const radial = fills(svg(["#d65a4a", CENTRE], ["#526b4f", CORNER]));
  assert.ok(radial[0].delay < 0.1, `centre path should reveal first, got ${radial[0].delay}`);
  assert.ok(radial[1].delay > 0.8, `corner path should reveal last, got ${radial[1].delay}`);

  const angular = fills(svg(["#d65a4a", CENTRE], ["#526b4f", CORNER]), { order: "angular" });
  assert.notDeepEqual(
    angular.map((p) => p.delay),
    radial.map((p) => p.delay),
    "--order angular must produce a different timeline, not the radial one",
  );
  for (const p of [...radial, ...angular]) assert.ok(p.delay >= 0 && p.delay <= 1, "delay stays in 0..1");
});

test("emits the TracedGlyph shape MotionizedGlyph consumes", () => {
  // It once emitted a bare array + a separate _VIEWBOX const, which no consumer
  // could feed straight into <MotionizedGlyph data viewBox>.
  const { ts, elements, dropped } = svgToGlyphData(svg(["#d65a4a", CENTRE]), { name: "TEST_GLYPH" });
  assert.match(ts, /import type \{ TracedGlyph \}/);
  assert.match(ts, /export const TEST_GLYPH: TracedGlyph = \{ viewBox: "0 0 100 100", data: \[/);
  assert.equal(elements, 1);
  assert.equal(dropped, 0);
});

test("glyphOptionsFromArgs maps every documented flag, including --slab-min-area", () => {
  const args = parseArgs([
    "node", "trace.mjs",
    "--order", "angular",
    "--white-keep", "0.02",
    "--slab-min-area", "0.25",
    "--surface-fill", "#F4B214>#7C3AED",
    "--surface-tolerance", "40",
  ]);
  assert.deepEqual(glyphOptionsFromArgs(args), {
    order: "angular",
    whiteKeep: 0.02,
    slabMinArea: 0.25,
    surfaceFill: "#F4B214>#7C3AED",
    surfaceTolerance: 40,
  });

  const bare = glyphOptionsFromArgs(parseArgs(["node", "trace.mjs"]));
  assert.equal(bare.slabMinArea, null);
  assert.equal(bare.whiteKeep, undefined, "unset must stay undefined so the core's default wins");
  assert.equal(glyphOptionsFromArgs(args, { surfaceFill: null }).surfaceFill, null, "overrides win (trace-set's per-key map)");
});

test("every CLI that emits glyph data goes through the shared option mapping", () => {
  // The drop this lot fixed was a hand-copied options object drifting from the
  // core's signature. Pin the seam itself: no CLI may rebuild it by hand again.
  for (const file of ["trace.mjs", "trace-set.mjs", "emit-glyph.mjs"]) {
    const src = readFileSync(resolve(TOOLS, file), "utf8");
    assert.match(src, /glyphOptionsFromArgs\(/, `${file} must map CLI args through glyphOptionsFromArgs`);
    assert.doesNotMatch(src, /whiteKeep:\s*args\[/, `${file} rebuilds the options object by hand`);
  }
});
