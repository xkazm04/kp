// The out-of-request translator's CACHE and its has() contract.
//
// Every artifact written for someone who is not holding the browser — a candidate
// letter, a published posting, an interview-prep pack — is rendered through
// `namespaceTranslator(locale, namespace)`. Its cache is a module-level Map, and
// its key was once the locale alone: `comms` in `en` and `jobs.posting.doc` in
// `en` evicted each other, so whichever namespace asked second got the FIRST one's
// translator and every key resolved to the raw key string. That is a silent
// corruption of the one thing these modules exist to produce, and nothing tested it.
//
// NON-VACUITY: key the cache on locale alone and `namespaces do not evict each
// other` fails; drop the `has` narrowing and the has() cases fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { namespaceTranslator } from "./catalog-translator.ts";

test("the same locale+namespace is the same translator, memoized", async () => {
  const a = await namespaceTranslator("en", "comms");
  const b = await namespaceTranslator("en", "comms");
  assert.strictEqual(a, b, "a second ask must not rebuild the translator");
});

test("a different locale is a different translator, and says a different thing", async () => {
  const en = await namespaceTranslator("en", "comms");
  const cs = await namespaceTranslator("cs", "comms");
  assert.notStrictEqual(en, cs);
  assert.equal(en("team"), "The hiring team");
  assert.notEqual(cs("team"), en("team"), "the cs catalog is not the en one");
});

test("namespaces do not evict each other inside one locale", async () => {
  const comms = await namespaceTranslator("en", "comms");
  const relay = await namespaceTranslator("en", "channels.relay");
  assert.notStrictEqual(comms, relay);
  // Interleave: the SECOND namespace must not have overwritten the first's entry.
  assert.equal(relay("title"), "Delivery relay");
  assert.equal(comms("team"), "The hiring team");
  assert.strictEqual(await namespaceTranslator("en", "comms"), comms, "…and the first is still cached");
  // A key that belongs to the OTHER namespace is not reachable from this one.
  assert.equal(comms.has("title"), false, "namespace scoping is real, not decorative");
});

test("the root translator (no namespace) is its own cache entry", async () => {
  const root = await namespaceTranslator("en");
  assert.notStrictEqual(root, await namespaceTranslator("en", "comms"));
  assert.strictEqual(root, await namespaceTranslator("en"));
  assert.equal(root.has("comms.team"), true, "the root sees dotted paths");
});

test("has() is the fallback idiom's guard: true for a present key, false for an absent one", async () => {
  const t = await namespaceTranslator("en", "comms");
  assert.equal(t.has("team"), true);
  assert.equal(t.has("no.such.key.here"), false);
  // The whole point: `has` false ⇒ the caller substitutes its own label instead of
  // rendering the key string at a candidate.
  assert.equal(t.has("theRole"), true);
});
