// Source guard: the Analyze surface stays inside the design system.
//
// The tab shipped 21 files with ZERO imports from app/_components/ui/recipes.ts —
// PANEL was re-typed as a literal in four places, and the History header re-typed
// EYEBROW / TITLE_DISPLAY / INTRO. A re-typed recipe is not a style choice, it is
// a copy that stops tracking the original: when PANEL grew its Spark Dark sticker
// treatment, every literal panel kept the light-only card.
//
// There is no render/DOM layer in this repo (the retired form's intake gate test said why at
// length), so these read the source. Each assertion names the property
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

// The surfaces that were literal panels and still exist. Each must IMPORT the recipe and USE
// it — an import alone composes nothing.
// (The v1 form's two panels and its drop-zone/footer checks left with the form; its last
// version is in git history.)
const PANEL_SURFACES = ["AnalyzeWorkspace.tsx", "history/HistoryTab.tsx"];

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
