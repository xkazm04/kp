#!/usr/bin/env node
// style-divergence.mjs - rank kp modules by VISIBLE style drift.
//
// Formalizes the kit-unification scout's hand-computed index (docs/design/
// instruments.md). Reads every non-test .tsx under app/ except the marketing
// surfaces (app/landing, app/about, app/market) and counts, per file:
//
//   handButtons   <button> tags carrying no recipe (recipes.ts export) and no kit class
//   offScale      text-(xs|lg|xl|2xl|3xl) and arbitrary text-[Npx|rem|em] sizes
//   rawScale      text-sm / text-base (on the 14px floor, but not the named scale)
//   approved      text-(meta|body|micro|h1|h2|h3|display) - the named scale
//   rawStone      text-stone-N
//   statusHue     raw palette hues (red/amber/green/blue/...) on text-, bg- and border-
//   recipeDebt    the file's declared ceilings in app/_components/ui/recipe-debt.json
//   recipeImports named imports from app/_components/ui/recipes
//
// index (per file, and per module over its files) =
//   (sum of WEIGHTS x drift counts) per 100 LOC  -  CREDIT x recipe imports per 100 LOC, floored at 0
//
// It is a static count, not a render: it cannot see a class assembled at runtime,
// a recipe that is itself off-scale, or what a surface looks like. Pair it with
// shoot.mjs. Re-derive at every gate; never quote an old number.
//
//   node scripts/style/style-divergence.mjs                 # module table, most divergent first
//   node scripts/style/style-divergence.mjs --json          # every module and file
//   node scripts/style/style-divergence.mjs --module features/settings/hiring   # that module's files
//   node scripts/style/style-divergence.mjs --top 20
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(REPO, 'app');
const EXCLUDE = /^(landing|about|market)(\/|$)|(^|\/)(__tests__|node_modules)\//;
const TEST = /\.(test|spec|stories)\.tsx$/;

// Calibrated 2026-09-25 against the scout's hand index over 13 modules (mean
// absolute error 0.80; same top and bottom tiers). rawScale carries no weight:
// text-sm is ON the 14px floor, so it is reported, not punished.
export const WEIGHTS = { handButtons: 1, offScale: 2, rawScale: 0, rawStone: 1, statusHue: 1, recipeDebt: 1 };
export const CREDIT = 0.25;

const RE = {
  offScale: /\btext-(?:xs|lg|xl|2xl|3xl)\b|\btext-\[[\d.]+(?:px|rem|em)\]/g,
  rawScale: /\btext-(?:sm|base)\b/g,
  approved: /\btext-(?:meta|body|micro|h1|h2|h3|display)\b/g,
  rawStone: /\btext-stone-\d+\b/g,
  statusHue: /\b(?:text|bg|border)-(?:red|amber|green|blue|emerald|rose|yellow|orange|sky|lime|teal|violet|purple|indigo|pink|cyan)-\d+\b/g,
};

let recipeNames = null;
function recipeExports() {
  if (recipeNames) return recipeNames;
  const src = fs.readFileSync(path.join(APP, '_components', 'ui', 'recipes.ts'), 'utf8');
  recipeNames = [...src.matchAll(/^export\s+(?:const|function)\s+(\w+)/gm)].map((m) => m[1]);
  return recipeNames;
}

function recipeDebt() {
  try {
    const { ceilings } = JSON.parse(fs.readFileSync(path.join(APP, '_components', 'ui', 'recipe-debt.json'), 'utf8'));
    return Object.fromEntries(Object.entries(ceilings).map(([f, c]) => [f, Object.values(c).reduce((s, n) => s + n, 0)]));
  } catch {
    return {};
  }
}

/** The opening tag of each <button ...>, read to the first `>` outside braces. */
export function buttonTags(src) {
  const tags = [];
  for (const m of src.matchAll(/<button\b/g)) {
    let depth = 0, i = m.index + 7;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    tags.push(src.slice(m.index, i + 1));
  }
  return tags;
}

/** Every drift count for one source file. `rel` is relative to app/. */
export function measureSource(src, rel, debt = {}) {
  const names = recipeExports();
  const recipeRe = new RegExp(`\\b(?:${names.join('|')})\\b|data-kit|\\bkit-[a-z]`);
  const importRe = /import\s*\{([^}]*)\}\s*from\s*['"][^'"]*_components\/ui\/recipes['"]/g;
  const count = (re) => (src.match(re) || []).length;
  const tags = buttonTags(src);
  return {
    loc: src.split('\n').length,
    buttons: tags.length,
    handButtons: tags.filter((t) => !recipeRe.test(t)).length,
    offScale: count(RE.offScale),
    rawScale: count(RE.rawScale),
    approved: count(RE.approved),
    rawStone: count(RE.rawStone),
    statusHue: count(RE.statusHue),
    recipeDebt: debt[rel] ?? 0,
    recipeImports: [...src.matchAll(importRe)].reduce((s, m) => s + m[1].split(',').filter((x) => x.trim() && !/^type\s/.test(x.trim())).length, 0),
  };
}

export function indexOf(m) {
  const drift = Object.entries(WEIGHTS).reduce((s, [k, w]) => s + w * (m[k] || 0), 0);
  const loc = Math.max(m.loc, 1);
  return Math.max(0, (drift - CREDIT * (m.recipeImports || 0)) * 100 / loc);
}

/** features/<area>/<module>, _components/<x>, or /<route> (the first route segment). */
export function moduleOf(rel) {
  const s = rel.split('/');
  if (s[0] === 'features') return s.length > 3 ? `features/${s[1]}/${s[2]}` : `features/${s[1]}`;
  if (s[0] === '_components') return s.length > 2 ? `_components/${s[1]}` : '_components/(root)';
  return s.length > 1 ? `/${s[0]}` : '/(root)';
}

export function walk(dir = APP, base = APP, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const rel = path.relative(base, abs).split(path.sep).join('/');
    if (EXCLUDE.test(rel + (e.isDirectory() ? '/' : ''))) continue;
    if (e.isDirectory()) walk(abs, base, out);
    else if (e.name.endsWith('.tsx') && !TEST.test(e.name)) out.push(rel);
  }
  return out;
}

export function measureTree() {
  const debt = recipeDebt();
  const files = walk().sort().map((rel) => {
    const m = measureSource(fs.readFileSync(path.join(APP, rel), 'utf8'), rel, debt);
    const sized = m.approved + m.offScale + m.rawScale;
    return { file: `app/${rel}`, module: moduleOf(rel), ...m, index: +indexOf(m).toFixed(2), approvedShare: sized ? +(m.approved / sized).toFixed(2) : null };
  });
  const mods = {};
  for (const f of files) {
    const m = (mods[f.module] ??= { module: f.module, files: 0 });
    m.files++;
    for (const k of ['loc', 'buttons', 'handButtons', 'offScale', 'rawScale', 'approved', 'rawStone', 'statusHue', 'recipeDebt', 'recipeImports']) m[k] = (m[k] || 0) + f[k];
  }
  const modules = Object.values(mods).map((m) => {
    const sized = m.approved + m.offScale + m.rawScale;
    return { ...m, index: +indexOf(m).toFixed(2), approvedShare: sized ? +(m.approved / sized).toFixed(2) : null };
  }).sort((a, b) => b.index - a.index || a.module.localeCompare(b.module));
  return { files, modules };
}

const COLS = ['module', 'index', 'files', 'loc', 'handButtons', 'buttons', 'offScale', 'rawScale', 'approved', 'approvedShare', 'rawStone', 'statusHue', 'recipeDebt', 'recipeImports'];
function table(rows) {
  const w = COLS.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '-').length)));
  const line = (r) => COLS.map((c, i) => (i === 0 ? String(r[c] ?? '-').padEnd(w[i]) : String(r[c] ?? '-').padStart(w[i]))).join('  ');
  return [line(Object.fromEntries(COLS.map((c) => [c, c]))), ...rows.map(line)].join('\n');
}

export function main(argv) {
  const at = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const { files, modules } = measureTree();
  const only = at('--module');
  if (only) {
    const key = only.replace(/^app\//, '');
    const rows = files.filter((f) => f.module === key || f.module === `/${key.replace(/^\//, '')}`).sort((a, b) => b.index - a.index);
    if (!rows.length) { console.error(`style-divergence: no module "${only}" (try one from the table)`); return 1; }
    if (argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
    else console.log(table(rows.map((r) => ({ ...r, module: r.file.replace(/^app\//, ''), files: 1 }))));
    return 0;
  }
  if (argv.includes('--json')) { console.log(JSON.stringify({ weights: WEIGHTS, credit: CREDIT, modules, files }, null, 2)); return 0; }
  const top = Number(at('--top')) || modules.length;
  console.log(`style-divergence: ${files.length} files, ${modules.length} modules. index = weighted drift per 100 LOC - ${CREDIT} x recipe imports per 100 LOC`);
  console.log(`weights: ${Object.entries(WEIGHTS).map(([k, v]) => `${k}=${v}`).join(' ')}\n`);
  console.log(table(modules.slice(0, top)));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
