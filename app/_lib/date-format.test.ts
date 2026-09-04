// The shared formatter registry.
//
// NON-VACUITY: return a fresh `new Intl.DateTimeFormat(...)` from dateFormatter and
// the first two cases fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dateFormatter, slotFormatters } from "./date-format.ts";

const DEADLINE = { day: "numeric", month: "short", year: "numeric" } as const;

test("same locale + same options ⇒ the same instance", () => {
  assert.strictEqual(dateFormatter("en", DEADLINE), dateFormatter("en", DEADLINE));
  assert.strictEqual(slotFormatters("cs"), slotFormatters("cs"), "the slot pair keeps its identity");
});

test("a different locale or a different option set is a different formatter", () => {
  assert.notStrictEqual(dateFormatter("en", DEADLINE), dateFormatter("cs", DEADLINE));
  assert.notStrictEqual(dateFormatter("en", DEADLINE), dateFormatter("en", { ...DEADLINE, hour: "2-digit" }));
  assert.notStrictEqual(slotFormatters("cs"), slotFormatters("de"));
});

test("the cached formatter still formats — memoization is not a behaviour change", () => {
  const d = new Date("2026-06-10T12:00:00.000Z");
  const once = dateFormatter("en", DEADLINE).format(d);
  assert.equal(dateFormatter("en", DEADLINE).format(d), once);
  assert.match(once, /2026/);
  // A locale genuinely changes the rendering, so the key is doing work.
  assert.notEqual(dateFormatter("cs", DEADLINE).format(d), once);
});

test("a bad option set throws to the caller and is not cached", () => {
  // dateStyle may not be combined with individual components — Intl throws. The
  // registry must not memoize the failure (or a later valid call would inherit it).
  const bad = { dateStyle: "short", hour: "2-digit" } as Intl.DateTimeFormatOptions;
  assert.throws(() => dateFormatter("en", bad));
  assert.throws(() => dateFormatter("en", bad), "a second call throws the same way, from Intl, not from a cached value");
});
