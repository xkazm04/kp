#!/usr/bin/env node
/**
 * Design-law gate — `npm run design:check`.
 *
 * The dual-theme contract is stated at length in `.claude/CLAUDE.md` and
 * `docs/design/README.md`, and until this script existed NOTHING enforced any
 * of it: eslint carried one custom rule (about i18n), and neither CI nor the
 * pre-push hook ever read `app/globals.css`. The absence had already cost
 * something real — `brand.ts` declared `PAPER = "#f7f5ef"` while `globals.css`
 * declared `--color-paper: #fdf8ee`, so every stylesheet-less light surface
 * (the OG card, apple-icon, raw SVG fills) painted a cream the app had stopped
 * using. Nothing could have caught it.
 *
 * Two checks, both reading `globals.css` as the source of truth:
 *
 *   1. LOCKSTEP — every literal in `app/_lib/brand.ts` (the documented JS
 *      mirror for surfaces the CSS token system cannot reach) must equal its
 *      `--color-*` declaration, in the light `@theme` block AND in the
 *      `[data-theme="dark"]` block.
 *
 *   2. SHADE PARITY — every `-(red|amber|green|blue|…)-N` utility used outside
 *      `app/landing/` must have a `[data-theme="dark"]` declaration, so a shade
 *      cannot be introduced in light and left rendering stock in dark.
 *
 * The third gate (no raw hex / inline rgba outside `app/landing/`) is an
 * eslint rule in `eslint.config.mjs`, so it rides `npm run lint`.
 *
 * Exit 0 = clean, 1 = violations (printed with file:line).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve, sep } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CSS = join(ROOT, "app", "globals.css");
const BRAND = join(ROOT, "app", "_lib", "brand.ts");

const errors = [];
const rel = (p) => relative(ROOT, p).split(sep).join("/");

// ---------------------------------------------------------------------------
// Parse globals.css into { light, dark } token maps.
// ---------------------------------------------------------------------------

const css = readFileSync(CSS, "utf8");

/** Slice out a top-level `<selector> { … }` block by brace balance. */
function block(source, opener) {
  const start = source.indexOf(opener);
  if (start === -1) throw new Error(`check-design-tokens: no \`${opener}\` block in app/globals.css`);
  let depth = 0;
  for (let i = start + opener.length - 1; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i);
  }
  throw new Error(`check-design-tokens: unbalanced braces after \`${opener}\``);
}

/** `--color-paper: #fdf8ee;` -> Map { "paper" => "#fdf8ee" }, lowercased. */
function colorTokens(src) {
  const out = new Map();
  for (const m of src.matchAll(/--color-([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1], m[2].trim().toLowerCase());
  }
  return out;
}

const LIGHT = colorTokens(block(css, "@theme {"));
const DARK = colorTokens(block(css, '[data-theme="dark"] {'));

// ---------------------------------------------------------------------------
// Check 1 — brand.ts <-> globals.css lockstep.
// ---------------------------------------------------------------------------

const brand = readFileSync(BRAND, "utf8");

/**
 * The `LIGHT`/`DARK` objects in brand.ts key their entries by ROLE
 * (what the color is for) rather than by token name, because that is what the
 * consuming chart code reads. Everything else derives: `DIAL_STONE` ->
 * `--color-dial-stone`. A brand constant whose token cannot be resolved is an
 * ERROR, not a skip — that is precisely how an unchecked literal would sneak
 * back in.
 */
const ROLE_ALIAS = { SURFACE: "white", FILL: "stone-100", GRID: "stone-200" };
const tokenFor = (name) => ROLE_ALIAS[name] ?? name.toLowerCase().replace(/_/g, "-");

/** Top-level `export const NAME = "#hex";` -> the light @theme block. */
const topLevel = [...brand.matchAll(/^export const ([A-Z][A-Z0-9_]*)\s*=\s*"(#[0-9a-fA-F]{3,8})"/gm)];

/** `export const LIGHT|DARK = { KEY: "#hex", … }` -> the matching block. */
function objectEntries(objName) {
  const m = brand.match(new RegExp(`export const ${objName} = \\{([\\s\\S]*?)\\n\\} as const`));
  if (!m) return null;
  return [...m[1].matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:\s*(?:"(#[0-9a-fA-F]{3,8})"|([A-Z][A-Z0-9_]*))/gm)];
}

const consts = new Map(topLevel.map((m) => [m[1], m[2].toLowerCase()]));

// A gate that quietly matches nothing is worse than no gate: if brand.ts is
// reformatted past these regexes, fail loudly instead of reporting "OK".
if (consts.size < 8 || LIGHT.size < 8 || DARK.size < 8) {
  console.error(
    `[design:check] SELF-CHECK FAILED — parsed ${consts.size} brand constants, ${LIGHT.size} light and ` +
      `${DARK.size} dark tokens. The gate has stopped seeing its inputs (a reformat of app/_lib/brand.ts ` +
      `or app/globals.css?). Fix the parser in this script — do not ignore this.`
  );
  process.exit(1);
}

function lockstep(label, entries, tokens, blockName) {
  for (const [, name, hex, refName] of entries) {
    const value = (hex ?? consts.get(refName))?.toLowerCase();
    if (!value) {
      errors.push(`lockstep: brand.ts ${label}.${name} references unknown constant \`${refName}\``);
      continue;
    }
    const token = tokenFor(name);
    const declared = tokens.get(token);
    if (declared === undefined) {
      errors.push(
        `lockstep: brand.ts ${label}.${name} has no counterpart — app/globals.css declares no ` +
          `--color-${token} in ${blockName}. Declare the token, or the mirror is unverifiable.`
      );
    } else if (declared !== value) {
      errors.push(
        `lockstep: brand.ts ${label}.${name} = ${value} but app/globals.css --color-${token} = ` +
          `${declared} (${blockName}). The mirror has drifted; stylesheet-less surfaces (OG card, ` +
          `icons, raw SVG fills) are painting the wrong color.`
      );
    }
  }
}

lockstep("", topLevel.map((m) => [m[0], m[1], m[2]]), LIGHT, "@theme");
for (const [objName, tokens, blockName] of [
  ["LIGHT", LIGHT, "@theme"],
  ["DARK", DARK, '[data-theme="dark"]'],
]) {
  const entries = objectEntries(objName);
  if (!entries) {
    errors.push(`lockstep: app/_lib/brand.ts no longer exports a \`${objName}\` object — the gate cannot check it.`);
    continue;
  }
  lockstep(objName, entries, tokens, blockName);
}

// ---------------------------------------------------------------------------
// Check 2 — every status/neutral shade used in light has a dark value.
// ---------------------------------------------------------------------------

/**
 * Deliberate exemptions. Every entry needs a REASON — the rule is never
 * lowered to make the tree pass; a shade is either fixed or listed here.
 */
const SHADE_ALLOW = new Map([
  [
    "stone-500",
    "Muted body text. globals.css states 'text greys (stone-400+) stay stock' — " +
      "stock stone-500 (#78716c) still reads on the dark canvas, and warming it " +
      "would drag the whole text ramp off the stated design decision.",
  ],
  ["stone-600", "Same as stone-500 — muted text, deliberately stock in both themes."],
]);

// `border`/`divide` also take a SIDE before the color (`border-t-red-500`,
// `divide-y-stone-200`, logical `border-s-`/`border-e-`). Without the optional
// side the regex could not match a whole family of real call sites, so a shade
// introduced that way rendered stock in Spark Dark with the gate reporting OK.
const UTIL =
  "(?:bg|text|border(?:-[trblxyse])?|ring|ring-offset|from|to|via|fill|stroke|divide(?:-[xy])?|accent|decoration|" +
  "outline|placeholder|caret|shadow)";
const FAMILY =
  "(?:red|amber|green|blue|emerald|teal|lime|orange|yellow|rose|pink|fuchsia|purple|violet|indigo|sky|cyan|" +
  "stone|slate|gray|zinc|neutral)";
const SHADE_RE = new RegExp(`\\b${UTIL}-(${FAMILY})-(\\d{2,3})\\b`, "g");

function sources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      sources(p, out);
    } else if (/\.(tsx|ts|jsx|js|mdx)$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

// `app/landing/` is the one exempt directory: a fixed art direction that never
// re-skins (see docs/design/README.md).
const scanned = sources(join(ROOT, "app")).filter(
  (f) => !rel(f).startsWith("app/landing/") && !/\.test\.(ts|tsx)$/.test(rel(f))
);

const missing = new Map(); // token -> Set<"file:line">
for (const file of scanned) {
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    for (const m of line.matchAll(SHADE_RE)) {
      const token = `${m[1]}-${m[2]}`;
      if (DARK.has(token) || SHADE_ALLOW.has(token)) continue;
      if (!missing.has(token)) missing.set(token, new Set());
      missing.get(token).add(`${rel(file)}:${i + 1}`);
    }
  });
}

for (const [token, sites] of [...missing].sort()) {
  errors.push(
    `shade parity: \`${token}\` is used in ${sites.size} place(s) but app/globals.css declares no ` +
      `--color-${token} under [data-theme="dark"], so it renders stock in Spark Dark.\n` +
      `    Fix: add the dark value to globals.css, or switch the call site to a mapped token.\n` +
      [...sites].sort().map((s) => `      ${s}`).join("\n")
  );
}

// ---------------------------------------------------------------------------

if (errors.length) {
  console.error(`\n[design:check] ${errors.length} violation(s) of the dual-theme design law:\n`);
  for (const e of errors) console.error(`  - ${e}\n`);
  console.error("See docs/design/README.md. Do not relax this gate to make a change pass.\n");
  process.exit(1);
}

console.log(
  `[design:check] OK — ${consts.size + (objectEntries("LIGHT")?.length ?? 0) + (objectEntries("DARK")?.length ?? 0)} ` +
    `brand.ts literals in lockstep with app/globals.css; ` +
    `${DARK.size} dark token(s) cover every shade used across ${scanned.length} source files ` +
    `(${SHADE_ALLOW.size} documented exemption(s)).`
);
