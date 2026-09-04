// Source-guard: every `<MotionizedGlyph>` sizes itself from GLYPH_SIZE.
//
// Before the vocabulary existed the 14 render sites had hand-typed five
// different sizes between them with no rule about which surface got which. A
// constant nobody is required to use would have become a sixth option rather
// than the one seam, which is why this reads the call sites instead of only
// testing the record.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GLYPH_SIZE, GLYPH_SIZE_SM, type GlyphSize } from "./glyphSizes.ts";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const SKIP_DIRS = new Set(["node_modules", ".next", ".git"]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Each `<MotionizedGlyph … />` element's own text, one entry per render site. */
function elements(text: string): string[] {
  const found: string[] = [];
  let at = text.indexOf("<MotionizedGlyph");
  while (at !== -1) {
    const end = text.indexOf("/>", at);
    if (end === -1) break;
    found.push(text.slice(at, end + 2));
    at = text.indexOf("<MotionizedGlyph", end);
  }
  return found;
}

// The renderer's own file declares the component; only consumers instantiate it.
const sites = sourceFiles(join(REPO_ROOT, "app")).flatMap((path) =>
  elements(readFileSync(path, "utf8")).map((el, i) => ({ path, i, el })),
);

test("self-check: the scan found the render sites it reasons over", () => {
  assert.ok(sites.length >= 12, `expected the MotionizedGlyph render sites, found ${sites.length}`);
});

test("the vocabulary is four square steps and their sm: mirrors", () => {
  for (const [name, cls] of Object.entries(GLYPH_SIZE)) {
    const m = /^h-(\d+) w-(\d+)$/.exec(cls);
    assert.ok(m, `GLYPH_SIZE.${name} = ${JSON.stringify(cls)} is not an "h-N w-N" pair`);
    assert.equal(m[1], m[2], `GLYPH_SIZE.${name} is not square — a traced glyph would letterbox`);
    assert.equal(GLYPH_SIZE_SM[name as GlyphSize], `sm:h-${m[1]} sm:w-${m[2]}`);
  }
  // Strictly ascending, so `lg` is always bigger than `md` wherever they are compared.
  const px = Object.values(GLYPH_SIZE).map((c) => Number(/^h-(\d+)/.exec(c)![1]));
  assert.deepEqual(px, [...px].sort((a, b) => a - b));
  assert.equal(new Set(px).size, px.length, "two steps are the same size");
});

test("no render site hand-types a glyph size", () => {
  const offenders = sites
    .filter(({ el }) => /(?:^|\s|")(?:sm:|md:|lg:)?h-\d+ (?:sm:|md:|lg:)?w-\d+/.test(el))
    .map(({ path, i }) => `${path.slice(REPO_ROOT.length + 1)}[${i}]`);
  assert.deepEqual(
    offenders,
    [],
    `MotionizedGlyph render site(s) with a literal size: ${offenders.join(", ")}. ` +
      "Use GLYPH_SIZE (and GLYPH_SIZE_SM for a breakpoint step-up) — five ad-hoc sizes " +
      "across 14 sites is what the vocabulary replaced.",
  );
});
