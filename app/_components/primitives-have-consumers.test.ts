// Source-guard: every shared primitive at the top level of app/_components must be
// imported by at least one other file.
//
// Why this is worth a gate: a primitive with no importer is not free. It is read as
// live vocabulary — reviewers point new code at it, agents copy its patterns, the
// i18n and design gates spend budget on it, and it accrues fixes for bugs no user can
// hit. Two of them (FileInput, Radio) sat here fully built for months; Radio even
// carried its own a11y source-guard test, which made it look MORE alive than the
// primitives that actually ship. Every apparent `<Radio` in the tree resolved to the
// lucide-react icon of the same name, so grep confirmed the illusion.
//
// The rule is deliberately "has an importer", not "has a consumer that renders it":
// an import is the only relationship this file can verify cheaply and without false
// negatives. A file's OWN test referencing it by path (readFileSync(new URL(...)))
// does not count — that is how a dead primitive kept a self-referential pulse.
//
// If this fails for a primitive you just added: wire it into the surface it was built
// for in the same change, or don't land it yet. If it fails for one you just orphaned:
// delete it (and its tests), which is the cheaper half of the same decision.
//
// Runner: Node's built-in test runner with type stripping — npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PRIMITIVES_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(PRIMITIVES_DIR, "..", "..");
// Where an importer may live. `app/` is the application; `e2e/` occasionally imports a
// type or a constant from a primitive. Anything outside these two is not a consumer
// this repo ships.
const SEARCH_ROOTS = ["app", "e2e"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".git"]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** `import X from "…/Stem"`, `from "…/Stem.tsx"`, `await import("…/Stem")` — and
 *  nothing else. A bare path string (a test reading the file, a comment) is not an
 *  import, which is the whole point of anchoring on `from`/`import`. */
function importsModule(text: string, stem: string): boolean {
  return new RegExp(`(?:from|import)\\s*\\(?\\s*["'][^"']*/${stem}(?:\\.tsx?)?["']`).test(text);
}

const primitives = readdirSync(PRIMITIVES_DIR)
  .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
  .sort();

const corpus = SEARCH_ROOTS.flatMap((root) => sourceFiles(join(REPO_ROOT, root))).map((path) => ({
  path,
  text: readFileSync(path, "utf8"),
}));

test("the primitive corpus is non-empty — a broken scan must not pass vacuously", () => {
  assert.ok(primitives.length > 10, `expected the shared primitives, found ${primitives.length}`);
  assert.ok(corpus.length > 100, `expected the app source corpus, found ${corpus.length} files`);
});

test("every shared primitive in app/_components has at least one importer outside itself", () => {
  const orphans: string[] = [];
  for (const file of primitives) {
    const stem = file.replace(/\.tsx$/, "");
    const self = resolve(PRIMITIVES_DIR, file);
    const found = corpus.some((f) => resolve(f.path) !== self && importsModule(f.text, stem));
    if (!found) orphans.push(file);
  }
  assert.deepEqual(
    orphans,
    [],
    `dead shared primitive(s) with no importer anywhere in app/ or e2e/: ${orphans.join(", ")}. ` +
      "Wire each into the surface it was built for, or delete it with its tests — a primitive " +
      "nobody renders still costs review attention and gate budget."
  );
});
