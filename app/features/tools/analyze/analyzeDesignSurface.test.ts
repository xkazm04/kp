// Source guard: the Analyze surface stays inside the design system.
//
// The tab shipped 21 files with ZERO imports from app/_components/ui/recipes.ts —
// PANEL was re-typed as a literal in four places, and the History header re-typed
// EYEBROW / TITLE_DISPLAY / INTRO. A re-typed recipe is not a style choice, it is
// a copy that stops tracking the original: when PANEL grew its Spark Dark sticker
// treatment, every literal panel kept the light-only card.
//
// There is no render/DOM layer in this repo (see analyzeFileIntakeGate.test.ts for
// the same reasoning), so these read the source. Each assertion names the property
// that would silently regress, not the string.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit -- app/features/tools/analyze/analyzeDesignSurface.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(HERE, rel), "utf8");

// The four surfaces that were literal panels. Each must IMPORT the recipe and USE
// it — an import alone composes nothing.
const PANEL_SURFACES = [
  "AnalyzeForm.tsx",
  "AnalyzeFormCollapsed.tsx",
  "AnalyzeWorkspace.tsx",
  "history/HistoryTab.tsx",
];

test("every panel surface composes PANEL instead of re-typing it", () => {
  for (const rel of PANEL_SURFACES) {
    const src = read(rel);
    assert.match(src, /from "@\/app\/_components\/ui\/recipes"/, `${rel} does not import the recipes`);
    assert.match(src, /\$\{PANEL\}/, `${rel} does not apply PANEL`);
    // The literal it replaced. `shadow-panel` on its own is fine (globals.css
    // rides it), but the full re-typed card is what drifts.
    assert.doesNotMatch(
      src,
      /"rounded-lg border border-stone-200 bg-white[^"]*shadow-panel/,
      `${rel} still re-types the PANEL literal`
    );
  }
});

test("the History header composes the editorial type recipes", () => {
  const src = read("history/HistoryTab.tsx");
  for (const recipe of ["EYEBROW", "TITLE_DISPLAY", "INTRO"]) {
    assert.match(src, new RegExp(`\\b${recipe}\\b`), `HistoryTab does not use ${recipe}`);
  }
  assert.doesNotMatch(src, /className="text-meta uppercase text-coral"/, "HistoryTab still re-types EYEBROW");
  assert.doesNotMatch(src, /font-serif text-display text-ink"/, "HistoryTab still re-types TITLE_DISPLAY");
});

test("both CV/JD drop zones show a keyboard focus ring on the VISIBLE label", () => {
  // The input inside these labels is `sr-only`, so `focus-ring` on the input
  // paints a ring on a clipped element — invisible. `focus-within` on the label is
  // the fix, and DROP_ZONE_FOCUS is now the one copy of it (the FileInput primitive
  // that also carried it was retired unused).
  const surfaces = read("analyzeSurfaces.ts");
  assert.match(surfaces, /focus-within:\[box-shadow:/, "DROP_ZONE_FOCUS lost its visible ring");
  for (const rel of ["AnalyzeFileDropZone.tsx", "AnalyzeProfileInput.tsx"]) {
    const src = read(rel);
    assert.match(src, /\$\{DROP_ZONE_FOCUS\}/, `${rel}'s drop zone has no visible focus ring`);
  }
});

test("the run-configuring controls precede the run trigger in DOM order", () => {
  // Report language and blind screening decide what the run produces, so a
  // keyboard user must reach them BEFORE Analyze. This is DOM order, which is tab
  // order — a visual reorder (order-*/flex-row-reverse) would pass the eye and
  // fail the keyboard.
  const src = read("AnalyzeFormFooter.tsx");
  const reportLang = src.indexOf('t("reportLanguage")');
  const blind = src.indexOf('t("blind")');
  const analyze = src.indexOf("onClick={handlers.submit}");
  assert.ok(reportLang > 0 && blind > 0 && analyze > 0, "the footer no longer has all three controls");
  assert.ok(reportLang < analyze, "the report-language select must precede the Analyze button");
  assert.ok(blind < analyze, "the blind-screening checkbox must precede the Analyze button");
});

test("the blind-screening explanation is rendered, not hidden in a title attribute", () => {
  const src = read("AnalyzeFormFooter.tsx");
  assert.match(src, /hint=\{t\("blindTitle"\)\}/, "blindTitle must render as the checkbox's visible hint");
  assert.doesNotMatch(src, /title=\{t\("blindTitle"\)\}/, "blindTitle is back to being title-only");
});
