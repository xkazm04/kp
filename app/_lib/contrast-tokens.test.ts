// WCAG 2.x contrast gate for the AA-safe coral twins. Reads app/globals.css, so a
// token edit that drops below 4.5:1 fails here rather than in an axe run.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../globals.css", import.meta.url)), "utf8");

function tokens(opener: string): Map<string, string> {
  const start = css.indexOf(opener);
  assert.notEqual(start, -1, `no ${opener} block`);
  let depth = 0;
  let end = start;
  for (let i = start + opener.length - 1; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  const out = new Map<string, string>();
  for (const m of css.slice(start, end).matchAll(/--color-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) out.set(m[1], m[2].toLowerCase());
  return out;
}

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const lum = (c: Rgb) => {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: Rgb, b: Rgb) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
/** `fg` at alpha `a` over `bg` (what `bg-coral/10` paints). */
const over = (fg: Rgb, bg: Rgb, a: number): Rgb => fg.map((v, i) => v * a + bg[i] * (1 - a)) as Rgb;

const THEMES = [
  { name: "light", t: tokens("@theme {") },
  { name: "dark", t: tokens('[data-theme="dark"] {') },
];

for (const { name, t } of THEMES) {
  // Light theme inherits nothing from dark and vice versa, but dark only re-declares what
  // changes: fall back to the light value for tokens it does not override.
  const light = THEMES[0].t;
  const get = (k: string) => rgb(t.get(k) ?? light.get(k)!);
  const coral = get("coral");
  const surfaces: Array<[string, Rgb]> = [
    ["paper", get("paper")],
    ["white", get("white")],
    ["stone-100", get("stone-100")],
    ["coral/10 on paper", over(coral, get("paper"), 0.1)],
    ["coral/10 on white", over(coral, get("white"), 0.1)],
    ["coral/15 on paper", over(coral, get("paper"), 0.15)],
    ["coral/15 on white", over(coral, get("white"), 0.15)],
  ];

  test(`${name}: text-coral-ink clears 4.5:1 on every surface it sits on`, () => {
    for (const [label, bg] of surfaces) {
      const r = ratio(get("coral-ink"), bg);
      assert.ok(r >= 4.5, `coral-ink on ${label} = ${r.toFixed(2)}:1`);
    }
  });

  test(`${name}: text-white on bg-coral-solid clears 4.5:1`, () => {
    const r = ratio(get("white"), get("coral-solid"));
    assert.ok(r >= 4.5, `white on coral-solid = ${r.toFixed(2)}:1`);
  });

  test(`${name}: full-strength text-steel (the muted-label step) clears 4.5:1 on paper and white`, () => {
    for (const bg of [get("paper"), get("white")]) assert.ok(ratio(get("steel"), bg) >= 4.5);
  });
}
