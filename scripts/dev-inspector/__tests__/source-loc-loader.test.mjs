// Fixtures for scripts/dev-inspector/source-loc-loader.cjs — the Turbopack
// loader next.config.ts points at. It re-checks DEV_INSPECT so a mis-wired
// turbopack.rules cannot stamp production, skips node_modules / image-metadata
// routes, and only then calls Babel.
//
// Run: npm run test:docs
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { shouldTransform } = require("../source-loc-loader.cjs");

const ON = { DEV_INSPECT: "1" };

test("flag off is a no-op even on app TSX", () => {
  assert.equal(shouldTransform("app/x.tsx", {}), false);
  assert.equal(shouldTransform("app/x.tsx", { DEV_INSPECT: "0" }), false);
});

test("node_modules is skipped even with the flag on", () => {
  assert.equal(shouldTransform("app/node_modules/foo/Bar.tsx", ON), false);
});

test("opengraph-image.tsx is skipped (satori, not the DOM)", () => {
  assert.equal(shouldTransform("app/opengraph-image.tsx", ON), false);
  assert.equal(shouldTransform("app/icon.tsx", ON), false);
});

test("app TSX with the flag on is transformed", () => {
  assert.equal(shouldTransform("app/x.tsx", ON), true);
});
