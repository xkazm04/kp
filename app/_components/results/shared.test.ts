/*
 * The report's shared list/panel helpers — the rules, and the source that has
 * to keep obeying them.
 *
 * `shared.tsx` carries four decisions that read as decoration and are not: the
 * dedupe every LLM-filled list is routed through, the mount latch that makes
 * `<LazyDetails>` worth having, the [lo, hi] guard on the deterministic salary
 * anchor, and the two caps on machine-emitted lists. None of them had a test.
 *
 * Two halves, on purpose. The rules live in `sharedLogic.ts` and are exercised
 * directly. The wiring — that the components actually CALL them, and that the
 * engine panel marks its machine prose — is read off the source, because there
 * is no renderer in this suite and a helper nobody calls passes every unit test
 * it has.
 *
 *   npm run test:unit
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  GROUNDING_SOURCES_CAP,
  PARSING_NOTES_CAP,
  bulletItems,
  cappedDistinct,
  isAnchorBand,
  latchOpen,
} from "./sharedLogic.ts";

const src = readFileSync(fileURLToPath(new URL("./shared.tsx", import.meta.url)), "utf8");

test("self-check: shared.tsx was read", () => {
  assert.ok(src.includes("export function BulletList"), "shared.tsx did not parse as expected");
});

// ---------------------------------------------------------------- BulletList

test("BulletList's items are distinct, in caller order", () => {
  assert.deepEqual(bulletItems(["b", "a", "b", "c", "a"]), ["b", "a", "c"]);
});

test("an all-duplicate list collapses to one item, not to empty", () => {
  // The empty fallback is a vignette + prose; collapsing a real (if repetitive)
  // list into "nothing to show" would be a lie about the analysis.
  assert.deepEqual(bulletItems(["same", "same", "same"]), ["same"]);
});

test("an empty list stays empty, so the caller's `empty` fallback renders", () => {
  assert.deepEqual(bulletItems([]), []);
});

test("BulletList routes through the helper rather than dedupe-ing inline", () => {
  assert.match(src, /const uniqueItems = bulletItems\(items\)/);
});

// -------------------------------------------------------------- LazyDetails

test("the latch opens on the first expand", () => {
  assert.equal(latchOpen(false, true), true);
});

test("the latch never falls back — a re-collapse keeps the content mounted", () => {
  assert.equal(latchOpen(true, false), true);
});

test("a never-opened, never-expanded details mounts nothing", () => {
  assert.equal(latchOpen(false, false), false);
});

test("LazyDetails drives its latch through the helper", () => {
  assert.match(src, /setHasOpened\(\(prev\) => latchOpen\(prev, isOpen\)\)/);
});

// --------------------------------------------------------------- anchorBand

test("a well-formed [lo, hi] anchor band renders", () => {
  assert.equal(isAnchorBand([40000, 60000]), true);
});

test("a band that is not a pair is refused rather than printing `undefined` as pay", () => {
  assert.equal(isAnchorBand([40000]), false);
  assert.equal(isAnchorBand([40000, 60000, 80000]), false);
  assert.equal(isAnchorBand([]), false);
});

test("a missing band is refused", () => {
  assert.equal(isAnchorBand(undefined), false);
  assert.equal(isAnchorBand(null), false);
});

test("a pair carrying a non-finite figure is refused", () => {
  assert.equal(isAnchorBand([Number.NaN, 60000]), false);
  assert.equal(isAnchorBand([40000, Number.POSITIVE_INFINITY]), false);
});

test("the engine panel guards the band with the helper, not a length check", () => {
  assert.match(src, /\{isAnchorBand\(anchorBand\) \?/);
  assert.doesNotMatch(src, /anchorBand\.length === 2/);
});

// --------------------------------------------------------------------- caps

test("the caps count DISTINCT entries — three copies of one note do not fill the allowance", () => {
  assert.deepEqual(cappedDistinct(["a", "a", "a", "b", "c", "d"], PARSING_NOTES_CAP), ["a", "b", "c"]);
});

test("a cap truncates from the front, keeping the engine's own ordering", () => {
  assert.deepEqual(cappedDistinct(["a", "b", "c", "d", "e", "f", "g"], GROUNDING_SOURCES_CAP), ["a", "b", "c", "d", "e"]);
});

test("a missing list is an empty list, never a crash", () => {
  assert.deepEqual(cappedDistinct(undefined, PARSING_NOTES_CAP), []);
  assert.deepEqual(cappedDistinct(null, GROUNDING_SOURCES_CAP), []);
});

test("the caps stay where the panel's copy assumes they are", () => {
  assert.equal(PARSING_NOTES_CAP, 3);
  assert.equal(GROUNDING_SOURCES_CAP, 5);
});

test("the engine panel caps through the helpers, with no bare slice left behind", () => {
  assert.match(src, /cappedDistinct\(analysis\.metadata\.parsingNotes, PARSING_NOTES_CAP\)/);
  assert.match(src, /cappedDistinct\(analysis\.metadata\.groundingSources, GROUNDING_SOURCES_CAP\)/);
  assert.doesNotMatch(src, /\.slice\(0, \d+\)/);
});

// -------------------------------------------------------------- engine note

test("machine prose in the engine panel is marked as machine prose", () => {
  // The quality strip beside this panel has said so since 21a; the engine panel
  // painted the model's own English into cs/de/fr unmarked.
  assert.match(src, /export function EngineNote/, "no shared engine-note label");
  assert.match(src, /<EngineNote \/>/, "the engine panel does not mark its parsing notes");
});

test("the engine note reuses the quality strip's already-localized label", () => {
  // Same key in all four catalogs, one component — the two surfaces cannot drift
  // into saying the same thing two ways.
  assert.match(src, /useTranslations\("results\.quality"\)/);
  assert.match(src, /t\("engineNote"\)/);
  assert.match(src, /title=\{t\("engineNoteTitle"\)\}/);
});
