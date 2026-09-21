import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ARCHETYPE_VIEW_GLYPHS, GLYPH_BY_TAB, glyphForTab } from "./glyphRegistry.ts";
import { JOBS_GLYPH } from "./glyphs/jobsGlyph.ts";

const GLYPHS_DIR = fileURLToPath(new URL("./glyphs/", import.meta.url));
const REGISTRY_SRC = readFileSync(fileURLToPath(new URL("./glyphRegistry.ts", import.meta.url)), "utf8");

function importsModule(text: string, stem: string): boolean {
  return new RegExp(`(?:from|import)\\s*\\(?\\s*["'][^"']*/${stem}(?:\\.tsx?)?["']`).test(text);
}

const modules = readdirSync(GLYPHS_DIR)
  .filter((f) => f.endsWith(".ts") && !f.includes(".test."))
  .map((f) => f.replace(/\.ts$/, ""))
  .sort();

test("glyphForTab returns the mapped glyph and undefined for an unknown tab", () => {
  assert.equal(glyphForTab("jobs"), JOBS_GLYPH);
  assert.equal(glyphForTab("pipeline"), undefined);
  assert.equal(glyphForTab("no-such-tab"), undefined);
});

test("every registry value is one of the traced modules", () => {
  const imports = [...REGISTRY_SRC.matchAll(/from\s*["']\.\/glyphs\/([^"']+)["']/g)].map((m) => m[1]);
  assert.ok(imports.length >= 9, `expected the traced feature glyphs, found ${imports.length}`);
  for (const stem of imports) {
    assert.ok(modules.includes(stem), `registry imports unknown module ${stem}`);
  }
  for (const tab of Object.keys(GLYPH_BY_TAB)) {
    assert.ok(REGISTRY_SRC.includes(`${tab}:`), `${tab} is not a GLYPH_BY_TAB key in source`);
  }
});

test("every traced module except channel-* extras is keyed", () => {
  const required = modules.filter((stem) => !stem.startsWith("channel"));
  const missing = required.filter((stem) => !importsModule(REGISTRY_SRC, stem));
  assert.deepEqual(missing, [], `traced module(s) not keyed in the registry: ${missing.join(", ")}`);
});

test("archetypes matrix projection is keyed separately from the tab default", () => {
  assert.equal(GLYPH_BY_TAB.archetypes, ARCHETYPE_VIEW_GLYPHS.list);
  assert.notEqual(ARCHETYPE_VIEW_GLYPHS.matrix, GLYPH_BY_TAB.matrix);
  assert.ok(importsModule(REGISTRY_SRC, "profileMatrixGlyph"));
});
