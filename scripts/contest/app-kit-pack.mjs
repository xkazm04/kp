#!/usr/bin/env node
// app-kit-pack.mjs - the app's real style, staged for a design contest on an APP surface.
//
// A contest seat builds a static prototype (plain HTML/CSS/JS, no build). Left alone it invents its
// own fonts, type steps and components, and the winner then has to be re-skinned into the app. This
// writes the app's own vocabulary into `<target>/app-kit/` so a seat starts from it instead:
//
//   tokens.css      every token a surface may paint with, BOTH themes (Studio Light on :root, Spark
//                   Dark on [data-theme="dark"]), resolved from app/globals.css, the fonts app/layout.tsx
//                   loads (as a Google Fonts @import), the Tailwind stock shades the app has mapped for
//                   dark, and the kit's own variables (kit.css, graphic.css, scene/scene.css); then the
//                   type steps, the focus ring, .nums and the shared motion classes. <link> it.
//   components.md   each kit part (kit.css, scene.css) as the plain CSS it already is, and each recipe
//                   (app/_components/ui/recipes.ts, Tailwind class strings) translated to a plain class
//                   (.kp-panel, .kp-btn-primary, ...): what a prototype imitates instead of inventing.
//   GUIDE.md        docs/design/app-contest-kit.md, copied: what to take, what stays free.
//   reference/      the PNGs in --shots (the Overview in both themes: the worked example).
//
//   node scripts/contest/app-kit-pack.mjs <targetDir> [--shots <dir with .png>]
//
// Builtins only; node 24 (it imports app/_components/kit/marks.ts, type-stripped, for the mark SVGs).
// Pinned by scripts/contest/__tests__/app-kit-pack.test.mjs. Documented in .claude/contest/config.md.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const SRC = {
  globals: "app/globals.css",
  layout: "app/layout.tsx",
  tailwind: "node_modules/tailwindcss/theme.css",
  kit: "app/_components/kit/kit.css",
  graphic: "app/_components/kit/graphic/graphic.css",
  scene: "app/_components/kit/scene/scene.css",
  recipes: "app/_components/ui/recipes.ts",
  marks: "app/_components/kit/marks.ts",
  guide: "docs/design/app-contest-kit.md",
};

/* ================================================================ a small CSS reader */

export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Top-level statements of a stylesheet: `{ prelude, body }` for a block (an at-rule block's body is
 * parsed again into `children` when it holds rules), `{ prelude, body: null }` for a bare statement.
 */
export function parseBlocks(css) {
  const src = stripComments(css);
  const out = [];
  let depth = 0;
  let start = 0;
  let open = -1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "{") {
      if (depth === 0) open = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        const prelude = src.slice(start, open).trim();
        const body = src.slice(open + 1, i);
        const nested = /^@(media|container|supports|layer)\b/.test(prelude);
        out.push({ prelude, body, children: nested ? parseBlocks(body) : null });
        start = i + 1;
      }
    } else if (c === ";" && depth === 0) {
      const text = src.slice(start, i).trim();
      if (text) out.push({ prelude: text, body: null, children: null });
      start = i + 1;
    }
  }
  return out;
}

/** The custom properties a block body declares, in order: [[name, value]]. */
export function customProps(body) {
  const out = [];
  for (const m of stripComments(body).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.push([m[1], m[2].trim().replace(/\s+/g, " ")]);
  return out;
}

const norm = (s) => s.replace(/\s+/g, " ").trim();
const findBlock = (blocks, prelude) => blocks.filter((b) => b.body !== null && norm(b.prelude) === prelude);
const propsOf = (blocks, prelude) => findBlock(blocks, prelude).flatMap((b) => customProps(b.body));

/**
 * The rules whose selector passes `keep`, as CSS text, with their at-rule wrappers and the keyframes
 * they name. `keep(selector)` sees one selector list at a time.
 */
export function pickRules(css, keep) {
  const blocks = parseBlocks(css);
  const frames = new Map(blocks.filter((b) => /^@keyframes\s/.test(b.prelude)).map((b) => [b.prelude.split(/\s+/)[1], b]));
  const used = new Set();
  const emit = (list, indent) => {
    const lines = [];
    for (const b of list) {
      if (b.body === null || /^@keyframes\s/.test(b.prelude)) continue;
      if (b.children) {
        const inner = emit(b.children, indent + "  ");
        if (inner.length) lines.push(`${indent}${norm(b.prelude)} {`, ...inner, `${indent}}`);
        continue;
      }
      if (b.prelude.startsWith("@") || !keep(norm(b.prelude))) continue;
      const decls = norm(b.body);
      for (const [name] of frames) if (new RegExp(`\\b${name}\\b`).test(decls)) used.add(name);
      lines.push(`${indent}${norm(b.prelude)} { ${decls} }`);
    }
    return lines;
  };
  const lines = emit(blocks, "");
  for (const name of used) lines.push(`${norm(frames.get(name).prelude)} { ${norm(frames.get(name).body)} }`);
  return lines.join("\n");
}

/** A selector keeper: any class in the list, as a whole class or with a suffix (`k-btn` keeps `.k-btn--sm`). */
export const byClass = (prefixes) => {
  const re = new RegExp(`\\.(?:${prefixes.map((p) => p.replace(/[-]/g, "\\-")).join("|")})(?![a-zA-Z0-9])`);
  return (sel) => re.test(sel);
};

/* ================================================================ tokens.css */

/** next/font families from app/layout.tsx: `--font-x` -> { family, weights }. */
export function fontFamilies(layoutSrc) {
  const out = new Map();
  for (const m of layoutSrc.matchAll(/const\s+\w+\s*=\s*([A-Z][A-Za-z_]*)\(\{([\s\S]*?)\}\);/g)) {
    const variable = /variable:\s*"(--[\w-]+)"/.exec(m[2])?.[1];
    if (!variable) continue;
    const weights = /weight:\s*\[([^\]]*)\]/.exec(m[2])?.[1].match(/\d+/g) ?? null;
    out.set(variable, { family: m[1].replace(/_/g, " "), weights });
  }
  return out;
}

const EXCLUDE_TOKEN = /^--(color-cv-|color-diagram-|z-|sim-)/;
const FAMILIES = ["stone", "red", "amber", "green", "blue"];

/** Everything tokens.css is made of, read from the repo. */
export function readTokens(repo = REPO) {
  const read = (rel) => readFileSync(path.join(repo, rel), "utf8");
  const globals = parseBlocks(read(SRC.globals));
  const theme = propsOf(globals, "@theme");
  const root = propsOf(globals, ":root");
  const dark = propsOf(globals, '[data-theme="dark"]');
  const tw = parseBlocks(read(SRC.tailwind));
  const stock = new Map([...propsOf(tw, "@theme"), ...propsOf(tw, "@theme default")]);
  const kitSheets = [SRC.kit, SRC.graphic, SRC.scene].map((f) => parseBlocks(read(f)));
  const kitLight = kitSheets.flatMap((b) => propsOf(b, ".k-kit"));
  const kitDark = kitSheets.flatMap((b) => propsOf(b, '[data-theme="dark"] .k-kit'));
  const fonts = fontFamilies(read(SRC.layout));
  // A stock shade is sanctioned when the app gave it a Spark Dark value (docs/design/README.md), plus the
  // two text greys that stay stock in both themes on purpose.
  const darkNames = new Set(dark.map(([n]) => n));
  const themeNames = new Set(theme.map(([n]) => n));
  const shades = [];
  for (const fam of FAMILIES) {
    for (const [n, v] of stock) {
      if (!n.startsWith(`--color-${fam}-`) || themeNames.has(n)) continue;
      if (darkNames.has(n) || n === "--color-stone-500" || n === "--color-stone-600") shades.push([n, v]);
    }
  }
  return { theme, root, dark, shades, kitLight, kitDark, fonts };
}

const decl = (pairs, indent = "  ") => pairs.filter(([n]) => !EXCLUDE_TOKEN.test(n)).map(([n, v]) => `${indent}${n}: ${v};`).join("\n");

export function fontsImport(fonts) {
  const fams = [...fonts.values()].map(({ family, weights }) => `family=${family.replace(/ /g, "+")}:wght@${(weights ?? ["400", "500", "600", "700", "800"]).join(";")}`);
  return `@import url("https://fonts.googleapis.com/css2?${fams.join("&")}&display=swap");`;
}

const TYPE_STEPS = ["display", "h2", "h3", "body", "meta", "micro"];

export function tokensCss(t, globalsCss, stamp) {
  const fontVars = [...t.fonts].map(([v, { family }]) => [v, `"${family}"`]);
  const typeSteps = TYPE_STEPS.map((s) => {
    const has = (k) => t.theme.some(([n]) => n === `--text-${s}--${k}`);
    const parts = [`font-size: var(--text-${s});`];
    if (has("line-height")) parts.push(`line-height: var(--text-${s}--line-height);`);
    if (has("font-weight")) parts.push(`font-weight: var(--text-${s}--font-weight);`);
    if (has("letter-spacing")) parts.push(`letter-spacing: var(--text-${s}--letter-spacing);`);
    return `.text-${s} { ${parts.join(" ")} }`;
  });
  const base = pickRules(globalsCss, (sel) =>
    sel === ".nums" || /focus-ring|:focus-visible/.test(sel) || /\.(animate-[\w-]+|stagger-children|reveal-quiet)\b/.test(sel) ||
    sel.startsWith('[data-theme="dark"] .shadow-panel') || sel.startsWith('[data-theme="dark"] ::selection'));
  return `/* kp app-kit tokens: the app's real paint for a static prototype. Generated by
   scripts/contest/app-kit-pack.mjs${stamp ? ` on ${stamp}` : ""} from ${SRC.globals}, ${SRC.layout} (fonts),
   the Tailwind stock shades the app maps for Spark Dark, and the kit's variables (kit.css, graphic.css,
   scene.css). Regenerate, never edit. Studio Light is :root; Spark Dark is <html data-theme="dark">.
   Paint ONLY through these variables (no literal colour): that is what lets one prototype carry both
   registers and port into the app without a re-skin. */
${fontsImport(t.fonts)}

/* ---------------------------------------------------------------- Studio Light (default) */
:root {
  color-scheme: light;
  /* the loaded faces (next/font sets these in the app) */
${decl(fontVars)}
  /* app/globals.css @theme: brand, neutrals, type, shadows */
${decl(t.theme)}
  /* Tailwind stock shades the app has mapped for dark (the sanctioned status set) */
${decl(t.shades)}
  /* app/globals.css :root: the elevation values the shadow tokens read */
${decl(t.root)}
  /* the kit's variables (.k-kit in kit.css, graphic.css, scene.css) */
${decl(t.kitLight)}
}

/* ---------------------------------------------------------------- Spark Dark */
[data-theme="dark"] {
  color-scheme: dark;
${decl(t.dark)}
${decl(t.kitDark)}
}

/* ---------------------------------------------------------------- base */
/* the two resets of the app's Tailwind preflight the parts rely on: no default borders, bare buttons */
*, ::before, ::after { box-sizing: border-box; border-width: 0; border-style: solid; border-color: currentColor; }
button { background: none; color: inherit; font: inherit; cursor: pointer; }
body { margin: 0; background: var(--color-paper); color: var(--color-ink); font-family: var(--font-sans); font-size: var(--text-body); line-height: var(--text-body--line-height); }
.font-serif { font-family: var(--font-serif); }
/* the six type steps; nothing renders below 14px */
${typeSteps.join("\n")}
/* from app/globals.css: tabular numerals, the focus ring, the Spark Dark panel ride, the motion classes */
${base}
`;
}

/* ================================================================ recipes -> plain CSS */

/** `export const NAME = "..."` string recipes (template-literal compositions are skipped). */
export function recipeStrings(src) {
  const out = new Map();
  for (const m of src.matchAll(/export const ([A-Z][A-Z0-9_]*)\s*=\s*\n?\s*"([^"]*)";/g)) out.set(m[1], m[2]);
  return out;
}

const SPACE = (n) => `${Number(n) * 4}px`;
const RADIUS = { none: "0", sm: "4px", "": "4px", md: "6px", lg: "8px", xl: "12px", "2xl": "16px", "3xl": "24px", full: "9999px" };
const WEIGHT = { normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800 };
const SIZE = { sm: ["14px", "1.43"], base: ["16px", "1.5"], lg: ["18px", "1.56"] };
const EASE = "cubic-bezier(.4, 0, .2, 1)";
const COLOR_WORD = /^(ink|paper|coral|moss|steel|limewash|coralwash|white|dial-stone|dial-amber|scrim|(stone|red|amber|green|blue)-\d+)$/;
const colorOf = (word) => {
  const [c, alpha] = word.split("/");
  if (!COLOR_WORD.test(c)) return null;
  return alpha ? `color-mix(in oklab, var(--color-${c}) ${alpha}%, transparent)` : `var(--color-${c})`;
};
const arb = (s) => /^\[(.+)\]$/.exec(s)?.[1] ?? null;

/** One Tailwind utility (no variant) as declarations, or null when this translator does not know it. */
export function utility(u) {
  const neg = u.startsWith("-");
  const w = neg ? u.slice(1) : u;
  const fixed = {
    "inline-flex": { display: "inline-flex" }, "inline-block": { display: "inline-block" }, "inline-grid": { display: "inline-grid" },
    flex: { display: "flex" }, "flex-col": { "flex-direction": "column" }, "items-center": { "align-items": "center" },
    "justify-center": { "justify-content": "center" }, "place-items-center": { "place-items": "center" },
    uppercase: { "text-transform": "uppercase" }, border: { "border-width": "1px", "border-style": "solid" },
    "border-2": { "border-width": "2px", "border-style": "solid" }, "leading-none": { "line-height": "1" },
    nums: { "font-variant-numeric": "tabular-nums" }, "font-serif": { "font-family": "var(--font-serif)" },
    "font-sans": { "font-family": "var(--font-sans)" }, "focus-ring": { outline: "none" },
    "transition-all": { transition: `all .15s ${EASE}` },
    "transition-colors": { transition: `color, background-color, border-color, text-decoration-color, fill, stroke .15s ${EASE}` },
    "transition-transform": { transition: `transform, translate, scale, rotate .15s ${EASE}` },
    "shadow-none": { "box-shadow": "0 0 #0000" },
  };
  if (fixed[u]) return fixed[u];
  let m;
  if ((m = /^rounded(?:-(none|sm|md|lg|xl|2xl|3xl|full))?$/.exec(u))) return { "border-radius": RADIUS[m[1] ?? ""] };
  if ((m = /^(p|px|py|gap|h|w)-(\d+(?:\.\d+)?)$/.exec(u))) {
    const v = SPACE(m[2]);
    return { p: { padding: v }, px: { "padding-inline": v }, py: { "padding-block": v }, gap: { gap: v }, h: { height: v }, w: { width: v } }[m[1]];
  }
  if ((m = /^font-(normal|medium|semibold|bold|extrabold)$/.exec(u))) return { "font-weight": String(WEIGHT[m[1]]) };
  if ((m = /^text-(display|h2|h3|body|meta|micro)$/.exec(u))) return { "font-size": `var(--text-${m[1]})`, "line-height": `var(--text-${m[1]}--line-height)` };
  if ((m = /^text-(sm|base|lg)$/.exec(u))) return { "font-size": SIZE[m[1]][0], "line-height": SIZE[m[1]][1] };
  if ((m = /^text-(.+)$/.exec(u)) && colorOf(m[1])) return { color: colorOf(m[1]) };
  if ((m = /^bg-(.+)$/.exec(u)) && colorOf(m[1])) return { "background-color": colorOf(m[1]) };
  if ((m = /^border-(.+)$/.exec(u)) && colorOf(m[1])) return { "border-color": colorOf(m[1]) };
  if ((m = /^caret-(.+)$/.exec(u)) && colorOf(m[1])) return { "caret-color": colorOf(m[1]) };
  if ((m = /^shadow-(panel|pop|overlay|sticker-sm|sticker-xs)$/.exec(u))) return { "box-shadow": `var(--shadow-${m[1]})` };
  if ((m = /^opacity-(\d+)$/.exec(u))) return { opacity: String(Number(m[1]) / 100) };
  if ((m = /^rotate-(\d+)$/.exec(w))) return { rotate: `${neg ? "-" : ""}${m[1]}deg` };
  if ((m = /^translate-([xy])-(.+)$/.exec(w))) {
    const v = arb(m[2]) ?? SPACE(m[2]);
    return { [`--t${m[1]}`]: neg ? `-${v}` : v };
  }
  return null;
}

/**
 * A recipe's class string as plain CSS for `.kp-<name>`: base, hover, disabled, placeholder, the
 * Spark Dark variants (`dark:` follows [data-theme="dark"] in the app), and the dark ride a
 * `shadow-panel` surface takes (globals.css). Unknown utilities are listed, never guessed.
 */
export function recipeCss(name, classes, darkPanelRide = "") {
  const cls = `.kp-${name.toLowerCase().replace(/_/g, "-")}`;
  const groups = new Map();
  const unmapped = [];
  for (const token of classes.split(/\s+/).filter(Boolean)) {
    const parts = token.split(":");
    const u = parts.pop();
    const variants = parts.sort().join(":");
    const d = utility(u);
    if (!d) {
      unmapped.push(token);
      continue;
    }
    groups.set(variants, Object.assign(groups.get(variants) ?? {}, d));
  }
  const sel = (v) => {
    const vs = v ? v.split(":") : [];
    let s = cls;
    if (vs.includes("hover")) s += ":hover";
    if (vs.includes("disabled")) s += ":disabled";
    if (vs.includes("placeholder")) s += "::placeholder";
    return vs.includes("dark") ? `[data-theme="dark"] ${s}` : s;
  };
  const order = ["", "hover", "disabled", "placeholder", "dark", "dark:hover"];
  const rank = (v) => (order.includes(v) ? order.indexOf(v) : order.length);
  const keys = [...groups.keys()].sort((x, y) => rank(x) - rank(y));
  const lines = [];
  for (const v of keys) {
    const d = { ...groups.get(v) };
    if ("--tx" in d || "--ty" in d) {
      d.translate = `${d["--tx"] ?? "0"} ${d["--ty"] ?? "0"}`;
      delete d["--tx"];
      delete d["--ty"];
    }
    lines.push(`${sel(v)} { ${Object.entries(d).map(([k, val]) => `${k}: ${val};`).join(" ")} }`);
  }
  if (classes.includes("focus-ring")) lines.push(`${cls}:focus-visible { box-shadow: 0 0 0 2px var(--color-paper), 0 0 0 4px var(--color-coral); }`);
  if (/(^|\s)shadow-panel(\s|$)/.test(classes) && darkPanelRide) lines.push(`[data-theme="dark"] ${cls} { ${darkPanelRide} }`);
  return { css: lines.join("\n"), unmapped };
}

/* ================================================================ components.md */

/** The kit's parts a prototype imitates: which classes, from which sheet, what each is for. */
export const PARTS = [
  { name: "Button", sheet: "kit", classes: ["k-btn"], for: "primary (coral: the main action) / affirm (moss: the positive half of a decision) / secondary / ghost / danger / link; sm 32, md 40, lg 48px; a loading LABEL, never a spinner", app: "app/_components/kit/Button.tsx" },
  { name: "Page head", sheet: "kit", classes: ["k-head", "k-eyebrow", "k-title", "k-context"], for: "coral eyebrow, the display title, one context line, 0-4 figures, at most one primary action", app: "app/_components/kit/PageHead.tsx" },
  { name: "Figure / stat strip", sheet: "kit", classes: ["k-fig", "k-stats"], for: "the ONE way a number is set: serif numeral, sans unit, quiet 'of N'; null prints a dash with its reason", app: "app/_components/kit/FigureView.tsx" },
  { name: "Section", sheet: "kit", classes: ["k-section"], for: "a serif head with a numeral count and one state line, bounded by one rule (planes, not boxes)", app: "app/_components/kit/Section.tsx" },
  { name: "Chip / tag", sheet: "kit", classes: ["k-chips", "k-chip", "k-tag"], for: "an actionable 30px chip with a mark and a count; a tag is inert", app: "app/_components/kit/ChipRow.tsx" },
  { name: "Segmented", sheet: "kit", classes: ["k-seg"], for: "the section switch (a raised pressed segment; amber sticker in Spark Dark)", app: "app/_components/kit/Toolbar.tsx" },
  { name: "Field", sheet: "kit", classes: ["k-field"], for: "a 40px (md) / 32px (sm) field; coral focus ring; error in red", app: "app/_components/kit/Field.tsx" },
  { name: "Mark", sheet: "kit", classes: ["k-mark"], for: "a 16px status mark whose SHAPE carries the meaning (SVGs below); colour is second, words are always beside it", app: "app/_components/kit/Mark.tsx" },
  { name: "Level frame", sheet: "scene", classes: ["k-lvl"], for: "a level you walked into: trail, kicker, heading, one lead line, the sheet, a foot with the keys; tinted by one token", app: "app/_components/kit/scene/LevelFrame.tsx" },
  { name: "Level trail", sheet: "scene", classes: ["k-trail", "k-crumbs"], for: "a back button that names where it goes, then the breadcrumb", app: "app/_components/kit/scene/LevelTrail.tsx" },
  { name: "Level transition", sheet: "scene", classes: ["k-layer"], for: "the circle wipe (clip-path from the touched element: open 760ms, close 560ms); reduced motion cross-fades", app: "app/_components/kit/scene/LevelTransition.tsx" },
  { name: "Key hints", sheet: "scene", classes: ["k-keys"], for: "the keys a level answers to, stated where they apply (never bare letters)", app: "app/_components/kit/scene/KeyHints.tsx" },
  { name: "Condition mark", sheet: "scene", classes: ["k-cond"], for: "a condition in shape AND words: live, wait, reach, fail, off, unknown (unknown = not read, never a guess)", app: "app/_components/kit/scene/ConditionMark.tsx" },
  { name: "Name plate", sheet: "scene", classes: ["k-plate"], for: "a thing's name, its condition, ONE fact; the border repeats the condition (dashed = not set up)", app: "app/_components/kit/scene/NamePlate.tsx" },
  { name: "Needs list", sheet: "scene", classes: ["k-needlist", "k-need"], for: "'needs you, worst first': one button per thing, its severity as a shape", app: "app/_components/kit/scene/Needs.tsx" },
  { name: "Queue card", sheet: "scene", classes: ["k-queue"], for: "a queue: count + noun (one press), the most urgent names, where they stand, the door where it is worked", app: "app/_components/kit/scene/QueueCard.tsx" },
  { name: "Hand note", sheet: "scene", classes: ["k-hand"], for: "a margin note in the register's display face (italic serif / tilted bold); never a new font", app: "app/_components/kit/scene/HandNote.tsx" },
  { name: "Wires, threads, arrow", sheet: "scene", classes: ["k-wires", "k-wire", "k-threads", "k-note-arrow"], for: "cards wired to the figure they describe; lit coral when pointed at", app: "app/_components/kit/scene/Wires.tsx" },
  { name: "Halos", sheet: "scene", classes: ["k-halos"], for: "breathing halos on what is pointed at (a state, never ambient)", app: "app/_components/kit/scene/Halos.tsx" },
  { name: "Lit ground", sheet: "scene", classes: ["k-lit"], for: "a soft amber glow under the one figure to look at (a plane, not a panel)", app: "app/_components/kit/scene/LitGround.tsx" },
];

export const RECIPES = [
  ["PANEL", "a raised surface (in Spark Dark: a sticker, 2px outline, 16px radius, hard shadow)"],
  ["PANEL_SUNKEN", "a sunken fill inside a panel"],
  ["EYEBROW", "the coral uppercase label over a title"],
  ["TITLE_DISPLAY", "the page title in the display face"],
  ["INTRO", "one context line under a title"],
  ["META_LABEL", "an uppercase meta label"],
  ["STAT", "a small accent card for one labelled number"],
  ["STAT_LABEL", "the label above a STAT value"],
  ["STAT_VALUE", "the number itself, serif"],
  ["CHIP", "a bordered inline fact (tilts a degree in Spark Dark)"],
  ["CHIP_QUIET", "a filled quiet tag"],
  ["BTN_PRIMARY", "the main action of a surface (pair with height 40px, padding 0 16px)"],
  ["BTN_AFFIRM", "the positive half of a decision, always beside its opposite"],
  ["BTN_SECONDARY", "a secondary action"],
  ["BTN_GHOST", "the quiet cancel"],
  ["FIELD", "a text input / textarea / select"],
  ["KBD", "a key cap"],
];

async function markSvgs(repo) {
  try {
    const { MARK_SHAPES } = await import(pathToFileURL(path.join(repo, SRC.marks)).href);
    const shape = (s) => {
      const paint = s.fill ? 'fill="currentColor"' : `fill="none" stroke="currentColor" stroke-width="${s.sw}"`;
      if (s.el === "circle") return `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""} ${paint}/>`;
      if (s.el === "rect") return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.rx}" ${paint}/>`;
      return `<path d="${s.d}" stroke-linecap="round"${s.join ? ' stroke-linejoin="round"' : ""} ${paint}/>`;
    };
    return Object.entries(MARK_SHAPES).map(([kind, shapes]) => `<!-- ${kind} --> <span class="k-mark k-mark--${kind === "bounce" ? "fail" : kind === "nobody" ? "unknown" : kind}"><svg viewBox="0 0 16 16" aria-hidden="true">${shapes.map(shape).join("")}</svg></span>`);
  } catch (err) {
    return [`<!-- mark shapes unavailable: ${String(err.message).split("\n")[0]} (see ${SRC.marks}) -->`];
  }
}

export async function componentsMd(repo = REPO, stamp = "") {
  const read = (rel) => readFileSync(path.join(repo, rel), "utf8");
  const sheets = { kit: read(SRC.kit), scene: read(SRC.scene) };
  const globals = parseBlocks(read(SRC.globals));
  const ride = findBlock(globals, '[data-theme="dark"] .shadow-panel').map((b) => norm(b.body)).join(" ");
  const recipes = recipeStrings(read(SRC.recipes));
  const unmapped = [];
  const out = [
    "# The app's components, as plain CSS",
    "",
    `Generated by \`scripts/contest/app-kit-pack.mjs\`${stamp ? ` on ${stamp}` : ""}. Link \`tokens.css\` first: every rule below paints`,
    "only through its variables, so a prototype built from these classes renders both registers",
    '(`<html data-theme="dark">` flips to Spark Dark) and ports into the app without a re-skin.',
    "Put `class=\"k-kit\"` on the element that holds your surface (the app scopes the kit's variables there;",
    "`tokens.css` also sets them on `:root`, so nothing breaks without it).",
    "",
    "Take these parts as they are, or imitate them closely: their names, measures and states are the",
    "app's. What you build AROUND them (the metaphor, the drawing, the composition, the story the motion",
    "tells) is yours; see GUIDE.md.",
    "",
    "## Kit parts",
    "",
  ];
  for (const p of PARTS) {
    out.push(`### ${p.name} (\`.${p.classes.join("`, `.")}\`)`, "", `${p.for}. In the app: \`${p.app}\`.`, "", "```css", pickRules(sheets[p.sheet], byClass(p.classes)), "```", "");
    if (p.name === "Mark") out.push("The shapes (16px, `currentColor`):", "", "```html", ...(await markSvgs(repo)), "```", "");
  }
  out.push("## Recipes (`app/_components/ui/recipes.ts`), translated", "", "The app writes these as Tailwind class strings; here each is one plain class, `.kp-<name>`.", "Buttons carry their height at the call site: add `height: 40px; padding: 0 16px` (32px small, 48px touch).", "");
  for (const [name, what] of RECIPES) {
    const classes = recipes.get(name);
    if (!classes) {
      unmapped.push(`${name}: not found`);
      continue;
    }
    const r = recipeCss(name, classes, ride);
    unmapped.push(...r.unmapped.map((u) => `${name}: ${u}`));
    out.push(`### \`${name}\`: ${what}`, "", "```css", r.css, "```", "");
  }
  return { md: out.join("\n"), unmapped };
}

/* ================================================================ the pack */

export async function buildPack({ repo = REPO, target, shots = null, stamp = new Date().toISOString().slice(0, 10) }) {
  const dir = path.join(target, "app-kit");
  mkdirSync(path.join(dir, "reference"), { recursive: true });
  const tokens = readTokens(repo);
  writeFileSync(path.join(dir, "tokens.css"), tokensCss(tokens, readFileSync(path.join(repo, SRC.globals), "utf8"), stamp));
  const comp = await componentsMd(repo, stamp);
  writeFileSync(path.join(dir, "components.md"), comp.md);
  copyFileSync(path.join(repo, SRC.guide), path.join(dir, "GUIDE.md"));
  const copied = [];
  if (shots) {
    for (const f of readdirSync(shots).filter((x) => /\.png$/i.test(x)).sort()) {
      copyFileSync(path.join(shots, f), path.join(dir, "reference", f));
      copied.push(f);
    }
  }
  return { dir, unmapped: comp.unmapped, references: copied };
}

async function main(argv) {
  const args = argv.slice(2);
  const target = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--shots");
  const si = args.indexOf("--shots");
  const shots = si >= 0 ? args[si + 1] : null;
  if (!target) {
    console.error("usage: node scripts/contest/app-kit-pack.mjs <targetDir> [--shots <dir with .png>]");
    return 2;
  }
  if (!existsSync(path.join(REPO, SRC.tailwind))) {
    console.error(`missing ${SRC.tailwind}: run \`npm ci\` first (the stock Tailwind shades come from it)`);
    return 1;
  }
  if (shots && !existsSync(shots)) {
    console.error(`--shots ${shots}: no such directory`);
    return 1;
  }
  const r = await buildPack({ target: path.resolve(target), shots: shots && path.resolve(shots) });
  console.log(`app-kit written to ${r.dir}`);
  console.log(`  reference/: ${r.references.length ? r.references.join(", ") : "none (pass --shots <dir>)"}`);
  if (r.unmapped.length) {
    console.error(`  recipes with utilities this translator does not know (extend utility()):\n    ${r.unmapped.join("\n    ")}`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv).then((code) => process.exit(code));
}
