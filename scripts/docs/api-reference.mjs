#!/usr/bin/env node
// THE HTTP SURFACE, GENERATED FROM THE TREE THAT SERVES IT.
//
// THE GAP THIS CLOSES: `docs/` explains the product well and the ADRs record the
// decisions, but there was no description of the thing an agent is most often
// asked to change. A route like `/api/stt` arrived with a commit message; its
// path, its methods and — most of all — whether the fail-closed auth gate lets an
// anonymous caller reach it lived only in the handler and in
// `app/_lib/auth/public-routes.ts`. With 206 route files, "read them" is not an
// answer, and a hand-written list of 206 routes is a lie within a week.
//
// So this is generated, and the generation is the point:
//
//   * the PATH comes from the directory, exactly as Next resolves it;
//   * the METHODS come from the handler's own exports;
//   * the AUTH POSTURE is computed by calling `isPublicPath()` — THE SAME
//     PREDICATE THE PROXY USES. Not a second list that agrees with it today.
//     A route added under `/api/apply/` is documented as public because it IS
//     public, by the same function that decides at runtime.
//
//   npm run api:docs     # rewrite docs/architecture/api-reference.md
//   npm run api:check    # fail when the doc and the tree disagree
//
// WHAT `--check` COMPARES, and what it deliberately does not. It compares the
// SET of (path, methods, auth) — a route with no row, a row with no route, a
// method added or removed, a route that changed side of the auth gate. Those are
// mechanical facts the tree settles outright. It does NOT compare the prose
// around the table: a check that demanded byte-equality of a document humans
// also write turns into a chore that gets satisfied by deleting the writing.
//
// It also REPORTS, without failing, how many handlers do not declare their
// request/response shape in their header comment — the convention `/api/stt`
// follows (`// POST /api/stt  multipart: audio=<File>, … -> a transcript as
// JSON`). That number is the honest measure of the half of this that generation
// cannot do: a shape lives with the code that produces it, and no parser should
// invent one. It is a note rather than a gate because seeding a ceiling for it is
// a measurement, and a ceiling nobody measured is a number nobody can defend.
//
// EXIT CODES: 0 the doc matches the tree (or it was rewritten) · 1 it does not.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DOC_PATH = 'docs/architecture/api-reference.md';
export const ROUTES_ROOT = 'app/api';

/** Rendered in this order everywhere, so a diff is never about ordering. */
export const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const METHOD_RE = /^export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/gm;

/** A header line that declares the route's contract, as `/api/stt` does. */
const CONTRACT_RE = /^\s*\/\/\s*(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\/api\//m;

/** The exported handlers, in METHOD_ORDER. Pure. */
export function methodsIn(source) {
  const found = new Set([...String(source ?? '').matchAll(METHOD_RE)].map((m) => m[1]));
  return METHOD_ORDER.filter((m) => found.has(m));
}

/** Does the handler's header comment declare what it takes and returns? Pure. */
export function declaresContract(source) {
  // Only the LEADING comment block: a contract line quoted halfway down a file is
  // a comment about something else, and counting it would inflate the number this
  // exists to report honestly.
  const head = String(source ?? '').split(/\n\s*\n/, 1)[0] ?? '';
  return CONTRACT_RE.test(head);
}

/**
 * `app/api/apply/[id]/session/route.ts` → `/api/apply/[id]/session`.
 * Pure, and separator-agnostic so a Windows walk and a POSIX one agree.
 */
export function routePathOf(relFile) {
  const parts = String(relFile).split(/[\\/]/);
  if (parts[parts.length - 1] !== 'route.ts') return null;
  return `/${parts.slice(1, -1).join('/')}`;
}

/**
 * `/api/apply/[id]` → `/api/apply/_`. `isPublicPath` matches by path SEGMENT
 * against real pathnames, so a dynamic segment has to be stood in for by
 * something that is one segment. A catch-all becomes two, which is the case that
 * matters: a `[...rest]` route can be reached at a depth its parent prefix does
 * not cover.
 */
export function concretePath(routePath) {
  return String(routePath)
    .replace(/\[\.\.\.[^\]]+\]/g, '_/_')
    .replace(/\[[^\]]+\]/g, '_');
}

/** Every route file under `app/api`, sorted. */
export function listRouteFiles(root = REPO_ROOT) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (e.name === 'route.ts') out.push(rel);
    }
  };
  walk(ROUTES_ROOT);
  return out;
}

/**
 * The tree's answer: one row per route file.
 * `isPublicPath` is INJECTED — it is TypeScript that the fixtures must not have
 * to load, and injecting it is also what lets a fixture prove the auth column
 * comes from the predicate rather than from a copy of its list.
 */
export function readRoutes(isPublicPath, root = REPO_ROOT) {
  return listRouteFiles(root)
    .map((rel) => {
      const source = fs.readFileSync(path.join(root, rel), 'utf8');
      const routePath = routePathOf(rel);
      return {
        file: rel,
        path: routePath,
        methods: methodsIn(source),
        auth: isPublicPath(concretePath(routePath)) ? 'public' : 'gated',
        contract: declaresContract(source),
      };
    })
    .filter((r) => r.path && r.methods.length)
    .sort(byPath);
}

/** `/api/jobs/[id]/close` → `jobs`. The heading a row is filed under. */
export const groupOf = (routePath) => String(routePath).split('/')[2] ?? '';

/**
 * Codepoint order, NOT `localeCompare`. A locale collator gives punctuation a
 * lower weight than letters, so `/api/jobs/[id]` and `/api/jobs/ingest` sort
 * differently depending on the ICU data the runner ships — and the whole value of
 * a generated file is that two machines produce the same bytes.
 */
export const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

const row = (r) => `| \`${r.path}\` | ${r.methods.join(', ')} | ${r.auth} |`;

/** The generated half of the document, from `<!-- BEGIN -->` to `<!-- END -->`. */
export const BEGIN = '<!-- BEGIN GENERATED ROUTES -->';
export const END = '<!-- END GENERATED ROUTES -->';

export function renderTable(routes) {
  const groups = new Map();
  for (const r of routes) {
    const g = groupOf(r.path);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  const lines = [
    BEGIN,
    '',
    `_${routes.length} routes, ${routes.reduce((n, r) => n + r.methods.length, 0)} handlers._`,
    '',
  ];
  for (const g of [...groups.keys()].sort()) {
    lines.push(`### \`/api/${g}\``, '', '| Route | Methods | Auth |', '| --- | --- | --- |');
    for (const r of groups.get(g)) lines.push(row(r));
    lines.push('');
  }
  lines.push(END);
  return lines.join('\n');
}

/** Splice a freshly rendered table into the committed document. */
export function spliceTable(doc, table) {
  const start = doc.indexOf(BEGIN);
  const end = doc.indexOf(END);
  if (start === -1 || end === -1 || end < start) return null;
  return `${doc.slice(0, start)}${table}${doc.slice(end + END.length)}`;
}

/** The rows the committed document carries. Pure, and tolerant of prose around them. */
export function parseTable(doc) {
  const start = String(doc ?? '').indexOf(BEGIN);
  const end = String(doc ?? '').indexOf(END);
  if (start === -1 || end === -1) return null;
  const out = [];
  for (const line of doc.slice(start, end).split(/\r?\n/)) {
    const m = /^\|\s*`(\/api\/[^`]*)`\s*\|([^|]*)\|([^|]*)\|\s*$/.exec(line.trim());
    if (!m) continue;
    out.push({
      path: m[1].trim(),
      methods: m[2].split(',').map((s) => s.trim()).filter(Boolean),
      auth: m[3].trim(),
    });
  }
  return out.sort(byPath);
}

/**
 * Compare the document against the tree.
 * Pure. Returns findings; empty means the doc describes the surface that exists.
 */
export function diff(documented, actual) {
  const out = [];
  if (documented === null) {
    return [
      {
        rule: 'no-table',
        message: `${DOC_PATH} has no \`${BEGIN}\` / \`${END}\` block.`,
        fix: 'Restore the markers, or run `npm run api:docs` to rewrite the file.',
      },
    ];
  }
  const documentedByPath = new Map(documented.map((r) => [r.path, r]));
  for (const r of actual) {
    const doc = documentedByPath.get(r.path);
    if (!doc) {
      out.push({
        rule: 'undocumented',
        message: `${r.path} (${r.file}) serves ${r.methods.join(', ')} and the reference does not mention it.`,
        fix: 'Run `npm run api:docs`. A route nobody documented is one the next agent calls by reading the handler.',
      });
      continue;
    }
    if (doc.methods.join(',') !== r.methods.join(',')) {
      out.push({
        rule: 'methods-drift',
        message: `${r.path} serves ${r.methods.join(', ') || '(none)'}; the reference says ${doc.methods.join(', ') || '(none)'}.`,
        fix: 'Run `npm run api:docs`.',
      });
    }
    if (doc.auth !== r.auth) {
      out.push({
        rule: 'auth-drift',
        // The one that matters most: `isPublicPath` is the fail-closed gate, and a
        // route that changed sides is a change in who can reach it.
        message: `${r.path} is ${r.auth} (per app/_lib/auth/public-routes.ts); the reference says ${doc.auth}.`,
        fix: 'Run `npm run api:docs` — and if the change to the allow-list was not deliberate, that is the bug.',
      });
    }
  }
  const live = new Set(actual.map((r) => r.path));
  for (const d of documented) {
    if (!live.has(d.path)) {
      out.push({
        rule: 'stale',
        message: `the reference documents ${d.path}, which no longer has a handler.`,
        fix: 'Run `npm run api:docs`. A reference that names a route that is gone sends a caller to a 404.',
      });
    }
  }
  return out;
}

export function render(findings, actual) {
  const undeclared = actual.filter((r) => !r.contract);
  const note =
    undeclared.length === 0
      ? 'every handler declares its contract in its header comment.'
      : `${undeclared.length} of ${actual.length} handlers do not declare their request/response shape in their header ` +
        'comment (the convention app/api/stt/route.ts follows). Not a failure — a shape belongs with the code that ' +
        'produces it, and no parser should invent one — but it is the size of what generation cannot do for you.';

  if (findings.length === 0) {
    return `api-reference ✓ ${DOC_PATH} describes all ${actual.length} routes and their auth posture; ${note}`;
  }
  return [
    ...findings.map((f) => `BLOCK  [${f.rule}] ${f.message}\n       ${f.fix}`),
    '',
    `${findings.length} finding(s). note: ${note}`,
  ].join('\n');
}

// --- cli ---------------------------------------------------------------------

async function main(argv) {
  // The TS predicate, loaded here and nowhere else: the pure functions above take
  // it as an argument so the fixtures run under plain `node`.
  const { isPublicPath } = await import('../../app/_lib/auth/public-routes.ts');
  const actual = readRoutes(isPublicPath);
  const docFile = path.join(REPO_ROOT, DOC_PATH);
  const existing = fs.existsSync(docFile) ? fs.readFileSync(docFile, 'utf8') : null;

  if (!argv.includes('--check')) {
    if (existing === null) {
      console.error(`api-reference: ${DOC_PATH} does not exist. Create it with the ${BEGIN} / ${END} markers first.`);
      return 1;
    }
    const next = spliceTable(existing, renderTable(actual));
    if (next === null) {
      console.error(`api-reference: ${DOC_PATH} has no generated block to replace (${BEGIN} … ${END}).`);
      return 1;
    }
    if (next !== existing) fs.writeFileSync(docFile, next);
    console.log(`api-reference: ${next === existing ? 'no change' : 'rewrote'} ${DOC_PATH} — ${actual.length} routes.`);
    return 0;
  }

  const findings = existing === null
    ? [{ rule: 'no-table', message: `${DOC_PATH} does not exist.`, fix: 'Run `npm run api:docs`.' }]
    : diff(parseTable(existing), actual);
  console.log(render(findings, actual));
  return findings.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
