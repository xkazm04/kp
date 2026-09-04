// The metric pack's CATALOG LOADER — the one thing metric-pack-strings.ts does
// that metric-pack.ts (pure, copy-as-a-parameter) deliberately cannot.
//
// What is pinned here is the LOCALE FALLBACK, which had no test at all. The pack
// is a downloadable artifact with no stored language: it renders in the language
// of the request that asked for it, and `getServerLocale()` upstream can hand this
// function anything — a fat-fingered `?lang`, a stale cookie, null when no locale
// resolved. `isLocale(locale) ? locale : DEFAULT_LOCALE` is the guard that keeps
// that from reaching `import(messages/<locale>.json)`, which would 404 at runtime
// and fail the download instead of degrading to English.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   node scripts/run-unit-tests.mjs app/_lib/metric-pack-strings.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

// The catalogs load through a bare `import("../../messages/<locale>.json")`, which
// under `node --test` needs an import attribute the source (correctly, for the
// bundler) does not carry. Same JSON shim the other catalog-reading unit tests use.
const ROOT = new URL("../../", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier;
    if (spec.startsWith("@/")) spec = new URL(spec.slice(2), ROOT).href;
    else if (
      (spec.startsWith("./") || spec.startsWith("../")) &&
      context.parentURL &&
      !context.parentURL.includes("node_modules")
    ) {
      spec = new URL(spec, context.parentURL).href;
    }
    if (spec.startsWith("file:") && !/\.[a-z0-9]+$/i.test(spec) && fs.existsSync(fileURLToPath(spec + ".ts"))) {
      spec += ".ts";
    }
    return nextResolve(spec, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".json")) {
      const source = "export default " + fs.readFileSync(fileURLToPath(url), "utf8") + ";";
      return { format: "module", source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { metricPackStrings } = await import("./metric-pack-strings.ts");

/** What a locale's catalog actually says, read straight from the file — so this
 *  test asserts the LANGUAGE CHOSEN, not the current wording. */
function catalogTitle(locale: string): string {
  const m = JSON.parse(
    fs.readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8")
  ) as { analytics: { metricPack: { title: string } } };
  return m.analytics.metricPack.title;
}

test("metricPackStrings: a supported locale renders that locale's copy", async () => {
  const cs = await metricPackStrings("cs");
  assert.equal(cs.title, catalogTitle("cs"));
  const de = await metricPackStrings("de");
  assert.equal(de.title, catalogTitle("de"));
  // GUARD: every assertion below rests on the catalogs actually differing.
  assert.notEqual(catalogTitle("cs"), catalogTitle("en"));
});

test("metricPackStrings: an UNSUPPORTED locale falls back to English, never a 404 import", async () => {
  // Each of these is a value getServerLocale() can genuinely produce upstream: an
  // unknown tag, a region-qualified tag we do not carry, a wrong-cased one, junk.
  for (const bad of ["xx", "cs-CZ", "EN", "../../etc/passwd", "", "  "]) {
    const strings = await metricPackStrings(bad);
    assert.equal(strings.title, catalogTitle("en"), `"${bad}" degrades to English`);
  }
});

test("metricPackStrings: null/undefined fall back to English too", async () => {
  // The pack has no stored language field, so "no locale resolved" is a normal
  // state here, not an error — it must download in English, not fail.
  assert.equal((await metricPackStrings(null)).title, catalogTitle("en"));
  assert.equal((await metricPackStrings(undefined)).title, catalogTitle("en"));
});

test("metricPackStrings: the fallback is the WHOLE pack, not just the title", async () => {
  // A partial fallback (one field English, the rest from a half-loaded catalog) is
  // the failure mode worth excluding: the artifact is one document in one language.
  const strings = await metricPackStrings("xx");
  const en = await metricPackStrings("en");
  assert.equal(strings.colMetric, en.colMetric);
  assert.equal(strings.colValue, en.colValue);
  assert.equal(strings.disclaimer, en.disclaimer);
  assert.equal(strings.windowLast(30), en.windowLast(30), "the interpolated strings too");
});
