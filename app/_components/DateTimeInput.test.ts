// DateTimeInput is the only datetime-local control, and it composes TextInput's
// invalid contract (aria-invalid + red border) rather than a third class string.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "..");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(path.join(dir, entry.name), out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.")) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

test("DateTimeInput locks type=datetime-local and omits it from rest", () => {
  const src = readFileSync(path.join(HERE, "DateTimeInput.tsx"), "utf8");
  assert.match(src, /Omit<TextInputProps, "type">/);
  assert.match(src, /<TextInput ref=\{ref\} \{\.\.\.props\} type="datetime-local" \/>/);
});

test("DateTimeInput does not reimplement invalid; TextInput owns aria-invalid + red border", () => {
  const wrapper = readFileSync(path.join(HERE, "DateTimeInput.tsx"), "utf8");
  const field = readFileSync(path.join(HERE, "TextInput.tsx"), "utf8");
  assert.doesNotMatch(wrapper, /aria-invalid/);
  assert.doesNotMatch(wrapper, /border-red-400/);
  assert.match(field, /<input[^>]*aria-invalid=\{invalid \|\| undefined\}/);
  assert.match(field, /const border = invalid \? "border-red-400"/);
});

test("type=datetime-local lives only in DateTimeInput.tsx", () => {
  const offenders: string[] = [];
  for (const file of walk(APP_DIR)) {
    if (path.basename(file) === "DateTimeInput.tsx") continue;
    const src = stripComments(readFileSync(file, "utf8"));
    if (/type\s*=\s*["']datetime-local["']/.test(src)) {
      offenders.push(path.relative(APP_DIR, file).split(path.sep).join("/"));
    }
  }
  assert.deepEqual(offenders, [], `raw datetime-local outside DateTimeInput.tsx: ${offenders.join(", ")}`);
});
