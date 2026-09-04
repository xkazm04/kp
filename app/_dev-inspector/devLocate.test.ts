// The DevInspector's pure helpers. They had no test, which is how a devtool ends
// up quietly copying the wrong path: `parseLoc` splits an attribute the Turbopack
// `inject-source-loc` pass writes (`data-loc="app/x/File.tsx:88:7"`), and
// `pickDefaultIndex` encodes the single decision the whole tool exists to make —
// right-click copies the CALL SITE (the feature file that used a shared component),
// not the shared component itself. Get that wrong and the inspector confidently
// hands a developer the path to `Button.tsx` fifty times a day.
//
// Pure functions only: no DOM, so `buildChain` (which walks `closest()`) is not
// covered here — its inputs are what these three then judge.
//
// Runner: node:test with type stripping. `npm run test:unit app/_dev-inspector/devLocate.test.ts`.
import { test } from "node:test";
import assert from "node:assert/strict";

import { dedupeChain, isLibraryPath, parseLoc, pickDefaultIndex, type LocEntry } from "./devLocate.ts";

/** A chain entry without the DOM element the pure helpers never read. */
function entry(loc: string): LocEntry {
  const parsed = parseLoc(`${loc}:1:1`);
  assert.ok(parsed, `fixture ${loc} must parse`);
  return { el: null as unknown as Element, ...parsed };
}

// --- parseLoc ----------------------------------------------------------------

test("parseLoc splits path, line and column and drops the column from `loc`", () => {
  assert.deepEqual(parseLoc("app/features/hiring/PipelineTab.tsx:88:7"), {
    raw: "app/features/hiring/PipelineTab.tsx:88:7",
    path: "app/features/hiring/PipelineTab.tsx",
    line: 88,
    // The copied reference is `path:line` — what a `File.tsx:88` paste into Claude
    // Code resolves. The column is parsed only to be discarded.
    loc: "app/features/hiring/PipelineTab.tsx:88",
  });
});

test("parseLoc keeps a WINDOWS-ish path with a drive letter intact", () => {
  // The greedy `(.*)` before the two numeric groups exists for exactly this: a
  // path can contain colons, and only the LAST two are the position.
  const parsed = parseLoc("C:/repo/app/x/File.tsx:12:3");
  assert.equal(parsed?.path, "C:/repo/app/x/File.tsx");
  assert.equal(parsed?.line, 12);
  assert.equal(parsed?.loc, "C:/repo/app/x/File.tsx:12");
});

test("parseLoc returns null for anything that is not path:line:col", () => {
  for (const bad of [
    "",
    "File.tsx",
    "File.tsx:88", // a position needs BOTH numbers — this is a `loc`, not a `raw`
    "File.tsx:88:", // trailing separator, no column
    ":88:7", // no path
    "File.tsx:ab:7", // non-numeric line
    "File.tsx:88:7:9extra",
  ]) {
    assert.equal(parseLoc(bad), null, JSON.stringify(bad));
  }
});

// --- isLibraryPath -----------------------------------------------------------

test("isLibraryPath marks shared internals and leaves feature/page files alone", () => {
  for (const lib of [
    "app/_components/ui/recipes.ts",
    "app/_components/ui/Modal.tsx",
    "packages/voice-stt/src/lib/decode.ts",
    "app/hooks/useThing.ts",
    "i18n/server.ts",
    "app/_dev-inspector/devInspectorUi.tsx",
    "src/shared/Thing.tsx",
    "src/stores/session.ts",
    "src/utils/fmt.ts",
  ]) {
    assert.equal(isLibraryPath(lib), true, lib);
  }
  for (const site of [
    "app/features/hiring/pipeline/PipelineTab.tsx",
    "app/page.tsx",
    "app/landing/spark/PricingSection.tsx",
    // NOT library, and deliberately recorded as such: `app/_components/` is this
    // repo's shared-primitive directory, but only its `ui/` subtree matches a
    // LIBRARY_SEGMENT. So right-clicking a Badge stops at Badge.tsx rather than
    // walking out to the feature that used it. That is today's behaviour, pinned
    // here so a fix is a deliberate edit to LIBRARY_SEGMENTS (add "/_components/")
    // with this line updated, not an accident either way.
    "app/_components/Badge.tsx",
  ]) {
    assert.equal(isLibraryPath(site), false, site);
  }
});

test("isLibraryPath matches a leading segment, not a bare substring", () => {
  // The `/${path}` prefix in the implementation is what makes a top-level `ui/`
  // or `lib/` count. A word that merely CONTAINS a segment name must not.
  assert.equal(isLibraryPath("ui/Button.tsx"), true);
  assert.equal(isLibraryPath("lib/x.ts"), true);
  assert.equal(isLibraryPath("app/features/guides/Guide.tsx"), false);
  assert.equal(isLibraryPath("app/features/build-ui-kit.tsx"), false);
});

// --- pickDefaultIndex --------------------------------------------------------

test("pickDefaultIndex picks the first NON-library file — the call site", () => {
  // The real shape: right-clicking deep inside a shared primitive rendered by a
  // feature tab. Innermost first — the first two are library, so the copy target
  // is the tab that used them.
  const chain = [
    entry("app/_components/ui/recipes.ts"),
    entry("app/_components/ui/Modal.tsx"),
    entry("app/features/hiring/pipeline/PipelineTab.tsx"),
    entry("app/page.tsx"),
  ];
  assert.equal(pickDefaultIndex(chain), 2);
});

test("pickDefaultIndex falls back to the innermost element when the chain is ALL library", () => {
  const chain = [entry("app/_components/Badge.tsx"), entry("app/_components/ui/recipes.ts")];
  assert.equal(pickDefaultIndex(chain), 0);
});

test("pickDefaultIndex returns 0 for an empty chain rather than -1", () => {
  // -1 would index off the end of the crumb list and copy `undefined`. The
  // findIndex fallback is the only thing standing between that and the clipboard.
  assert.equal(pickDefaultIndex([]), 0);
});

test("pickDefaultIndex takes the innermost call site when several are non-library", () => {
  const chain = [
    entry("app/features/hiring/pipeline/PipelineCard.tsx"),
    entry("app/features/hiring/pipeline/PipelineTab.tsx"),
  ];
  assert.equal(pickDefaultIndex(chain), 0);
});

// --- dedupeChain -------------------------------------------------------------

test("dedupeChain collapses CONSECUTIVE duplicates only", () => {
  // Several nested host elements stamped from the same JSX line are one crumb.
  const chain = [entry("a/A.tsx"), entry("a/A.tsx"), entry("b/B.tsx"), entry("a/A.tsx")];
  assert.deepEqual(
    dedupeChain(chain).map((c) => c.loc),
    ["a/A.tsx:1", "b/B.tsx:1", "a/A.tsx:1"],
  );
});

test("dedupeChain compares path:line, so two lines of one file both survive", () => {
  const chain = [
    { el: null as unknown as Element, ...parseLoc("a/A.tsx:10:1")! },
    { el: null as unknown as Element, ...parseLoc("a/A.tsx:11:1")! },
  ];
  assert.equal(dedupeChain(chain).length, 2);
});

test("dedupeChain is a no-op on empty and single-entry chains", () => {
  assert.deepEqual(dedupeChain([]), []);
  assert.equal(dedupeChain([entry("a/A.tsx")]).length, 1);
});
