// Fixtures for scripts/dev-inspector/inject-source-loc.cjs — the Babel plugin that
// stamps HOST JSX with `data-loc="<relPath>:LINE:COL"` for the in-app DevInspector.
//
// parseLoc (app/_dev-inspector/devLocate.ts) splits that attribute. A regression
// that stamps <Button> (components do not forward the prop) or double-stamps a
// node would copy the wrong file all day with a green suite. These four cases
// are the stamp contract.
//
// Run: npm run test:docs
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { transformSync } from "@babel/core";

const require = createRequire(import.meta.url);
const injectSourceLoc = require("../inject-source-loc.cjs");

function transform(source, pluginOpts) {
  const result = transformSync(source, {
    filename: "app/x.tsx",
    configFile: false,
    babelrc: false,
    parserOpts: { plugins: ["jsx", "typescript"] },
    plugins: pluginOpts === undefined ? [] : [[injectSourceLoc, pluginOpts]],
    retainLines: true,
  });
  return result?.code ?? "";
}

function stamp(source, relPath = "app/x.tsx") {
  return transform(source, { relPath });
}

test("a host element is stamped with path:line:col (1-indexed column)", () => {
  const out = stamp("<div/>");
  assert.match(out, /data-loc="app\/x\.tsx:1:1"/);
});

test("a component element is not stamped", () => {
  const out = stamp("<Foo/>");
  assert.doesNotMatch(out, /data-loc/);
  assert.match(out, /<Foo\s*\/>/);
});

test("a second pass is idempotent: already-stamped nodes stay single-stamped", () => {
  const once = stamp("<div/>");
  const twice = stamp(once);
  assert.equal((once.match(/data-loc=/g) ?? []).length, 1);
  assert.equal(twice, once);
});

test("missing relPath is a no-op against the plugin-off reprint", () => {
  const source = "<div/>";
  const noRel = transform(source, {});
  const off = transform(source);
  assert.equal(noRel, off);
  assert.doesNotMatch(noRel, /data-loc/);
});
