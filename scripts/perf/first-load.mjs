#!/usr/bin/env node
// first-load.mjs - the client cost the import-graph budget cannot see.
//
// check-budget.mjs walks static AND dynamic imports, server code included, as a
// proxy for `next dev` compile cost - so moving a panel behind next/dynamic
// changes nothing there. This walk follows STATIC imports only, and counts only
// what ships to the browser on first load:
//
//   * a 'use client' module, and everything it statically imports, is CLIENT;
//   * a module with no directive reached from a server component stays SERVER:
//     followed (it may render a client island) but not counted;
//   * a 'use server' module is a boundary: the client receives a reference stub,
//     so the walk stops there and lists it;
//   * `import()` - including next/dynamic tab loaders - is lazy and never followed.
//
// Report-only: it has no ceilings yet; a later gate adds them. It measures first-
// party SOURCE (bytes on disk) plus the NAMES of third-party packages reached; it
// cannot see minified size, tree-shaking, CSS, or what a package pulls in itself.
//
//   node scripts/perf/first-load.mjs                     # the shell (Workspace), every tab chunk, the gate routes
//   node scripts/perf/first-load.mjs --json
//   node scripts/perf/first-load.mjs --target channels   # a tab id, a route (/offer), or `shell`
//   node scripts/perf/first-load.mjs --explain channels  # its heaviest client modules
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, SIDE_EFFECT_RE, VALUE_FROM_RE, resolveSpecifier } from './check-budget.mjs';

const DIRECTIVE_RE = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*['"]use (client|server)['"]/;

/** Static-only runtime specifiers: value imports, re-exports and side-effect imports. */
export function parseStaticImports(source) {
  return [...source.matchAll(VALUE_FROM_RE), ...source.matchAll(SIDE_EFFECT_RE)].map((m) => m[1]);
}

/** 'client' | 'server' | null - the module's leading directive. */
export function directiveOf(source) {
  return DIRECTIVE_RE.exec(source)?.[1] ?? null;
}

/** `@scope/name/sub` -> `@scope/name`, `name/sub` -> `name`; node: and URLs -> null. */
export function packageName(spec) {
  if (/^(node:|https?:|data:)/.test(spec) || spec.startsWith('.') || spec.startsWith('@/')) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

const cache = new Map();
function read(file, root) {
  if (cache.has(file)) return cache.get(file);
  let source = null;
  try { source = fs.readFileSync(file, 'utf8'); } catch { /* unreadable = not part of the graph */ }
  const mod = source == null ? null : file.endsWith('.json')
    ? { bytes: Buffer.byteLength(source), directive: null, deps: [], packages: [] }
    : (() => {
        const specs = [...new Set(parseStaticImports(source))];
        return {
          bytes: Buffer.byteLength(source),
          directive: directiveOf(source),
          deps: specs.map((s) => resolveSpecifier(s, file, root)).filter(Boolean),
          packages: specs.filter((s) => !resolveSpecifier(s, file, root)).map(packageName).filter(Boolean),
        };
      })();
  cache.set(file, mod);
  return mod;
}

/** The first-load client closure of one entry. */
export function walkClient(entryAbs, root = REPO_ROOT) {
  const client = new Set(), server = new Set(), boundaries = new Set(), packages = new Set();
  const queue = [[entryAbs, false]];
  while (queue.length) {
    const [file, parentClient] = queue.pop();
    const mod = read(file, root);
    if (!mod) continue;
    if (mod.directive === 'server' && file !== entryAbs) { boundaries.add(file); continue; }
    const isClient = parentClient || mod.directive === 'client';
    if (isClient ? client.has(file) : server.has(file) || client.has(file)) continue;
    (isClient ? client : server).add(file);
    if (isClient) mod.packages.forEach((p) => packages.add(p));
    for (const dep of mod.deps) queue.push([dep, isClient]);
  }
  for (const f of client) server.delete(f);
  const bytes = [...client].reduce((s, f) => s + read(f, root).bytes, 0);
  return { modules: client.size, bytes, files: client, serverModules: server.size, boundaries, packages };
}

const rel = (abs, root) => path.relative(root, abs).split(path.sep).join('/');

/** Every entry this report covers: the shell, each tab chunk, the gate routes. */
export function entries(root = REPO_ROOT) {
  const out = [{ name: 'shell', kind: 'shell', file: 'app/features/shell/Workspace.tsx' }];
  const shell = path.join(root, 'app', 'features', 'shell');
  const chunks = fs.readFileSync(path.join(shell, 'tabChunks.ts'), 'utf8');
  for (const m of chunks.matchAll(/^\s*(\w+):\s*\(\)\s*=>\s*import\(\s*["']([^"']+)["']\s*\)/gm)) {
    const abs = resolveSpecifier(m[2], path.join(shell, 'tabChunks.ts'), root);
    if (abs) out.push({ name: m[1], kind: 'tab', file: rel(abs, root) });
  }
  out.push({ name: '/', kind: 'route', file: 'app/page.tsx' });
  const targets = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'style', 'targets.json'), 'utf8')).targets;
  for (const t of Object.values(targets)) {
    if (t.path.startsWith('/?')) continue;
    const segs = t.path.split('?')[0].split('/').filter(Boolean);
    let dir = path.join(root, 'app');
    for (const s of segs) {
      if (!/^\{\w+\}$/.test(s)) { dir = path.join(dir, s); continue; }
      const dyn = fs.readdirSync(dir).find((d) => /^\[[^\]]+\]$/.test(d));
      dir = dyn ? path.join(dir, dyn) : path.join(dir, '__missing__');
    }
    const page = path.join(dir, 'page.tsx');
    const name = '/' + segs.filter((s) => !s.startsWith('{')).join('/');
    if (fs.existsSync(page) && !out.some((e) => e.name === name)) out.push({ name, kind: 'route', file: rel(page, root) });
  }
  return out;
}

export function measure(root = REPO_ROOT) {
  return entries(root).map((e) => {
    const r = walkClient(path.join(root, e.file), root);
    return { ...e, modules: r.modules, kb: Math.round(r.bytes / 1024), serverModules: r.serverModules, useServer: r.boundaries.size, packages: [...r.packages].sort() };
  });
}

function explain(entry, root = REPO_ROOT) {
  const r = walkClient(path.join(root, entry.file), root);
  console.log(`${entry.name} (${entry.file}): ${r.modules} client modules / ${Math.round(r.bytes / 1024)} KB of first-party source\n`);
  console.log('heaviest client modules on the first load:');
  for (const f of [...r.files].sort((a, b) => read(b, root).bytes - read(a, root).bytes).slice(0, 20)) {
    console.log(`  ${String(Math.round(read(f, root).bytes / 1024)).padStart(4)} KB  ${rel(f, root)}`);
  }
  if (r.boundaries.size) console.log(`\n'use server' boundaries (stubbed, not shipped): ${[...r.boundaries].map((f) => rel(f, root)).join(', ')}`);
  console.log(`\npackages: ${[...r.packages].sort().join(', ') || '(none)'}`);
}

export function main(argv) {
  const at = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const find = (name) => entries().find((e) => e.name === name || e.name === `/${String(name).replace(/^\//, '')}` || e.file === name);
  const ex = at('--explain');
  if (ex) {
    const e = find(ex);
    if (!e) { console.error(`first-load: no entry "${ex}"`); return 1; }
    explain(e);
    return 0;
  }
  let rows = measure();
  const only = at('--target');
  if (only) {
    rows = rows.filter((r) => r === rows.find((x) => x.name === only || x.name === `/${only.replace(/^\//, '')}` || x.file === only));
    if (!rows.length) { console.error(`first-load: no entry "${only}"`); return 1; }
  }
  if (argv.includes('--json')) { console.log(JSON.stringify(rows, null, 2)); return 0; }
  console.log('first-load (static imports only, client modules; report-only)\n');
  console.log(`${'entry'.padEnd(14)} ${'kind'.padEnd(6)} ${'modules'.padStart(7)} ${'KB'.padStart(6)}  packages`);
  for (const r of rows) console.log(`${r.name.padEnd(14)} ${r.kind.padEnd(6)} ${String(r.modules).padStart(7)} ${String(r.kb).padStart(6)}  ${r.packages.join(', ')}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
