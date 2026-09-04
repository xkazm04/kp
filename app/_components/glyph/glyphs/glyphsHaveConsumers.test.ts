// Source-guard: every traced glyph module in this folder must be imported by a
// file that actually renders it.
//
// Traced art is the most expensive dead weight this repo can carry: a single
// module is 8-50 KB of emitted path data, it ships in the client bundle of
// whatever imports it, and `glyphData.test.ts` spends real gate budget walking
// every path of every one. Two of them — `onboardingRunGlyph` (50 KB) and
// `stepTeamGlyph` (14 KB) — sat here with no render site at all: the only
// mentions repo-wide were the generated `.ai/registry-map.json` and
// `glyphData.test.ts`'s own fixture table, which is exactly the self-referential
// pulse that made a dead shared primitive look alive until
// `primitives-have-consumers.test.ts` was written (see its header).
//
// So the fixture table in `glyphData.test.ts` explicitly does NOT count as a
// consumer: an importer must live outside this folder.
//
// If this fails for a glyph you just traced: wire it into the surface it was
// drawn for in the same change. If it fails for one you just orphaned: delete
// the module (it is regenerable from `.claude/skills/motionize`), which is the
// cheaper half of the same decision.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GLYPHS_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(GLYPHS_DIR, "..", "..", "..", "..");
// Where a render site may live. `app/` is the application; `e2e/` occasionally
// imports a constant from a component module.
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

/** `from "…/jobsGlyph"`, `from "…/jobsGlyph.ts"`, `await import("…/jobsGlyph")`. */
function importsModule(text: string, stem: string): boolean {
  return new RegExp(`(?:from|import)\\s*\\(?\\s*["'][^"']*/${stem}(?:\\.tsx?)?["']`).test(text);
}

const modules = readdirSync(GLYPHS_DIR)
  .filter((f) => f.endsWith(".ts") && !f.includes(".test."))
  .sort();

// Anything inside this folder is the glyph corpus talking to itself — its own
// data contract test names all 20 by construction.
const corpus = SEARCH_ROOTS.flatMap((root) => sourceFiles(join(REPO_ROOT, root)))
  .filter((path) => resolve(path, "..") !== resolve(GLYPHS_DIR))
  .map((path) => ({ path, text: readFileSync(path, "utf8") }));

test("self-check: the scan sees the glyph modules and the app corpus", () => {
  assert.ok(modules.length > 10, `expected the traced glyph modules, found ${modules.length}`);
  assert.ok(corpus.length > 100, `expected the app source corpus, found ${corpus.length} files`);
});

test("every traced glyph module is imported by a render site outside this folder", () => {
  const orphans: string[] = [];
  for (const file of modules) {
    const stem = file.replace(/\.ts$/, "");
    if (!corpus.some((f) => importsModule(f.text, stem))) orphans.push(file);
  }
  assert.deepEqual(
    orphans,
    [],
    `traced glyph module(s) with no render site: ${orphans.join(", ")}. ` +
      "Wire each into the surface it was drawn for, or delete it — traced art nobody " +
      "renders is tens of kilobytes of emitted paths costing bundle and gate budget.",
  );
});
