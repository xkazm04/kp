#!/usr/bin/env node
// scan-sweep coverage table — per-context lens coverage from scan-history.
// Reads context-map.json (repo root) + .claude/scan-history/scan-sweep.jsonl.
// Usage: node .claude/skills/scan-sweep/scripts/coverage.mjs [--all]
import { readFileSync, existsSync } from 'node:fs';

const all = process.argv.includes('--all');
const map = JSON.parse(readFileSync('context-map.json', 'utf8'));
const histPath = '.claude/scan-history/scan-sweep.jsonl';
const hist = existsSync(histPath)
  ? readFileSync(histPath, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  : [];
const byScope = new Map();
for (const h of hist) {
  const e = byScope.get(h.scope) ?? { lenses: new Set(), findings: 0, fixed: 0, sweeps: 0, last: null, strategy: null };
  for (const k of h.lens_keys ?? []) e.lenses.add(k);
  e.findings += h.findings ?? 0; e.fixed += h.fixed ?? 0; e.sweeps += 1;
  if (!e.last || h.at > e.last) { e.last = h.at; e.strategy = h.strategy ?? null; }
  byScope.set(h.scope, e);
}
const rows = (map.contexts ?? []).map((c) => {
  const e = byScope.get(c.name);
  return {
    name: c.name, files: (c.file_paths ?? []).length,
    lenses: e ? e.lenses.size : 0, sweeps: e ? e.sweeps : 0,
    findings: e ? e.findings : 0, fixed: e ? e.fixed : 0,
    strategy: e && e.strategy ? e.strategy : '-',
    age: e && e.last ? Math.round((Date.now() - Date.parse(e.last)) / 86400000) + 'd' : 'never',
  };
}).sort((a, b) => a.lenses - b.lenses || b.files - a.files);
const shown = all ? rows : rows.slice(0, 30);
const pad = (s, n, r) => (r ? String(s).padStart(n) : String(s).padEnd(n));
console.log(pad('CONTEXT', 36) + pad('FILES', 6, 1) + pad('LENSES', 8, 1) + pad('SWEEPS', 7, 1) + pad('FOUND', 6, 1) + pad('FIXED', 6, 1) + pad('STRATEGY', 10, 1) + pad('LAST', 7, 1));
for (const r of shown) {
  console.log(pad(r.name.slice(0, 35), 36) + pad(r.files, 6, 1) + pad(r.lenses + '/22', 8, 1) + pad(r.sweeps, 7, 1) + pad(r.findings, 6, 1) + pad(r.fixed, 6, 1) + pad(r.strategy, 10, 1) + pad(r.age, 7, 1));
}
const covered = rows.filter((r) => r.lenses > 0).length;
console.log('\n' + covered + '/' + rows.length + ' contexts swept; sorted least lens-covered first' + (all ? '' : ' (top 30 — pass --all for every context)'));
