/**
 * Fixtures for the dual-theme contact sheet — the skill's only unskippable
 * visual gate (SKILL.md step 5), which crashed on the committed glyph folder
 * because its `.ts` filter also picked up `glyphData.test.ts`.
 *
 * The other half of what is pinned here: the renderer must not hold its OWN
 * copy of the palette or the token snap. It used to carry both, "kept in sync by
 * eye" — a verification tool that re-implements what it verifies can agree with
 * itself while disagreeing with the app.
 *
 * Run: node --test .claude/skills/motionize/tools/__tests__/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  GLOBALS_CSS,
  GLYPH_DIR,
  GLYPH_TOKENS,
  glyphSvg,
  isGlyphModule,
  parseGlyphModule,
  readPalettes,
  tokenFor,
} from "../render-sheet.mjs";
import { snapToToken } from "../../../../../app/_components/glyph/glyphTokens.ts";

const RENDER_SHEET_SRC = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../render-sheet.mjs"), "utf8");

test("the glyph filter takes glyph modules and leaves the colocated tests", () => {
  assert.equal(isGlyphModule("pipelineGlyph.ts"), true);
  assert.equal(isGlyphModule("glyphData.test.ts"), false, "the crash: a test file is not a TracedGlyph module");
  assert.equal(isGlyphModule("glyphsHaveConsumers.test.ts"), false);
  assert.equal(isGlyphModule("MotionizedGlyph.tsx"), false);
});

test("every committed glyph module parses and rasterizes in both themes", () => {
  const files = readdirSync(GLYPH_DIR).filter(isGlyphModule);
  assert.ok(files.length >= 10, `expected the committed glyph set, found ${files.length}`);
  const palettes = readPalettes();
  for (const f of files) {
    const glyph = parseGlyphModule(readFileSync(`${GLYPH_DIR}/${f}`, "utf8"), f);
    assert.match(glyph.viewBox, /^[\d\s.-]+$/, `${f}: viewBox`);
    assert.ok(glyph.data.length > 0, `${f}: no paths`);
    for (const theme of ["light", "dark"]) {
      const svg = glyphSvg(glyph, palettes[theme]);
      assert.doesNotMatch(svg, /fill="var\(/, `${f} (${theme}): every fill must be resolved to a literal for raster`);
      assert.doesNotMatch(svg, /fill="undefined"/, `${f} (${theme}): unresolved token`);
    }
  }
});

test("the palettes are READ from app/globals.css, not copied into the tool", () => {
  const css = readFileSync(GLOBALS_CSS, "utf8");
  const { light, dark } = readPalettes(css);
  for (const t of GLYPH_TOKENS) {
    assert.match(light[t], /^#[0-9a-fA-F]{3,8}$/, `light ${t}`);
    assert.match(dark[t], /^#[0-9a-fA-F]{3,8}$/, `dark ${t}`);
    assert.notEqual(light[t], dark[t], `${t} must actually differ between the themes`);
    // The drift this replaces: two hand-maintained hex tables inside the tool.
    assert.ok(!RENDER_SHEET_SRC.includes(light[t]), `render-sheet.mjs hardcodes the light ${t} value`);
    assert.ok(!RENDER_SHEET_SRC.includes(dark[t]), `render-sheet.mjs hardcodes the dark ${t} value`);
  }
});

test("mutating globals.css moves the sheet's colours", () => {
  // Mutation check: if the reader were a decorative wrapper over a private copy,
  // an edited stylesheet would change nothing here.
  const css = readFileSync(GLOBALS_CSS, "utf8").replace("--color-coral: #d65a4a;", "--color-coral: #010203;");
  assert.equal(readPalettes(css).light["--color-coral"], "#010203");

  const glyph = { viewBox: "0 0 10 10", data: [{ d: "M1 1 L2 2", fill: "#d65a4a", delay: 0 }] };
  assert.match(glyphSvg(glyph, readPalettes(css).light), /fill="#010203"/);
});

test("a globals.css that lost a glyph token fails loudly instead of rendering it black", () => {
  const css = readFileSync(GLOBALS_CSS, "utf8").replace("--color-limewash: #dce7d0;", "");
  assert.throws(() => readPalettes(css), /no light value for --color-limewash/);
  assert.throws(() => readPalettes("/* no blocks at all */"), /not found in app\/globals\.css/);
});

test("the sheet's token snap IS the shipped renderer's snap", () => {
  assert.ok(!RENDER_SHEET_SRC.includes("function snap("), "render-sheet.mjs must not re-implement the snap");
  assert.match(RENDER_SHEET_SRC, /import \{ snapToToken \}/);
  for (const fill of ["#d65a4a", "#89a17e", "#fdf8ee", "#040404", "#8c8779", "#caa54c", "#42606f", "#dce7d0"]) {
    assert.equal(`var(${tokenFor(fill)})`, snapToToken(fill).paint, `snap disagreement on ${fill}`);
  }
  assert.equal(tokenFor("var(--color-paper)"), "--color-paper", "an already-tokenized fill passes through");
});

test("every token the snap can return has a value in both palettes", () => {
  // GLYPH_TOKENS is the tool's contract with glyphTokens.ts; if the snap gains a
  // token, the sheet must learn it rather than silently falling back to ink.
  const palettes = readPalettes();
  const reachable = new Set(
    ["#d65a4a", "#caa54c", "#526b4f", "#42606f", "#fdf8ee", "#040404", "#8c8779", "#dce7d0"].map(tokenFor),
  );
  for (const t of reachable) {
    assert.ok(GLYPH_TOKENS.includes(t), `${t} is reachable from snapToToken but missing from GLYPH_TOKENS`);
    assert.ok(palettes.light[t] && palettes.dark[t], `${t} has no value in one of the palettes`);
  }
});

test("parseGlyphModule refuses a file that is not a TracedGlyph module", () => {
  assert.throws(() => parseGlyphModule("export const x = 1;", "x.ts"), /not a TracedGlyph module/);
});
