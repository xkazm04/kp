#!/usr/bin/env node
// Fixtures for the static-only first-load walk. No deps - run with:
//   node scripts/perf/__tests__/first-load.test.mjs
//   npm run test:perf
//
// The walk is report-only, so the thing worth pinning is that it measures what
// it says: static edges only, client modules only, a 'use server' module as a
// stop, packages by name. The last cases run it against the real tree, because a
// walk whose regex silently broke reports a tiny, plausible, wrong number.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT } from '../check-budget.mjs';
import { directiveOf, entries, packageName, parseStaticImports, walkClient } from '../first-load.mjs';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-first-load-'));
  for (const [rel, src] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), src);
  }
  return root;
}

console.log('first-load walk');

// Order matters, and not by choice: VALUE_FROM_RE (check-budget.mjs) lets a side-effect
// import (`import './c.css'`) run on to the NEXT line's `from`, so an `import type`
// directly after one is read as a value edge. Shared with the budget, reported, not
// patched here.
check('parseStaticImports keeps value, re-export and side-effect edges, drops import() and import type', () => {
  const src = [
    "import { a } from './a';",
    "import type { T } from './t';",
    "export * from './b';",
    "import './c.css';",
    "const L = dynamic(() => import('./lazy'));",
  ].join('\n');
  assert.deepEqual(parseStaticImports(src).sort(), ['./a', './b', './c.css']);
});

check('directiveOf reads the leading directive past comments, and nothing else', () => {
  assert.equal(directiveOf('// header\n/* block */\n"use client";\nexport {}'), 'client');
  assert.equal(directiveOf("'use server';"), 'server');
  assert.equal(directiveOf("import x from 'y';\n'use client';"), null);
});

check('packageName keeps the scope and drops subpaths, node: and first-party', () => {
  assert.equal(packageName('@scope/pkg/sub'), '@scope/pkg');
  assert.equal(packageName('lucide-react/icons'), 'lucide-react');
  assert.equal(packageName('node:fs'), null);
  assert.equal(packageName('@/app/x'), null);
});

check('a server page counts only its client islands; dynamic and use-server edges are not shipped', () => {
  const root = fixture({
    'app/page.tsx': "import { Island } from './Island';\nimport { db } from './db';\nexport default function P() { return null; }",
    'app/db.ts': "import 'better-sqlite3';\nexport const db = 1;",
    'app/Island.tsx': "'use client';\nimport { helper } from './helper';\nimport { save } from './actions';\nimport { motion } from 'framer-motion';\nconst Lazy = dynamic(() => import('./Lazy'));\nexport function Island() {}",
    'app/helper.ts': 'export const helper = 1;',
    'app/actions.ts': "'use server';\nimport { db } from './db';\nexport async function save() {}",
    'app/Lazy.tsx': "'use client';\nexport default function Lazy() {}",
  });
  const r = walkClient(path.join(root, 'app/page.tsx'), root);
  const names = [...r.files].map((f) => path.basename(f)).sort();
  assert.deepEqual(names, ['Island.tsx', 'helper.ts']);
  assert.deepEqual([...r.packages], ['framer-motion']);
  assert.deepEqual([...r.boundaries].map((f) => path.basename(f)), ['actions.ts']);
  assert.equal(r.serverModules, 2); // page.tsx + db.ts: followed, never counted
  fs.rmSync(root, { recursive: true, force: true });
});

check('a use-client entry counts its whole static closure', () => {
  const root = fixture({
    'app/Shell.tsx': "'use client';\nimport './a';\nexport function Shell() {}",
    'app/a.ts': "import './b';",
    'app/b.ts': 'export {};',
  });
  const r = walkClient(path.join(root, 'app/Shell.tsx'), root);
  assert.equal(r.modules, 3);
  fs.rmSync(root, { recursive: true, force: true });
});

check('the real tree: the shell and every TAB_CHUNKS entry are measured', () => {
  const list = entries(REPO_ROOT);
  const chunkSrc = fs.readFileSync(path.join(REPO_ROOT, 'app/features/shell/tabChunks.ts'), 'utf8');
  const declared = [...chunkSrc.matchAll(/^\s*(\w+):\s*\(\)\s*=>\s*import\(/gm)].map((m) => m[1]);
  assert.ok(declared.length >= 20, `tabChunks.ts declared only ${declared.length} chunks - the reader broke`);
  assert.deepEqual(list.filter((e) => e.kind === 'tab').map((e) => e.name), declared);
  assert.equal(list[0].name, 'shell');
});

check('the real tree: the shell closure is non-trivial (a broken matcher reads as a tiny number)', () => {
  const r = walkClient(path.join(REPO_ROOT, 'app/features/shell/Workspace.tsx'), REPO_ROOT);
  assert.ok(r.modules > 40, `shell reached only ${r.modules} modules`);
  assert.ok(r.packages.has('react'), 'the shell must reach react');
});

console.log(`\nfirst-load: ${passed} checks passed`);
