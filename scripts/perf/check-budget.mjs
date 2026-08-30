#!/usr/bin/env node
// The build has a size, and until now nothing was allowed to say no to it.
//
// THE GAP THIS CLOSES: this repository measures cost carefully and gates none of
// it. docs/architecture/app-structure.md carries a measured cost model — "`next
// dev` compiles a route's ENTIRE module graph on first hit, with no
// tree-shaking... the cost tracks graph size almost linearly" — and a rule
// derived from it: import the SLICE (`@/app/_lib/db/pipeline`), never the barrel
// (`@/app/_lib/db`), because one barrel import in a hub module taxes every route
// downstream. That work took `/api/health` from 55 modules / 718 KB to 14 / 180
// KB and `/api/attention` from 68 / 863 KB to 43 / 560 KB.
//
// All of it is prose. Nothing re-reads the graph, so the next agent that types
// `import { … } from "@/app/_lib/db"` in a hub re-inflates a hundred routes and
// every gate in ci.yml stays green: typecheck passes, lint passes, the tests
// pass, the app is simply slower. That is the drift this file exists to stop.
//
// WHY A STATIC GRAPH AND NOT A STOPWATCH. A wall-clock budget on a shared CI
// runner flaps, and a gate that flaps gets deleted. The module graph is a pure
// function of the committed source: same tree, same number, on any machine, with
// no build, no server, no network and no node_modules. The repo's own
// measurement is what licenses it as a performance proxy — cost tracks graph
// size almost linearly, so a graph that doubles is a route that got slower.
//
// WHAT IS BUDGETED (perf-budget.json at the repo root, next to the code it
// governs so an agent editing a route meets it in the same directory listing):
//
//   entries   named files with their own ceiling — `app/page.tsx` (the whole
//             ?tab= workspace behind one URL) and the hub modules whose graph is
//             multiplied across every importer.
//   groups    a glob with ONE ceiling for every file matching it, which is what
//             covers a route that does not exist yet: a new `app/api/**/route.ts`
//             arriving over the group ceiling fails without anyone having added
//             it here first.
//   barrels   the rule above, as a number: how many VALUE importers a barrel is
//             allowed. `import type` is erased before bundling and is not
//             counted, which is exactly the distinction app-structure.md draws.
//
// HOW A CEILING MOVES. Down by itself: `--tighten` lowers every recorded ceiling
// to what the tree now carries plus the declared slack, so the budget follows
// real improvements without anyone typing a number (the shape ruff-ratchet.mjs
// already uses here). Up only in a diff: raising a ceiling is an edit to a
// committed file with a `why`, which is the point — a route may legitimately
// grow, and that should be a decision somebody made rather than a number that
// drifted.
//
//   node scripts/perf/check-budget.mjs --record    # calibrate: measure the tree
//                                                  # and write perf-budget.json
//   node scripts/perf/check-budget.mjs             # the check
//   node scripts/perf/check-budget.mjs --json      # every measurement
//   node scripts/perf/check-budget.mjs --tighten   # record ground a shrink gained
//   node scripts/perf/check-budget.mjs --explain app/api/schedule/route.ts
//                                                  # the heaviest modules on a path
//
// STATUS — READ THIS BEFORE TRUSTING IT. This tool ships UNCALIBRATED and
// UNGATED: there is no perf-budget.json yet, and no CI step runs it. It was
// written in a sandbox with no execution, so it has never been run against this
// tree, and inventing ceilings without measuring them would have produced a
// budget that fails honest work or passes everything. Two commands finish it:
//
//   1. node scripts/perf/check-budget.mjs --record   (then read every number,
//      and delete a target that is not worth a gate)
//   2. add `- run: npm run perf:budget` to the node-quality job in ci.yml,
//      beside `npm run design:check` — same tier: a static, sub-second,
//      key-free read of the committed tree.
//
// Until step 2 exists nothing fails when the app gets slower, which is the whole
// gap. docs/development/performance-budget.md carries the full procedure.
//
// EXIT CODES: 0 within budget / 1 a ceiling was exceeded, or the budget file
// could not be believed (a budget this script cannot parse must never read as
// "nothing to check" — that is how a gate goes quiet).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BUDGET_FILE = 'perf-budget.json';

/** Extensions a first-party specifier may resolve to, in resolution order. */
const EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js', '.jsx', '.json'];

/** Directories never walked when expanding a group glob. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.next-empty', 'dist', 'coverage']);

// ---------------------------------------------------------------------------
// Reading imports
//
// A regex reader, deliberately: adding a TypeScript parser to a gate that has to
// run before `npm ci` would buy precision this metric does not need. The failure
// mode is bounded in both directions — a specifier this misses is a module not
// counted, and a specifier it invents fails to resolve on disk and is dropped.
// Both are stable across runs, which is the property a ratchet actually needs.
// ---------------------------------------------------------------------------

/**
 * `import ... from 'x'` and the two re-export forms (`export * from 'x'`,
 * `export { ... } from 'x'`), including multi-line clauses.
 *
 * The character class after `import` keeps the match anchored to a real
 * statement: it admits `import x`, `import {`, `import *`, `import 'x'` and
 * rejects `import(` (handled as dynamic below). The `export` branch admits only
 * `*` and `{`, so a line like `export function foo()` can never open a match
 * that then runs on until it finds some later `from`.
 *
 * `import type ... from` / `export type ... from` are excluded: TypeScript
 * erases them before bundling, so they cost nothing at runtime. `import { type
 * Foo, bar }` DOES count — the statement still emits an import for `bar`. That
 * is the same line docs/architecture/app-structure.md draws when it says
 * type-only barrel imports need no change.
 */
const VALUE_FROM_RE =
  /^[ \t]*(?:import(?![ \t]+type[ \t])[ \t]+[{*'"A-Za-z_$]|export[ \t]+(?!type[ \t])(?:\*|\{))[\s\S]*?from[ \t]*['"]([^'"]+)['"]/gm;
/** `import 'x'` — a side-effect import has no clause and no `from`. */
const SIDE_EFFECT_RE = /^[ \t]*import[ \t]*['"]([^'"]+)['"]/gm;
/** `import('x')` — including the `next/dynamic` tab loaders. */
const DYNAMIC_RE = /\bimport[ \t]*\([ \t]*['"]([^'"]+)['"][ \t]*\)/g;
/** `import type ... from 'x'` / `export type ... from 'x'` — free, never counted. */
const TYPE_ONLY_RE = /^[ \t]*(?:import|export)[ \t]+type[ \t][\s\S]*?from[ \t]*['"]([^'"]+)['"]/gm;

/** Every module specifier this source depends on at RUNTIME. */
export function parseImports(source) {
  const specs = [];
  for (const m of source.matchAll(VALUE_FROM_RE)) specs.push(m[1]);
  for (const m of source.matchAll(SIDE_EFFECT_RE)) specs.push(m[1]);
  for (const m of source.matchAll(DYNAMIC_RE)) specs.push(m[1]);
  return specs;
}

/** The type-only specifiers — the ones that are free, and so are never counted. */
export function parseTypeOnlyImports(source) {
  return [...source.matchAll(TYPE_ONLY_RE)].map((m) => m[1]);
}

/**
 * Resolve a specifier to a file inside the repo, or `null` for anything
 * external. Third-party packages are not counted: this metric is the
 * FIRST-PARTY graph, the one the tree can actually change.
 */
export function resolveSpecifier(spec, fromFile, root = REPO_ROOT) {
  let base;
  if (spec.startsWith('@/')) base = path.join(root, spec.slice(2));
  else if (spec.startsWith('./') || spec.startsWith('../')) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // a bare package, `node:*`, a URL — not ours
  const candidates = [];
  if (path.extname(base)) candidates.push(base);
  for (const e of EXTENSIONS) candidates.push(base + e);
  // `allowImportingTsExtensions` is on, so './x.js' may mean './x.ts' on disk.
  const stripped = base.replace(/\.(js|jsx|mjs)$/, '');
  if (stripped !== base) for (const e of EXTENSIONS) candidates.push(stripped + e);
  for (const e of EXTENSIONS) candidates.push(path.join(base, 'index' + e));
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      /* next candidate */
    }
  }
  return null;
}

/**
 * Per-file cache of (bytes, resolved dependencies). One `perf:budget` run walks
 * a couple of hundred entries over a tree where the same hub module appears in
 * most of them; without this the gate re-reads `app/_lib/` a hundred times.
 * Keyed by absolute path, and never invalidated — a run reads one tree state.
 */
const fileCache = new Map();

function readModule(file, root) {
  const cached = fileCache.get(file);
  if (cached) return cached;
  let source;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch {
    return null; // unreadable = not part of the graph
  }
  const deps = file.endsWith('.json')
    ? [] // data, not code: no imports to follow
    : [...new Set(parseImports(source))].map((s) => resolveSpecifier(s, file, root)).filter(Boolean);
  const entry = { bytes: Buffer.byteLength(source), deps };
  fileCache.set(file, entry);
  return entry;
}

/**
 * The transitive first-party graph reachable from one entry, following static
 * AND dynamic imports — the same union app-structure.md counts when it says
 * `app/page.tsx` reaches 983 modules, 749 of them only via `next/dynamic`.
 *
 * The entry itself is counted: a route IS one of the modules that has to be
 * compiled and shipped.
 */
export function walkGraph(entryAbs, root = REPO_ROOT) {
  const seen = new Set();
  const queue = [entryAbs];
  let bytes = 0;
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    const mod = readModule(file, root);
    if (!mod) continue;
    seen.add(file);
    bytes += mod.bytes;
    for (const dep of mod.deps) if (!seen.has(dep)) queue.push(dep);
  }
  return { modules: seen.size, bytes, files: seen };
}

// ---------------------------------------------------------------------------
// Globs — `app/api/**/route.ts` and nothing more exotic
// ---------------------------------------------------------------------------

/**
 * `**` crosses directories, `*` does not, `{a,b}` alternates. Anchored at both
 * ends. `a/**` + `/b.ts` also matches `a/b.ts` (zero directories in between),
 * which is what makes one pattern cover a flat and a nested route alike.
 */
export function globToRegExp(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*' && pattern[i + 2] === '/') {
      out += '(?:[^/]+/)*';
      i += 2;
    } else if (c === '*' && pattern[i + 1] === '*') {
      out += '.*';
      i += 1;
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else if (c === '{') out += '(?:';
    else if (c === '}') out += ')';
    else if (c === ',') out += '|';
    else if ('.+^$()|[]\\'.includes(c)) out += '\\' + c;
    else out += c;
  }
  return new RegExp('^' + out + '$');
}

const toRel = (abs, root) => path.relative(root, abs).split(path.sep).join('/');

/** Every repo-relative file (POSIX separators) matching a glob, sorted. */
export function expandGlob(pattern, root = REPO_ROOT) {
  const re = globToRegExp(pattern);
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (re.test(toRel(abs, root))) out.push(toRel(abs, root));
    }
  };
  walk(root);
  return out.sort();
}

// ---------------------------------------------------------------------------
// The barrel rule
// ---------------------------------------------------------------------------

/** The tree searched for barrel importers: the app and the shared packages. */
export const IMPORTER_GLOB = '{app,packages}/**/*.{ts,tsx}';

/**
 * Files that import a barrel FOR VALUE. `import type` is erased before
 * bundling, costs nothing, and is not counted — the distinction the rule in
 * app-structure.md is written around.
 */
export function findValueImporters(barrelRel, root = REPO_ROOT, files = null) {
  const barrelAbs = path.join(root, barrelRel);
  const candidates = files ?? expandGlob(IMPORTER_GLOB, root);
  const hits = [];
  for (const rel of candidates) {
    const abs = path.join(root, rel);
    if (abs === barrelAbs) continue;
    const mod = readModule(abs, root);
    if (mod && mod.deps.includes(barrelAbs)) hits.push(rel);
  }
  return hits;
}

// ---------------------------------------------------------------------------
// The budget file
// ---------------------------------------------------------------------------

/**
 * Read and validate the budget. Throws rather than returning a default: a
 * budget file that cannot be parsed has to fail the build, never widen it.
 */
export function loadBudget(root = REPO_ROOT) {
  const budget = JSON.parse(fs.readFileSync(path.join(root, BUDGET_FILE), 'utf8'));
  if (budget.version !== 1) throw new Error(`${BUDGET_FILE}: unsupported version ${budget.version}`);
  if (typeof budget.slackPercent !== 'number') throw new Error(`${BUDGET_FILE}: slackPercent must be a number`);
  for (const key of ['entries', 'groups', 'barrels']) {
    if (!budget[key] || typeof budget[key] !== 'object') throw new Error(`${BUDGET_FILE}: '${key}' must be an object`);
  }
  for (const [name, limit] of [...Object.entries(budget.entries), ...Object.entries(budget.groups)]) {
    for (const field of ['maxModules', 'maxKb']) {
      if (!Number.isFinite(limit?.[field])) throw new Error(`${BUDGET_FILE}: '${name}' has no numeric ${field}`);
    }
    // A ceiling with no reason is how a budget becomes a number nobody dares
    // move. Same discipline as the `# ratchet:` marker in ruff.toml.
    if (!limit.why) throw new Error(`${BUDGET_FILE}: '${name}' has no 'why'`);
  }
  for (const [name, rule] of Object.entries(budget.barrels)) {
    if (!Number.isFinite(rule?.maxValueImporters)) {
      throw new Error(`${BUDGET_FILE}: barrel '${name}' has no numeric maxValueImporters`);
    }
    if (!rule.why) throw new Error(`${BUDGET_FILE}: barrel '${name}' has no 'why'`);
  }
  return budget;
}

const kb = (bytes) => Math.round(bytes / 1024);
const withSlack = (n, slackPercent) => Math.ceil(n * (1 + slackPercent / 100));

/**
 * Measure the tree against the budget.
 *
 * `findings` empty is the pass. Every finding carries the measurement AND the
 * ceiling, because "over budget" without both numbers is a message that gets
 * worked around instead of fixed.
 */
export function evaluate(budget, root = REPO_ROOT) {
  const findings = [];
  const measurements = [];

  for (const [rel, limit] of Object.entries(budget.entries)) {
    if (!fs.existsSync(path.join(root, rel))) {
      // A budget entry pointing at a file that moved is drift, not a pass: the
      // route it was protecting is now unmeasured.
      findings.push({
        kind: 'missing',
        target: rel,
        message: `budgeted entry does not exist — it moved or was deleted; update ${BUDGET_FILE}`,
      });
      continue;
    }
    const { modules, bytes } = walkGraph(path.join(root, rel), root);
    measurements.push({
      kind: 'entry',
      target: rel,
      modules,
      kb: kb(bytes),
      maxModules: limit.maxModules,
      maxKb: limit.maxKb,
    });
    if (modules > limit.maxModules) {
      findings.push({ kind: 'entry', target: rel, message: `${modules} first-party modules, ceiling ${limit.maxModules}` });
    }
    if (kb(bytes) > limit.maxKb) {
      findings.push({ kind: 'entry', target: rel, message: `${kb(bytes)} KB of first-party source, ceiling ${limit.maxKb} KB` });
    }
  }

  for (const [pattern, limit] of Object.entries(budget.groups)) {
    const files = expandGlob(pattern, root);
    if (files.length === 0) {
      findings.push({ kind: 'missing', target: pattern, message: `group glob matched no files — the tree moved under ${BUDGET_FILE}` });
      continue;
    }
    for (const rel of files) {
      const { modules, bytes } = walkGraph(path.join(root, rel), root);
      const override = limit.overrides?.[rel];
      const maxModules = override?.maxModules ?? limit.maxModules;
      const maxKb = override?.maxKb ?? limit.maxKb;
      measurements.push({ kind: 'group', group: pattern, target: rel, modules, kb: kb(bytes), maxModules, maxKb });
      if (modules > maxModules) {
        findings.push({
          kind: 'group',
          target: rel,
          message: `${modules} first-party modules, ceiling ${maxModules} for '${pattern}'${override ? ' (override)' : ''}`,
        });
      }
      if (kb(bytes) > maxKb) {
        findings.push({
          kind: 'group',
          target: rel,
          message: `${kb(bytes)} KB of first-party source, ceiling ${maxKb} KB for '${pattern}'${override ? ' (override)' : ''}`,
        });
      }
    }
  }

  const importerFiles = Object.keys(budget.barrels).length ? expandGlob(IMPORTER_GLOB, root) : [];
  for (const [rel, rule] of Object.entries(budget.barrels)) {
    const importers = findValueImporters(rel, root, importerFiles);
    measurements.push({ kind: 'barrel', target: rel, importers: importers.length, maxValueImporters: rule.maxValueImporters });
    if (importers.length > rule.maxValueImporters) {
      findings.push({
        kind: 'barrel',
        target: rel,
        message:
          `${importers.length} value importers, ceiling ${rule.maxValueImporters}. ` +
          'Import the slice, not the barrel — one barrel import in a hub module taxes every route downstream. ' +
          `Importers: ${importers.slice(0, 8).join(', ')}${importers.length > 8 ? ', ...' : ''}`,
      });
    }
  }

  return { findings, measurements };
}

/**
 * Lower every ceiling the tree has shrunk away from, and never raise one.
 *
 * `--tighten` is the half of a ratchet that can run unattended, so it must be
 * incapable of widening a budget: a measurement ABOVE the ceiling is a finding
 * for the gate to report, not a new ceiling to record.
 */
export function tighten(budget, measurements) {
  const next = structuredClone(budget);
  let changed = 0;
  const lower = (limit, row) => {
    const wantModules = withSlack(row.modules, budget.slackPercent);
    const wantKb = withSlack(row.kb, budget.slackPercent);
    if (wantModules < limit.maxModules) {
      limit.maxModules = wantModules;
      changed++;
    }
    if (wantKb < limit.maxKb) {
      limit.maxKb = wantKb;
      changed++;
    }
  };
  for (const row of measurements) {
    if (row.kind === 'entry' && next.entries[row.target]) lower(next.entries[row.target], row);
    if (row.kind === 'group') {
      // Only an OVERRIDE is tightened. The group ceiling itself exists to catch
      // a route nobody has looked at yet; pinning it to today's heaviest file
      // would make every ordinary new route a red build.
      const override = next.groups[row.group]?.overrides?.[row.target];
      if (override) lower(override, row);
    }
    if (row.kind === 'barrel') {
      const rule = next.barrels[row.target];
      if (rule && row.importers < rule.maxValueImporters) {
        rule.maxValueImporters = row.importers;
        changed++;
      }
    }
  }
  return { budget: next, changed };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function explain(rel, root = REPO_ROOT) {
  const { modules, bytes, files } = walkGraph(path.join(root, rel), root);
  const rows = [...files]
    .map((f) => ({ rel: toRel(f, root), kb: kb(fs.statSync(f).size) }))
    .sort((a, b) => b.kb - a.kb)
    .slice(0, 20);
  console.log(`${rel}: ${modules} first-party modules / ${kb(bytes)} KB\n`);
  console.log('heaviest modules on this path:');
  for (const r of rows) console.log(`  ${String(r.kb).padStart(4)} KB  ${r.rel}`);
}

/**
 * What a first calibration measures, and why each target is worth a ceiling.
 * Used only by `--record`; once perf-budget.json exists it is the source of
 * truth and this list is not consulted again.
 */
export const DEFAULT_TARGETS = {
  entries: {
    'app/page.tsx':
      'the whole ?tab= workspace behind one URL — 983 first-party modules when app-structure.md measured it, and the single page every operator waits on',
    'app/_lib/llm-config.ts':
      'a hub module: its graph is multiplied across every importer, which is how a barrel import in ONE file inflated a hundred routes (57 modules -> 13 after the sweep)',
    'app/_lib/job-ingest.ts': 'the other hub the barrel sweep shrank (60 modules -> 20); it is on the path of most job routes',
  },
  groups: {
    'app/api/**/route.ts':
      'cost per request: next compiles a route entire module graph on first hit with no tree-shaking, and the measured cost tracks graph size almost linearly',
  },
  barrels: {
    'app/_lib/db.ts':
      'the export * barrel over 17 store modules. Importing it for value drags the whole data layer into the importer and everything downstream of it — import the slice instead',
  },
};

/** Index into a sorted array at a percentile, clamped to the array. */
const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];

/**
 * Write a budget from what the tree measures RIGHT NOW — the one command that
 * turns this tool into a gate. Ceilings are the measurement plus `slackPercent`,
 * so ordinary growth does not trip them and a doubling does.
 *
 * The group ceiling is the p95 route, not the worst one: a single fat route
 * must not buy headroom for all 200. Every route above that p95 gets a named
 * override with its own measured ceiling, which is what makes the fat ones
 * visible in the diff instead of hidden under a generous number.
 *
 * It refuses to overwrite an existing budget — lowering a ceiling is
 * `--tighten`, raising one is an edit somebody signs.
 */
export function record(root = REPO_ROOT, slackPercent = 15) {
  const file = path.join(root, BUDGET_FILE);
  if (fs.existsSync(file)) {
    console.error(`perf:budget --record: ${BUDGET_FILE} already exists. Use --tighten to lower ceilings, or edit it to raise one.`);
    return 1;
  }
  const budget = { version: 1, slackPercent, entries: {}, groups: {}, barrels: {} };

  for (const [rel, why] of Object.entries(DEFAULT_TARGETS.entries)) {
    if (!fs.existsSync(path.join(root, rel))) continue;
    const { modules, bytes } = walkGraph(path.join(root, rel), root);
    budget.entries[rel] = { maxModules: withSlack(modules, slackPercent), maxKb: withSlack(kb(bytes), slackPercent), why };
  }

  for (const [pattern, why] of Object.entries(DEFAULT_TARGETS.groups)) {
    const rows = expandGlob(pattern, root).map((rel) => {
      const { modules, bytes } = walkGraph(path.join(root, rel), root);
      return { rel, modules, kb: kb(bytes) };
    });
    if (!rows.length) continue;
    const maxModules = withSlack(percentile([...rows].map((r) => r.modules).sort((a, b) => a - b), 0.95), slackPercent);
    const maxKb = withSlack(percentile([...rows].map((r) => r.kb).sort((a, b) => a - b), 0.95), slackPercent);
    const overrides = {};
    for (const r of rows) {
      if (r.modules > maxModules || r.kb > maxKb) {
        overrides[r.rel] = {
          maxModules: withSlack(r.modules, slackPercent),
          maxKb: withSlack(r.kb, slackPercent),
          why: 'above the p95 route when the budget was recorded — a named exception, not a wider ceiling for everyone',
        };
      }
    }
    budget.groups[pattern] = { maxModules, maxKb, why, overrides };
  }

  for (const [rel, why] of Object.entries(DEFAULT_TARGETS.barrels)) {
    if (!fs.existsSync(path.join(root, rel))) continue;
    budget.barrels[rel] = { maxValueImporters: findValueImporters(rel, root).length, why };
  }

  fs.writeFileSync(file, JSON.stringify(budget, null, 2) + '\n');
  console.log(`perf:budget --record: wrote ${BUDGET_FILE} from the current tree. Read every ceiling before committing it.`);
  return 0;
}

export function main(argv) {
  if (argv.includes('--record')) return record();
  const explainAt = argv.indexOf('--explain');
  if (explainAt !== -1) {
    const target = argv[explainAt + 1];
    if (!target) {
      console.error('perf:budget --explain needs a repo-relative path');
      return 1;
    }
    explain(target);
    return 0;
  }

  let budget;
  try {
    budget = loadBudget();
  } catch (err) {
    console.error(`perf:budget: ${err.message}`);
    return 1;
  }

  const { findings, measurements } = evaluate(budget);

  if (argv.includes('--tighten')) {
    const { budget: next, changed } = tighten(budget, measurements);
    if (changed) {
      const current = fs.readFileSync(path.join(REPO_ROOT, BUDGET_FILE), 'utf8');
      const eol = current.includes('\r\n') ? '\r\n' : '\n';
      fs.writeFileSync(path.join(REPO_ROOT, BUDGET_FILE), JSON.stringify(next, null, 2).split('\n').join(eol) + eol);
      console.log(`perf:budget --tighten: lowered ${changed} ceiling(s) in ${BUDGET_FILE}.`);
    } else {
      console.log('perf:budget --tighten: every ceiling already matches the tree.');
    }
  }

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ ok: findings.length === 0, findings, measurements }, null, 2));
    return findings.length ? 1 : 0;
  }

  console.log(`perf:budget — ${measurements.length} measurements against ${BUDGET_FILE}`);
  const worst = measurements.filter((m) => m.kind !== 'barrel').sort((a, b) => b.modules - a.modules).slice(0, 5);
  for (const m of worst) {
    console.log(`  ${String(m.modules).padStart(4)} modules / ${String(m.kb).padStart(5)} KB  ${m.target}  (ceiling ${m.maxModules} / ${m.maxKb} KB)`);
  }
  for (const row of measurements.filter((m) => m.kind === 'barrel')) {
    console.log(`  barrel ${row.target}: ${row.importers} value importer(s), ceiling ${row.maxValueImporters}`);
  }

  if (findings.length === 0) {
    console.log('perf:budget: within budget.');
    return 0;
  }
  console.error(`\nperf:budget: ${findings.length} finding(s) — the tree costs more than ${BUDGET_FILE} allows.\n`);
  for (const f of findings) console.error(`  ${f.target}: ${f.message}`);
  console.error(
    `\nFix the graph (import the slice not the barrel; move a helper into a leaf module), or raise the ceiling in ` +
      `${BUDGET_FILE} with a 'why' a reviewer can disagree with. ` +
      `Run \`npm run perf:budget -- --explain <path>\` to see what is on the path.`,
  );
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
