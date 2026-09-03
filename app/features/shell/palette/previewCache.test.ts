import { test } from "node:test";
import assert from "node:assert/strict";
import type { PalettePreview } from "@/app/_lib/palette-preview/types.ts";
import {
  clearPreviewCache,
  currentPreviewScope,
  previewFromResponse,
  previewStateFor,
  PREVIEW_TTL_MS,
  primePreviewScope,
  readPreview,
  resetPreviewScopeForTests,
  scopedKey,
  writePreview,
} from "./previewCache.ts";

// /perfect wave 17 (shell-nav): the palette preview memo was keyed on the QUERY
// alone, so within one document the same `tab=pipeline` key could re-show the
// PREVIOUS workspace's counts for the whole 30 s TTL after an in-place team
// switch. These pin the tenant in the key, the TTL boundary, and the three ways
// a response resolves to "error".

const preview = (active: number): PalettePreview => ({
  view: "pipeline",
  active,
  aging: 0,
  stages: [],
  hired: 0,
});

const T0 = 1_700_000_000_000;

test("a cached preview is never visible to another workspace", () => {
  resetPreviewScopeForTests();
  writePreview("team-alpha", "tab=pipeline", preview(12), T0);
  assert.equal(readPreview("team-alpha", "tab=pipeline", T0)?.view, "pipeline");
  assert.equal(
    readPreview("team-beta", "tab=pipeline", T0),
    null,
    "the same query in another tenant must MISS, not inherit alpha's counts"
  );
  // …and beta's own entry does not overwrite alpha's.
  writePreview("team-beta", "tab=pipeline", preview(3), T0);
  assert.equal((readPreview("team-alpha", "tab=pipeline", T0) as { active: number }).active, 12);
  assert.equal((readPreview("team-beta", "tab=pipeline", T0) as { active: number }).active, 3);
});

test("the TTL boundary is exclusive of the entry's own age", () => {
  resetPreviewScopeForTests();
  writePreview("w", "tab=jobs", preview(1), T0);
  assert.ok(readPreview("w", "tab=jobs", T0 + PREVIEW_TTL_MS - 1), "still fresh one ms short of the TTL");
  assert.equal(readPreview("w", "tab=jobs", T0 + PREVIEW_TTL_MS), null, "expired exactly at the TTL");
  // The expired entry is evicted, not merely hidden — a later clock cannot revive it.
  assert.equal(readPreview("w", "tab=jobs", T0 + 1), null);
});

test("an unresolved tenant caches nothing rather than filing under 'unknown'", () => {
  resetPreviewScopeForTests();
  writePreview(null, "tab=pipeline", preview(9), T0);
  assert.equal(readPreview(null, "tab=pipeline", T0), null);
  assert.equal(readPreview("w", "tab=pipeline", T0), null, "a null-scope write must not become any tenant's entry");
});

test("changing the resolved tenant empties the cache", () => {
  resetPreviewScopeForTests();
  primePreviewScope("team-alpha");
  assert.equal(currentPreviewScope(), "team-alpha");
  writePreview("team-alpha", "tab=pipeline", preview(12), T0);
  primePreviewScope("team-beta");
  assert.equal(currentPreviewScope(), "team-beta");
  assert.equal(readPreview("team-alpha", "tab=pipeline", T0), null, "alpha's entries must not survive the switch");
  // Re-priming the SAME tenant is a no-op, so an idempotent prime cannot cost a cache.
  writePreview("team-beta", "tab=pipeline", preview(3), T0);
  primePreviewScope("team-beta");
  assert.ok(readPreview("team-beta", "tab=pipeline", T0));
});

test("scopedKey cannot collide across the workspace/query split", () => {
  assert.notEqual(scopedKey("a", "b=c"), scopedKey("a\u0000b", "=c"));
  assert.equal(scopedKey("w", "tab=jobs"), scopedKey("w", "tab=jobs"));
});

test("every failure shape resolves to error, not to a half-empty preview", () => {
  assert.equal(previewFromResponse(false, { preview: preview(1) }), "error", "a non-2xx is an error even with a body");
  assert.equal(previewFromResponse(true, null), "error", "unparseable JSON");
  assert.equal(previewFromResponse(true, {}), "error", "200 with no preview field");
  assert.equal(previewFromResponse(true, { preview: null }), "error");
  assert.equal(previewFromResponse(true, { preview: "pipeline" }), "error", "a non-object preview");
  assert.deepEqual(previewFromResponse(true, { preview: preview(4) }), preview(4));
});

test("the render state machine maps results to exactly one status", () => {
  assert.deepEqual(previewStateFor(null, {}), { status: "idle" });
  assert.deepEqual(previewStateFor(null, { "tab=jobs": "error" }), { status: "idle" }, "no key wins over any result");
  assert.deepEqual(previewStateFor("tab=jobs", {}), { status: "loading" });
  assert.deepEqual(previewStateFor("tab=jobs", { "tab=other": "error" }), { status: "loading" });
  assert.deepEqual(previewStateFor("tab=jobs", { "tab=jobs": "error" }), { status: "error" });
  assert.deepEqual(previewStateFor("tab=jobs", { "tab=jobs": preview(2) }), { status: "ready", preview: preview(2) });
});

test("clearPreviewCache drops entries for every tenant", () => {
  resetPreviewScopeForTests();
  writePreview("a", "tab=jobs", preview(1), T0);
  writePreview("b", "tab=jobs", preview(2), T0);
  clearPreviewCache();
  assert.equal(readPreview("a", "tab=jobs", T0), null);
  assert.equal(readPreview("b", "tab=jobs", T0), null);
});
