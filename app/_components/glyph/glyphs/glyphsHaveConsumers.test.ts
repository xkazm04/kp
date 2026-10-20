// Source-guard: every traced glyph in this folder must have a render site.
//
// Traced art is the most expensive dead weight this repo can carry: a single
// module is 8-50 KB of emitted path data, and `glyphData.test.ts` spends real gate
// budget walking every path of every one. Two of them — `onboardingRunGlyph`
// (50 KB) and `stepTeamGlyph` (14 KB) — sat here with no render site at all: the
// only mentions repo-wide were the generated `.ai/registry-map.json` and
// `glyphData.test.ts`'s own fixture table, which is exactly the self-referential
// pulse that made a dead shared primitive look alive until
// `primitives-have-consumers.test.ts` was written (see its header).
//
// Art is loaded BY ID now (challenge-r03 glyph-system/A): the modules are imported
// only by the server-side `../glyphCatalog.ts` behind GET /api/glyphs/[id], and a
// render site names its glyph — `<MotionizedGlyph glyph="jobs" />`, or a spec
// field `glyph: "schedule"`. An import of the module is no longer how a surface
// consumes it (and importing one from a client component is how the ~274 KB got
// onto the workspace page graph — glyphLoader.test.ts forbids that). So the
// consumer here is an id reference in a `glyph` prop or field, in a file OUTSIDE
// app/_components/glyph/: the catalog, the registry and this folder's own fixture
// table name every id by construction and do not count.
//
// If this fails for a glyph you just traced: wire it into the surface it was
// drawn for in the same change. If it fails for one you just orphaned: delete
// the module and its GLYPH_IDS / catalog entries (it is regenerable from
// `.claude/skills/motionize`), which is the cheaper half of the same decision.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const GLYPHS_DIR = fileURLToPath(new URL(".", import.meta.url));
const GLYPH_COMPONENT_DIR = resolve(GLYPHS_DIR, "..");
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

/** `glyph="jobs"`, `glyph={"jobs"}`, `glyph: "jobs"`: an id handed to a renderer. */
function namesGlyph(text: string, id: string): boolean {
  return new RegExp(`\\bglyph\\s*(?:=\\s*\\{?|:)\\s*["']${id}["']`).test(text);
}

const modules = readdirSync(GLYPHS_DIR)
  .filter((f) => f.endsWith(".ts") && !f.includes(".test."))
  .sort();

// Anything under app/_components/glyph/ is the glyph system talking to itself —
// the catalog, the registry and the data contract test name all 13 by construction.
const corpus = SEARCH_ROOTS.flatMap((root) => sourceFiles(join(REPO_ROOT, root)))
  .filter((path) => !resolve(path).startsWith(GLYPH_COMPONENT_DIR + sep))
  .map((path) => ({ path, text: readFileSync(path, "utf8") }));

test("self-check: the scan sees the glyph modules and the app corpus", () => {
  // 9 since the four channel glyphs left with the Channels Intake Studio view (2026-09-25).
  assert.ok(modules.length >= 9, `expected the traced glyph modules, found ${modules.length}`);
  assert.ok(corpus.length > 100, `expected the app source corpus, found ${corpus.length} files`);
});

test("every traced glyph is named by a render site outside the glyph system", () => {
  const orphans: string[] = [];
  for (const file of modules) {
    const id = file.replace(/Glyph\.ts$/, "");
    if (!corpus.some((f) => namesGlyph(f.text, id))) orphans.push(file);
  }
  assert.deepEqual(
    orphans,
    [],
    `traced glyph(s) with no render site: ${orphans.join(", ")}. ` +
      "Wire each into the surface it was drawn for, or delete it — traced art nobody " +
      "renders is tens of kilobytes of emitted paths costing gate budget.",
  );
});

test("no file outside the glyph system imports a traced module (the art is served by id)", () => {
  const importers: string[] = [];
  for (const f of corpus) {
    if (/(?:from|import)\s*\(?\s*["'][^"']*\/glyph\/glyphs\/[^"']*["']/.test(f.text)) importers.push(f.path);
  }
  assert.deepEqual(importers, [], `traced art imported directly: ${importers.join(", ")}`);
});
