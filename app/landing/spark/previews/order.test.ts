import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PREVIEW_KEYS,
  arrowStep,
  hashAfterClose,
  isPreviewKey,
  parseSpotlightHash,
  previewPosition,
  spotlightHash,
  stepPreview,
  urlWithHash
} from "./order";

/*
 * The spotlight walk and its address, pinned as pure logic.
 *
 * The component half (SparkLanding reads/writes the hash, FeatureSpotlight
 * renders prev/next) cannot be imported here - the runner has no JSX
 * transform - so its browser journey is owed to e2e/landing.spec.ts
 * ("a spotlight is addressable and walkable"). Everything that decides WHICH
 * preview, WHICH hash and WHICH url lives in ./order.ts and is pinned below.
 */

const HERE = join(process.cwd(), "app", "landing", "spark");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("PREVIEW_KEYS is the grid order, and the grid and the registry derive from it", () => {
  assert.deepEqual(
    [...PREVIEW_KEYS],
    ["score", "voice", "cases", "schedule", "inbox", "salary", "rediscover", "offer", "gates"]
  );
  const grid = stripComments(readFileSync(join(HERE, "sections", "FeatureGrid.tsx"), "utf8"));
  assert.match(grid, /PREVIEW_KEYS\.map\(/, "FeatureGrid builds its cards from PREVIEW_KEYS");
  assert.doesNotMatch(grid, /preview:\s*"(score|voice|cases|schedule|inbox|salary|rediscover|offer|gates)"/, "FeatureGrid re-lists no preview key");
  const registry = stripComments(readFileSync(join(HERE, "previews", "index.ts"), "utf8"));
  assert.doesNotMatch(registry, /type PreviewKey\s*=\s*\|/, "previews/index.ts no longer hand-types the union");
});

test("stepPreview walks the nine previews and wraps at both ends", () => {
  assert.equal(stepPreview("gates", 1), "score");
  assert.equal(stepPreview("score", -1), "gates");
  assert.equal(stepPreview("voice", 1), "cases");
  // A full lap in either direction returns home.
  let k: (typeof PREVIEW_KEYS)[number] = "offer";
  for (let i = 0; i < PREVIEW_KEYS.length; i += 1) k = stepPreview(k, -1);
  assert.equal(k, "offer");
});

test("previewPosition is 1-based over the grid", () => {
  assert.deepEqual(previewPosition("cases"), { n: 3, total: 9 });
  assert.deepEqual(previewPosition("gates"), { n: 9, total: 9 });
  assert.deepEqual(previewPosition("score"), { n: 1, total: 9 });
});

test("the spotlight address is #spotlight-<key>, and only a real key parses", () => {
  assert.equal(spotlightHash("offer"), "#spotlight-offer");
  assert.equal(parseSpotlightHash("#spotlight-offer"), "offer");
  for (const k of PREVIEW_KEYS) assert.equal(parseSpotlightHash(spotlightHash(k)), k);
  // Prototype keys, wrong case, band hashes, internal element ids, empty.
  for (const bad of [
    "#spotlight-toString",
    "#spotlight-constructor",
    "#spotlight-__proto__",
    "#spotlight-OFFER",
    "#spotlight-",
    "#features",
    "#feature-offer-title",
    "spotlight-offer",
    ""
  ]) {
    assert.equal(parseSpotlightHash(bad), null, bad);
  }
  assert.equal(isPreviewKey("hasOwnProperty"), false);
});

test("closing restores the hash that was there before, never a dead #spotlight-*", () => {
  assert.equal(hashAfterClose("#features"), "#features");
  assert.equal(hashAfterClose(null), "");
  assert.equal(hashAfterClose(""), "");
  assert.equal(hashAfterClose("#spotlight-voice"), "");
});

test("urlWithHash keeps the path and query, so the canonical address never moves", () => {
  assert.equal(urlWithHash("/", "?lang=cs", "#spotlight-cases"), "/?lang=cs#spotlight-cases");
  assert.equal(urlWithHash("/", "?lang=cs", ""), "/?lang=cs");
  assert.equal(urlWithHash("/", "", ""), "/");
  assert.equal(urlWithHash("/", "", "#features"), "/#features");
});

test("arrowStep: Left/Right step, never with a modifier (Alt+Left is Back) or inside a text field", () => {
  const plain = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
  const button = { tagName: "BUTTON", isContentEditable: false };
  assert.equal(arrowStep({ key: "ArrowRight", ...plain }, button), 1);
  assert.equal(arrowStep({ key: "ArrowLeft", ...plain }, button), -1);
  assert.equal(arrowStep({ key: "ArrowUp", ...plain }, button), null);
  assert.equal(arrowStep({ key: "Tab", ...plain }, button), null);
  assert.equal(arrowStep({ key: "ArrowLeft", ...plain, altKey: true }, button), null);
  assert.equal(arrowStep({ key: "ArrowRight", ...plain, metaKey: true }, button), null);
  assert.equal(arrowStep({ key: "ArrowRight", ...plain, ctrlKey: true }, button), null);
  assert.equal(arrowStep({ key: "ArrowRight", ...plain, shiftKey: true }, button), null);
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
    assert.equal(arrowStep({ key: "ArrowRight", ...plain }, { tagName, isContentEditable: false }), null, tagName);
  }
  assert.equal(arrowStep({ key: "ArrowRight", ...plain }, { tagName: "DIV", isContentEditable: true }), null);
  assert.equal(arrowStep({ key: "ArrowRight", ...plain }, null), 1);
});

test("the nav copy exists in all four catalogs", () => {
  for (const locale of ["en", "cs", "de", "fr"]) {
    const m = JSON.parse(readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf8"));
    const p = m.landing.previews;
    for (const key of ["prev", "next", "position"]) {
      assert.equal(typeof p[key], "string", `${locale} landing.previews.${key}`);
    }
    assert.match(p.position, /\{n\}/, `${locale} position carries {n}`);
    assert.match(p.position, /\{total\}/, `${locale} position carries {total}`);
  }
});
