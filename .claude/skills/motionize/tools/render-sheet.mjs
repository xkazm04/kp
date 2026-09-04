#!/usr/bin/env node
/**
 * Contact sheet for the committed traced glyphs: resolve every path's fill to its
 * Studio Light and Spark Dark value and rasterize, so the dual-theme claim gets
 * checked with eyes rather than asserted from the token names.
 *
 * Usage:
 *   node .claude/skills/motionize/tools/render-sheet.mjs <out.png> [name-substring]
 *
 * Nothing here is a second opinion about colour. The token snap is IMPORTED from
 * `app/_components/glyph/glyphTokens.ts` (the same function the renderer ships)
 * and both palettes are READ from `app/globals.css` (Tailwind 4's
 * `@theme` block and `[data-theme="dark"]`). The two hand-maintained copies that used to live here
 * were "kept in sync by eye", which is exactly the drift this sheet exists to
 * catch — a verification tool that re-implements what it verifies verifies nothing.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { snapToToken } from "../../../../app/_components/glyph/glyphTokens.ts";

/** tools/ → motionize/ → skills/ → .claude/ → repo root. cwd-independent. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const GLYPH_DIR = resolve(REPO_ROOT, "app/_components/glyph/glyphs");
export const GLOBALS_CSS = resolve(REPO_ROOT, "app/globals.css");

/** Every brand token a traced glyph can resolve to, via `snapToToken`. */
export const GLYPH_TOKENS = [
  "--color-paper",
  "--color-ink",
  "--color-limewash",
  "--color-dial-stone",
  "--color-coral",
  "--color-dial-amber",
  "--color-moss",
  "--color-steel",
];

/**
 * `@theme { … }` → Studio Light (Tailwind 4 declares the brand tokens there), `[data-theme="dark"] { … }` → Spark Dark. Only the
 * literal `--color-x: #hex;` declarations are taken: the aliases (`var(...)`,
 * `color-mix(...)`) are not glyph tokens and would not rasterize.
 */
export function readPalettes(css = readFileSync(GLOBALS_CSS, "utf8")) {
  const block = (startRe) => {
    const m = startRe.exec(css);
    if (!m) throw new Error(`render-sheet: ${startRe} not found in app/globals.css`);
    const open = css.indexOf("{", m.index);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
    }
    throw new Error(`render-sheet: unterminated block for ${startRe} in app/globals.css`);
  };
  const vars = (body) =>
    Object.fromEntries([...body.matchAll(/(--color-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)].map((m) => [m[1], m[2]]));

  const palettes = { light: vars(block(/^@theme\b/m)), dark: vars(block(/^\[data-theme="dark"\]/m)) };
  for (const [theme, pal] of Object.entries(palettes)) {
    const missing = GLYPH_TOKENS.filter((t) => !pal[t]);
    if (missing.length) throw new Error(`render-sheet: app/globals.css has no ${theme} value for ${missing.join(", ")}`);
  }
  return palettes;
}

/** A traced fill → the token NAME the shipped renderer would paint it with. */
export function tokenFor(fill) {
  const { paint } = snapToToken(fill);
  const m = /var\((--[a-z0-9-]+)\)/.exec(paint);
  return m ? m[1] : paint;
}

/** Committed glyph modules only — `glyphData.test.ts` is not a glyph. */
export const isGlyphModule = (f) => f.endsWith("Glyph.ts");

/** Parse a committed glyph module without importing it (no TS runtime needed). */
export function parseGlyphModule(src, file) {
  const vb = /viewBox:\s*"([^"]+)"/.exec(src);
  const data = /data:\s*(\[.*\])\s*}/s.exec(src);
  if (!vb || !data) throw new Error(`render-sheet: ${file} is not a TracedGlyph module ({ viewBox, data })`);
  return { viewBox: vb[1], data: JSON.parse(data[1]) };
}

export function glyphSvg({ viewBox, data }, palette, size = 220) {
  const paths = data
    .map((p) => `<path d="${p.d}" fill="${palette[tokenFor(p.fill)] ?? palette["--color-ink"]}"/>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${size}" height="${size}"><rect width="100%" height="100%" fill="${palette["--color-paper"]}"/>${paths}</svg>`;
}

async function main() {
  const [out, only] = process.argv.slice(2);
  if (!out || out.startsWith("--")) {
    console.error("Usage: node render-sheet.mjs <out.png> [name-substring]");
    process.exit(1);
  }

  const palettes = readPalettes();
  const files = readdirSync(GLYPH_DIR)
    .filter((f) => isGlyphModule(f) && (!only || f.includes(only)))
    .sort();
  if (files.length === 0) {
    console.error(`render-sheet: no glyph modules in ${GLYPH_DIR}${only ? ` matching "${only}"` : ""}`);
    process.exit(1);
  }

  const W = 220, H = 220;
  const tiles = [];
  for (const f of files) {
    const glyph = parseGlyphModule(readFileSync(`${GLYPH_DIR}/${f}`, "utf8"), f);
    for (const theme of ["light", "dark"]) {
      const png = await sharp(Buffer.from(glyphSvg(glyph, palettes[theme], W))).png().toBuffer();
      tiles.push({ name: f.replace("Glyph.ts", ""), theme, png });
    }
  }

  // One contact sheet: a row per glyph, light | dark. The count is the count of
  // what was actually found — the header used to claim "seven" long after 19 shipped.
  const names = [...new Set(tiles.map((t) => t.name))];
  const sheet = await sharp({
    create: { width: W * 2, height: H * names.length, channels: 3, background: "#888888" },
  })
    .composite(tiles.map((t) => ({ input: t.png, left: t.theme === "light" ? 0 : W, top: names.indexOf(t.name) * H })))
    .png()
    .toBuffer();
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, sheet);
  console.log(JSON.stringify({ glyphs: names.length, order: names, columns: ["light", "dark"], output: resolve(out) }));
}

// Run as CLI only when invoked directly (not when imported by the tests).
if (process.argv[1]?.endsWith("render-sheet.mjs")) await main();
