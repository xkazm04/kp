// The inspector must not reach a production browser — a SOURCE guard on the shape
// that keeps it out.
//
// WHY A SOURCE GUARD AND NOT A BUNDLE ASSERTION. The honest verification is
// `npm run build` plus a grep of `.next/static/chunks`, and that is how the defect
// this file guards was FOUND (2026-09-04, a real build on main): the layout's
// `process.env.NODE_ENV === "development" && <DevInspector />` gate decided what
// rendered but not what was bundled, and 20,253 bytes of inspector shipped in a
// client chunk listed in `.next/server/app/page_client-reference-manifest.js`. A
// unit test cannot run `next build` — it takes minutes and needs the Python
// codegen — so this file pins the three source properties the fix rests on, and
// the build+grep stays the periodic check. Say which you ran when you touch this.
//
// The properties, each of which alone would let the module back into the eager
// graph:
//   1. app/layout.tsx keeps a LITERAL `process.env.NODE_ENV === "development"`
//      gate (a bundler can only fold a literal — a variable, a helper, or
//      `!== "production"` behind an indirection defeats the constant inlining).
//   2. DevInspector.tsx — the only module the layout imports — never imports the
//      implementation statically; it reaches it through `import()` INSIDE that
//      same constant branch.
//   3. Nothing else in the app imports the inspector at all.
//
// Runner: node:test with type stripping. `npm run test:unit app/_dev-inspector/dev-inspector-bundle.test.ts`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const HERE = import.meta.dirname;
const APP = path.join(HERE, "..");
const REPO = path.join(APP, "..");

/** Read a source file with line endings normalized — this checkout is CRLF on
 *  Windows while a worktree may be LF, and every regex below is anchored. */
function source(rel: string): string {
  return readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
}

test("the root layout gates the inspector on a LITERAL NODE_ENV comparison", () => {
  const layout = source("app/layout.tsx");
  // The exact text a bundler folds. Written as one regex over the whole mount so
  // a refactor that keeps the string but drops the gate still fails.
  assert.match(
    layout,
    /\{\s*process\.env\.NODE_ENV === "development" && <DevInspector \/>\s*\}/,
    "app/layout.tsx must mount <DevInspector /> behind a literal NODE_ENV === \"development\" gate",
  );
});

test("the layout imports ONLY the stub, never the implementation", () => {
  const layout = source("app/layout.tsx");
  assert.match(layout, /from "\.\/_dev-inspector\/DevInspector"/);
  assert.doesNotMatch(
    layout,
    /_dev-inspector\/DevInspectorImpl/,
    "importing the implementation from the layout puts the whole inspector back in the eager client graph",
  );
});

test("the stub reaches the implementation ONLY through a guarded dynamic import", () => {
  const stub = source("app/_dev-inspector/DevInspector.tsx");

  // No static import of the implementation, in either syntax.
  assert.doesNotMatch(stub, /^\s*import\s[^\n]*["']\.\/DevInspectorImpl["']/m);
  assert.doesNotMatch(stub, /require\(\s*["']\.\/DevInspectorImpl["']\s*\)/);

  // A dynamic one, yes.
  assert.match(stub, /import\(\s*"\.\/DevInspectorImpl"\s*\)/);

  // …and it is UNDER the literal guard, not beside it: the guard's early return
  // has to appear before the import in the source. A dynamic import outside the
  // constant branch is still a chunk the bundler must emit and may preload.
  const guard = stub.indexOf('process.env.NODE_ENV !== "development"');
  const dynamic = stub.search(/import\(\s*"\.\/DevInspectorImpl"/);
  assert.ok(guard !== -1, "the stub must carry the literal NODE_ENV guard");
  assert.ok(guard < dynamic, "the dynamic import must sit inside the NODE_ENV branch, after the guard");
});

test("the stub stays thin: it imports nothing but react", () => {
  const stub = source("app/_dev-inspector/DevInspector.tsx");
  // Whatever this file imports, the whole app imports — that is the entire reason
  // it exists. `react` is already in every client graph, so it is free.
  const specifiers = [...stub.matchAll(/^\s*import\s[^\n]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
  assert.deepEqual(specifiers, ["react"], `the stub must import only react, found: ${specifiers.join(", ")}`);
});

test("nothing outside app/_dev-inspector/ imports the inspector except the layout", () => {
  const offenders: string[] = [];
  const skip = new Set(["node_modules", ".next", ".next-empty", ".git", "_dev-inspector"]);

  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(name)) continue;
      const rel = path.relative(REPO, full).replace(/\\/g, "/");
      if (rel === "app/layout.tsx") continue;
      // An IMPORT, not a mention: app/lint-selector-coverage.test.ts names the
      // path in a string (it asks eslint which rules resolve for that file) and
      // is not a module edge.
      const text = readFileSync(full, "utf8").replace(/\r\n/g, "\n");
      const imports = /(?:^\s*import\s[^\n]*from\s*|import\(\s*|require\(\s*)["'][^"'\n]*_dev-inspector\/DevInspector/m;
      if (imports.test(text)) offenders.push(rel);
    }
  };
  walk(APP);

  assert.deepEqual(
    offenders,
    [],
    `only app/layout.tsx may import the inspector; found: ${offenders.join(", ")}`,
  );
});
