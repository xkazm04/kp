#!/usr/bin/env node
// Fixtures for the generated API reference. No deps — run with:
//   node scripts/docs/__tests__/api-reference.test.mjs   (npm run test:docs)
//
// The load-bearing case is the last one: the committed document is compared
// against the real tree, right now, on paths and methods. `npm run api:check`
// does the same thing AND the auth column, but it has to load a TypeScript
// module to do it; this runs under plain `node` in the fixture suite, so a doc
// that stopped describing the routes fails twice rather than once.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  DOC_PATH,
  METHOD_ORDER,
  concretePath,
  declaresContract,
  diff,
  groupOf,
  listRouteFiles,
  methodsIn,
  parseTable,
  readRoutes,
  renderTable,
  routePathOf,
  spliceTable,
} from '../api-reference.mjs';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

// --- reading a handler --------------------------------------------------------

check('the exported handlers, in one canonical order', () => {
  const source = [
    'export async function POST(request: Request) {}',
    'export async function GET() {}',
    'export function DELETE() {}',
    'export const PATCH = handler;',
  ].join('\n');
  assert.deepEqual(methodsIn(source), ['GET', 'POST', 'PATCH', 'DELETE']);
  assert.deepEqual(
    methodsIn(source).slice().sort((a, b) => METHOD_ORDER.indexOf(a) - METHOD_ORDER.indexOf(b)),
    methodsIn(source),
    'the order is METHOD_ORDER, so a diff is never about ordering',
  );
});

check('only a top-level export is a handler', () => {
  assert.deepEqual(methodsIn('// GET is handled elsewhere\nconst GET = 1;\n  export async function GET() {}'), []);
  assert.deepEqual(methodsIn('export async function GETTER() {}'), [], 'a longer name is not a method');
  assert.deepEqual(methodsIn(''), []);
});

check('a route path comes from the directory, on either separator', () => {
  assert.equal(routePathOf('app/api/apply/[id]/session/route.ts'), '/api/apply/[id]/session');
  assert.equal(routePathOf('app\\api\\stt\\route.ts'), '/api/stt');
  assert.equal(routePathOf('app/api/stt/helpers.ts'), null);
});

check('a dynamic segment stands in as ONE segment, a catch-all as two', () => {
  // `isPublicPath` matches by segment against real pathnames, so `[id]` has to
  // become something that is one segment — and `[...rest]` has to become
  // something deeper than its parent, which is the case that decides whether a
  // prefix covers it.
  assert.equal(concretePath('/api/apply/[id]/session'), '/api/apply/_/session');
  assert.equal(concretePath('/api/x/[...rest]'), '/api/x/_/_');
  assert.equal(concretePath('/api/health'), '/api/health');
});

check('a contract declaration is a header line, not a mention', () => {
  assert.equal(declaresContract('// The wrapper.\n//   GET  /api/stt  -> { providers }\nimport x from "y";'), true);
  assert.equal(declaresContract('// Does things.\nimport x from "y";'), false);
  assert.equal(
    declaresContract('import x from "y";\n\n// later on\n// GET /api/other -> nope'),
    false,
    'only the leading block counts — a line quoted halfway down is about something else',
  );
});

check('routes are grouped by their first segment under /api', () => {
  assert.equal(groupOf('/api/jobs/[id]/close'), 'jobs');
  assert.equal(groupOf('/api/stt'), 'stt');
});

// --- the document -------------------------------------------------------------

const ROUTES = [
  { path: '/api/a', methods: ['GET'], auth: 'gated', file: 'app/api/a/route.ts', contract: true },
  { path: '/api/a/[id]', methods: ['GET', 'POST'], auth: 'public', file: 'app/api/a/[id]/route.ts', contract: false },
  { path: '/api/b', methods: ['DELETE'], auth: 'gated', file: 'app/api/b/route.ts', contract: true },
];

check('render → parse is a round trip', () => {
  const parsed = parseTable(renderTable(ROUTES));
  assert.deepEqual(parsed, ROUTES.map(({ path: p, methods, auth }) => ({ path: p, methods, auth })));
});

check('the prose around the table survives a rewrite', () => {
  const doc = `# Title\n\nSome prose.\n\n${renderTable(ROUTES)}\n\n## Adding a route\n\nMore prose.\n`;
  const next = spliceTable(doc, renderTable([ROUTES[0]]));
  assert.match(next, /^# Title/);
  assert.match(next, /## Adding a route/);
  assert.match(next, /More prose\./);
  assert.deepEqual(parseTable(next).map((r) => r.path), ['/api/a']);
  assert.equal(spliceTable('a document with no markers', 'x'), null);
});

check('a document with no generated block is a finding, not a pass', () => {
  const findings = diff(parseTable('no markers here'), ROUTES);
  assert.deepEqual(findings.map((f) => f.rule), ['no-table']);
});

// --- drift --------------------------------------------------------------------

check('a matching document has nothing to say', () => {
  assert.deepEqual(diff(parseTable(renderTable(ROUTES)), ROUTES), []);
});

check('UNDOCUMENTED: a route that arrived and no row learned about it', () => {
  const findings = diff(parseTable(renderTable([ROUTES[0]])), ROUTES);
  assert.deepEqual(findings.map((f) => f.rule).sort(), ['undocumented', 'undocumented']);
  assert.match(findings[0].message, /\/api\/a\/\[id\]|\/api\/b/);
});

check('STALE: a row whose handler is gone', () => {
  const findings = diff(parseTable(renderTable(ROUTES)), [ROUTES[0]]);
  assert.deepEqual(findings.map((f) => f.rule), ['stale', 'stale']);
});

check('METHODS-DRIFT: a handler added or removed', () => {
  const doc = parseTable(renderTable(ROUTES));
  const findings = diff(doc, [ROUTES[0], { ...ROUTES[1], methods: ['GET'] }, ROUTES[2]]);
  assert.deepEqual(findings.map((f) => f.rule), ['methods-drift']);
  assert.match(findings[0].message, /serves GET; the reference says GET, POST/);
});

check('AUTH-DRIFT: the route changed side of the fail-closed gate', () => {
  // The finding that matters most. `isPublicPath` is what the proxy consults, so
  // a row that disagrees with it is a row about who can reach the handler.
  const doc = parseTable(renderTable(ROUTES));
  const findings = diff(doc, [ROUTES[0], { ...ROUTES[1], auth: 'gated' }, ROUTES[2]]);
  assert.deepEqual(findings.map((f) => f.rule), ['auth-drift']);
  assert.match(findings[0].message, /public-routes\.ts/);
});

// --- the tree, right now ------------------------------------------------------

check('THE COMMITTED REFERENCE DESCRIBES THE ROUTES THAT EXIST', () => {
  // Paths and methods only: the auth column needs `isPublicPath`, which is
  // TypeScript, and this file runs under plain `node`. `npm run api:check` is
  // where the third column is compared — this is the half that can be proved
  // without a loader, and it is the half that changes every time a route lands.
  const doc = fs.readFileSync(path.join(REPO_ROOT, DOC_PATH), 'utf8');
  const documented = parseTable(doc);
  assert.ok(documented, `${DOC_PATH} has no generated block`);

  const actual = readRoutes(() => false, REPO_ROOT); // auth is not judged here
  assert.equal(actual.length, listRouteFiles(REPO_ROOT).length, 'every route file yields a row');
  assert.ok(actual.length > 100, 'the walker found the tree, not an empty directory');

  const shape = (rows) => rows.map((r) => `${r.path} ${r.methods.join(',')}`);
  const findings = diff(
    documented.map((r) => ({ ...r, auth: 'gated' })),
    actual,
  );
  assert.deepEqual(
    findings.map((f) => f.message),
    [],
    `${DOC_PATH} is out of date — run \`npm run api:docs\``,
  );
  assert.deepEqual(shape(documented), shape(actual), 'the rows are also in the generated ORDER');
});

console.log(`\napi-reference fixtures: ${passed} checks passed.`);
