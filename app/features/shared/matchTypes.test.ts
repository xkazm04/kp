// Provenance badge mapping: an unrecognized pipeline slug must not paint as
// academic (the lowest-trust *named* bucket, still a claim about evidence).
//
// Runner: node:test with type stripping. `npm run test:unit app/features/shared/matchTypes.test.ts`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBandCompact, provLabel } from "./matchTypes.ts";

test("provLabel keeps observed on its own high-trust stamp", () => {
  const pl = provLabel("observed");
  assert.equal(pl.key, "observed");
  assert.match(pl.tone, /moss/);
});

test("provLabel maps academic only when the slug is academic", () => {
  assert.equal(provLabel("academic").key, "academic");
});

test("provLabel does not label an unknown slug as academic", () => {
  const pl = provLabel("nope");
  assert.notEqual(pl.key, "academic");
  assert.equal(pl.key, "unknown");
});

test("formatBandCompact localizes the compact unit when the caller passes one", () => {
  const localized = formatBandCompact([45000, 60000], "en", "tis.");
  assert.match(localized, /tis\./);
  assert.doesNotMatch(localized, /k /, "a caller-supplied unit must not leave a stray ASCII k");
  assert.equal(formatBandCompact([45000, 60000], "en"), formatBandCompact([45000, 60000], "en", "k"));
});
