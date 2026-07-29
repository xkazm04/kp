// Contact sheet for the seven traced glyphs: resolve every var(--color-…) to its
// Studio Light and Spark Dark value and rasterize, so the dual-theme claim gets
// checked with eyes rather than asserted from the token names.
import { readFileSync, readdirSync, writeFileSync } from "fs";
import sharp from "sharp";

const LIGHT = {
  "--color-paper": "#fdf8ee",
  "--color-ink": "#17202a",
  "--color-moss": "#526b4f",
  "--color-coral": "#d65a4a",
  "--color-steel": "#42606f",
  "--color-limewash": "#dce7d0",
  "--color-dial-amber": "#caa54c",
  "--color-dial-stone": "#8c8779",
};
const DARK = {
  "--color-paper": "#141b24",
  "--color-ink": "#f4efe3",
  "--color-moss": "#84b27a",
  "--color-coral": "#ff7e68",
  "--color-steel": "#9db5c3",
  "--color-limewash": "#2a382b",
  "--color-dial-amber": "#e5bd62",
  "--color-dial-stone": "#6e7787",
};

// Mirrors app/_components/glyph/glyphTokens.ts — kept in sync by eye; this is a
// verification script, not shipped code.
const HUES = [
  { token: "--color-coral", hue: 7 },
  { token: "--color-dial-amber", hue: 42 },
  { token: "--color-moss", hue: 114 },
  { token: "--color-steel", hue: 200 },
];
const rgb = (hex) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
function hcl([r, g, b]) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return { h: 0, c: 0, l };
  const h = max === R ? 60 * (((G - B) / d + 6) % 6) : max === G ? 60 * ((B - R) / d + 2) : 60 * ((R - G) / d + 4);
  return { h, c: d, l };
}
const hueGap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
function snap(fill) {
  const c = rgb(fill);
  if (!c) return fill.replace(/var\((--[a-z-]+)\)/, "$1");
  const { h, c: chroma, l } = hcl(c);
  if (l > 0.88 && chroma < 0.12) return "--color-paper";
  if (l < 0.2) return "--color-ink";
  if (l > 0.78 && chroma < 0.25 && hueGap(h, 114) < 45) return "--color-limewash";
  if (chroma < 0.09) return "--color-dial-stone";
  let best = HUES[0];
  for (const t of HUES) if (hueGap(h, t.hue) < hueGap(h, best.hue)) best = t;
  return best.token;
}

const dir = "app/_components/glyph/glyphs";
// Optional 3rd arg: a substring filter, so a batch can be checked without
// rendering every committed glyph into one unreadably tall sheet.
const only = process.argv[3];
const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && (!only || f.includes(only)));
const tiles = [];
for (const f of files) {
  const src = readFileSync(`${dir}/${f}`, "utf8");
  const viewBox = /viewBox:\s*"([^"]+)"/.exec(src)[1];
  const data = JSON.parse(/data:\s*(\[.*\])\s*}/s.exec(src)[1]);
  for (const [theme, PAL] of [["light", LIGHT], ["dark", DARK]]) {
    const paths = data
      .map((p) => `<path d="${p.d}" fill="${PAL[snap(p.fill)] ?? PAL["--color-ink"]}"/>`)
      .join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="220" height="220"><rect width="100%" height="100%" fill="${PAL["--color-paper"]}"/>${paths}</svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    tiles.push({ name: f.replace("Glyph.ts", ""), theme, png });
  }
}

// One contact sheet: a row per glyph, light | dark.
const names = [...new Set(tiles.map((t) => t.name))];
const W = 220, H = 220;
const composite = tiles.map((t) => ({
  input: t.png,
  left: t.theme === "light" ? 0 : W,
  top: names.indexOf(t.name) * H,
}));
const sheet = await sharp({
  create: { width: W * 2, height: H * names.length, channels: 3, background: "#888888" },
})
  .composite(composite)
  .png()
  .toBuffer();
writeFileSync(process.argv[2], sheet);
console.log(JSON.stringify({ order: names, columns: ["light", "dark"] }));
