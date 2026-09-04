import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { copyDefaults } from "../../scripts/i18n/primitive-copy-defaults.mjs";

// Fixtures for the i18n gate's third shared-primitive rule (see the module header).
// They live HERE, beside the primitives the rule is about, rather than under
// `scripts/i18n/__tests__`: `npm run test:unit` already globs `app/**/*.test.ts`, so
// the fixtures run in a gate that exists instead of needing a new package.json alias
// (and a new row in the CI table) to be reached at all.

const HERE = path.dirname(fileURLToPath(import.meta.url));

test("a sentence-cased prop default is copy three locales would read in English", () => {
  const found = copyDefaults(`export function Select({\n  placeholder = "Select…",\n  clearLabel = "Clear",\n})`);
  assert.deepEqual(
    found.map((f) => `${f.prop}=${f.value}`),
    ["placeholder=Select…", "clearLabel=Clear"]
  );
});

test("variant tokens, lengths and class strings are NOT copy", () => {
  // Every non-copy default that exists in app/_components today, verbatim.
  const src = [
    'export function X({',
    '  className = "",',
    '  className = "h-40 w-40",',
    '  itemClassName = "text-base leading-6 text-ink",',
    '  tone = "weak",',
    '  variant = "banner",',
    '  size = "2xl",',
    '  placement = "center",',
    '  anchor = "middle",',
    '  scale = "fit",',
    '  density = "roomy",',
    '  minHeight = "10rem",',
    '  entrance = "staggered-draw",',
    '  mode = "select",',
    '  trigger = "title",',
    '  align = "left",',
    '  strategy = "idle",',
    '})',
  ].join("\n");
  assert.deepEqual(copyDefaults(src), []);
});

test("SVG path data is not copy — an uppercase path command is not a word", () => {
  const src = [
    'export function JobFitIcon({',
    '  d = "M10 12a5 5 0 0 1 1.66-3.74L14 12l-2.34 3.74A5 5 0 0 1 10 12Z",',
    '  d = "M18 54 Q22 38 38 36 Q40 48 32 58 Q24 60 18 54 Z",',
    '})',
  ].join("\n");
  assert.deepEqual(copyDefaults(src), []);
});

test("a declaration is not a parameter default", () => {
  assert.deepEqual(copyDefaults('  const FALLBACK = "Select…";\n  let label = "Clear"\n'), []);
});

test("the shipped shared primitives carry no English copy defaults", () => {
  // The gate itself runs this over app/_components in scripts/i18n-check.mjs; this
  // asserts the same tree so a regression is red in the unit suite too.
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (entry.endsWith(".tsx") && !entry.includes(".test.")) out.push(full);
    }
    return out;
  };
  const offenders: string[] = [];
  for (const file of walk(HERE)) {
    for (const f of copyDefaults(readFileSync(file, "utf8"))) {
      offenders.push(`${path.relative(HERE, file).split(path.sep).join("/")}:${f.line} ${f.prop} = "${f.value}"`);
    }
  }
  assert.deepEqual(offenders, []);
});
