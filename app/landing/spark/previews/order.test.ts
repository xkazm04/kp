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
 * The component half (app/landing/site/land/features/FeatureRing.tsx reads and
 * writes the hash, its scene renders the stepper) cannot be imported here - the runner has no JSX
 * transform - so its browser journey is owed to e2e/landing.spec.ts
 * ("a spotlight is addressable and walkable"). Everything that decides WHICH
 * preview, WHICH hash and WHICH url lives in ./order.ts and is pinned below.
 */

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("PREVIEW_KEYS is the funnel order, and the features ring and the registry derive from it", () => {
  assert.deepEqual(
    [...PREVIEW_KEYS],
    ["inbox", "score", "rediscover", "voice", "cases", "schedule", "salary", "offer", "gates"]
  );
  // The landing's features band (app/landing/site/land/features): the ring, the
  // scene's stepper and its dots all map over FEATURES, which is PREVIEW_KEYS.
  const SITE = join(process.cwd(), "app", "landing", "site", "land", "features");
  const data = stripComments(readFileSync(join(SITE, "featureData.ts"), "utf8"));
  assert.match(data, /FEATURES[^=]*=\s*PREVIEW_KEYS\.map\(/, "featureData.ts builds FEATURES from PREVIEW_KEYS");
  assert.doesNotMatch(data, /key:\s*"(score|voice|cases|schedule|inbox|salary|rediscover|offer|gates)"/, "featureData.ts re-lists no key");
  const ring = stripComments(readFileSync(join(SITE, "FeatureRing.tsx"), "utf8"));
  assert.match(ring, /FEATURES\.map\(/, "the ring draws its medallions from FEATURES");
  // The per-key registries (the old previews/index.ts, retired 2026-09-30, is now
  // featureData's palette and art.tsx's drawings) are keyed by the DERIVED union,
  // never a re-typed one: a tenth key then fails tsc until every registry has it.
  assert.match(data, /export type FeatureKey = PreviewKey;/, "FeatureKey is the PreviewKey union, not a copy");
  assert.match(data, /PALETTE: Record<FeatureKey,/, "every feature has a palette, by the union");
  const art = stripComments(readFileSync(join(SITE, "art.tsx"), "utf8"));
  assert.match(art, /ART: Record<FeatureKey,/, "every feature has its medallion art, by the union");
  for (const src of [data, art, ring]) {
    assert.doesNotMatch(src, /type \w+\s*=\s*\|?\s*"(inbox|score)"\s*\|/, "no hand-typed copy of the key union");
  }
});

test("stepPreview walks the nine previews and wraps at both ends", () => {
  assert.equal(stepPreview("gates", 1), "inbox");
  assert.equal(stepPreview("inbox", -1), "gates");
  assert.equal(stepPreview("voice", 1), "cases");
  assert.equal(stepPreview("cases", 1), "schedule");
  // A full lap in either direction returns home.
  let k: (typeof PREVIEW_KEYS)[number] = "offer";
  for (let i = 0; i < PREVIEW_KEYS.length; i += 1) k = stepPreview(k, -1);
  assert.equal(k, "offer");
});

test("previewPosition is 1-based over the funnel", () => {
  assert.deepEqual(previewPosition("cases"), { n: 5, total: 9 });
  assert.deepEqual(previewPosition("gates"), { n: 9, total: 9 });
  assert.deepEqual(previewPosition("inbox"), { n: 1, total: 9 });
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

test("the walk's copy exists in all four catalogs and carries its arguments", () => {
  // What the scene's walk actually renders (since 2026-09-30; the old spotlight's
  // landing.previews.prev|next|position are no longer read): the arrow buttons'
  // names (siteChrome.stepper.previousTo|nextTo, "Previous: {name}"), the count
  // line (siteFeatures.scene.count, "<b>{n}</b> of {total}") and each dot's name
  // (siteFeatures.scene.dot). An argument lost in one translation renders the raw
  // placeholder, or throws, in that language only.
  for (const locale of ["en", "cs", "de", "fr"]) {
    const m = JSON.parse(readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf8"));
    const walk: [string, string | undefined, string[]][] = [
      ["siteChrome.stepper.previousTo", m.siteChrome?.stepper?.previousTo, ["{name}"]],
      ["siteChrome.stepper.nextTo", m.siteChrome?.stepper?.nextTo, ["{name}"]],
      ["siteFeatures.scene.count", m.siteFeatures?.scene?.count, ["{n}", "{total}", "<b>", "</b>"]],
      ["siteFeatures.scene.dot", m.siteFeatures?.scene?.dot, ["{name}", "{n}", "{total}"]]
    ];
    for (const [key, value, args] of walk) {
      assert.equal(typeof value, "string", `${locale} ${key}`);
      for (const arg of args) assert.ok(value!.includes(arg), `${locale} ${key} carries ${arg}`);
    }
  }
});
