// The glyph registry is a closed vocabulary of ids, not a table of art.
//
// It used to import ten traced modules (8-36 KB of emitted path data each) and hand
// them out by tab, so ChainEmptyState — and through it every tab that renders one —
// dragged all of that art onto the workspace page's import graph. The art now lives
// behind GET /api/glyphs/[id] (glyphCatalog.ts, server-only) and the registry holds
// only names. These cases pin both halves: the vocabulary matches the traced modules
// on disk one for one, and the registry itself imports none of them.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ARCHETYPE_VIEW_GLYPHS, GLYPH_BY_TAB, GLYPH_IDS, glyphForTab, isGlyphId } from "./glyphRegistry.ts";

const GLYPHS_DIR = fileURLToPath(new URL("./glyphs/", import.meta.url));
const REGISTRY_SRC = readFileSync(fileURLToPath(new URL("./glyphRegistry.ts", import.meta.url)), "utf8");

/** Traced module stems on disk: `jobsGlyph.ts` -> `jobs`. */
const moduleIds = readdirSync(GLYPHS_DIR)
  .filter((f) => /Glyph\.ts$/.test(f) && !f.includes(".test."))
  .map((f) => f.replace(/Glyph\.ts$/, ""))
  .sort();

test("GLYPH_IDS is one literal entry per traced module file, set-equal to the directory", () => {
  assert.equal(GLYPH_IDS.length, 13);
  assert.equal(new Set(GLYPH_IDS).size, GLYPH_IDS.length, "GLYPH_IDS repeats an id");
  assert.deepEqual([...GLYPH_IDS].sort(), moduleIds);
});

test("isGlyphId accepts a real id and rejects prototype keys and strangers", () => {
  assert.equal(isGlyphId("decisions"), true);
  assert.equal(isGlyphId("channelComms"), true);
  assert.equal(isGlyphId("constructor"), false);
  assert.equal(isGlyphId("toString"), false);
  assert.equal(isGlyphId("nope"), false);
  assert.equal(isGlyphId(""), false);
  assert.equal(isGlyphId(42), false);
  assert.equal(isGlyphId(undefined), false);
});

test("glyphForTab returns an id string and undefined for an unmapped or unknown tab", () => {
  assert.equal(glyphForTab("jobs"), "jobs");
  assert.equal(typeof glyphForTab("jobs"), "string");
  assert.equal(glyphForTab("channels"), "channelComms");
  assert.equal(glyphForTab("pipeline"), undefined);
  assert.equal(glyphForTab("no-such-tab"), undefined);
  assert.equal(glyphForTab("constructor"), undefined);
});

test("every registry value is a GlyphId, and every non-channel id is reachable from a tab or view", () => {
  const values = [...Object.values(GLYPH_BY_TAB), ...Object.values(ARCHETYPE_VIEW_GLYPHS)];
  for (const v of values) assert.ok(isGlyphId(v), `${v} is not a GlyphId`);
  const reached = new Set<string>(values);
  const missing = GLYPH_IDS.filter((id) => !id.startsWith("channel") && !reached.has(id));
  assert.deepEqual(missing, [], `traced glyph(s) no tab or view maps: ${missing.join(", ")}`);
});

test("archetypes matrix projection is keyed separately from the tab default", () => {
  assert.equal(GLYPH_BY_TAB.archetypes, ARCHETYPE_VIEW_GLYPHS.list);
  assert.equal(ARCHETYPE_VIEW_GLYPHS.matrix, "profileMatrix");
  assert.notEqual(ARCHETYPE_VIEW_GLYPHS.matrix, GLYPH_BY_TAB.matrix);
});

test("the registry imports no traced art — only names (value imports would put the art back on the page graph)", () => {
  const code = REGISTRY_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(code, /from\s*["'][^"']*\/glyphs\//, "glyphRegistry.ts imports a traced module");
  assert.doesNotMatch(code, /import\s*\(/, "glyphRegistry.ts dynamically imports a module");
  assert.doesNotMatch(code, /from\s*["'][^"']*glyphCatalog["']/, "glyphRegistry.ts imports the server catalog");
});
