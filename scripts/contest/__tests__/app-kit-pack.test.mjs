// APP-KIT PACK - the style pack a design contest on an app surface hands its seats.
//
// WHAT THIS EXISTS TO CATCH. The pack is only worth staging if it is the app's REAL vocabulary: a
// token renamed in app/globals.css, a recipe given a utility the translator cannot read, a kit part
// whose class moved, or a font dropped from app/layout.tsx must fail here instead of shipping a pack
// that quietly teaches the old paint. So the fixture runs the tool against this tree into a temp dir
// and reads what a seat would read, plus the pure pieces (the CSS reader, the Tailwind subset) on
// inputs whose answer is known.
//
// Runner: plain node:test, no deps - `npm run test:docs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  REPO, buildPack, byClass, customProps, fontFamilies, parseBlocks, pickRules, recipeCss, recipeStrings, utility, PARTS, RECIPES,
} from "../app-kit-pack.mjs";

test("the CSS reader keeps at-rule wrappers and the keyframes a picked rule names", () => {
  const css = `/* x */ .a { color: red; animation: spin 1s; } .b { color: blue; }
    @media (prefers-reduced-motion: reduce) { .a { animation: none; } .b { x: 1; } }
    @keyframes spin { to { rotate: 1turn; } } @keyframes other { to { opacity: 0; } }`;
  const out = pickRules(css, byClass(["a"]));
  assert.match(out, /^\.a \{ color: red; animation: spin 1s; \}/);
  assert.match(out, /@media \(prefers-reduced-motion: reduce\) \{\n {2}\.a \{ animation: none; \}\n\}/);
  assert.match(out, /@keyframes spin/);
  assert.doesNotMatch(out, /\.b|other/);
  assert.equal(parseBlocks(css).length, 5);
});

test("a class keeper takes the class and its modifiers, never a longer name", () => {
  const keep = byClass(["k-need"]);
  assert.ok(keep(".k-need") && keep(".k-need:hover .k-need__cta") && keep('.k-need[data-tone="bad"]'));
  assert.ok(!keep(".k-needs-t") && !keep(".k-needlist"));
});

test("custom properties and next/font families are read as declared", () => {
  assert.deepEqual(customProps("--a: 1px; color: red; --b-c:  x  y ;"), [["--a", "1px"], ["--b-c", "x y"]]);
  const fonts = fontFamilies(`const a = Inter({ subsets: ["latin"], variable: "--font-inter" });
const b = Bricolage_Grotesque({ variable: "--font-bricolage", weight: ["400", "800"] });`);
  assert.deepEqual(fonts.get("--font-inter"), { family: "Inter", weights: null });
  assert.deepEqual(fonts.get("--font-bricolage"), { family: "Bricolage Grotesque", weights: ["400", "800"] });
});

test("the Tailwind subset: tokens stay variables, unknown utilities are refused, never guessed", () => {
  assert.deepEqual(utility("bg-coral/90"), { "background-color": "color-mix(in oklab, var(--color-coral) 90%, transparent)" });
  assert.deepEqual(utility("text-meta"), { "font-size": "var(--text-meta)", "line-height": "var(--text-meta--line-height)" });
  assert.deepEqual(utility("-rotate-1"), { rotate: "-1deg" });
  assert.deepEqual(utility("px-1.5"), { "padding-inline": "6px" });
  assert.equal(utility("text-[13px]"), null, "an arbitrary size is not the app's");
  assert.equal(utility("bg-violet-500"), null, "violet is not a sanctioned family");
  const r = recipeCss("BTN_X", "rounded-md bg-coral hover:translate-x-[1px] hover:translate-y-[1px] dark:rounded-lg dark:hover:shadow-none mystery-thing");
  assert.deepEqual(r.unmapped, ["mystery-thing"]);
  assert.match(r.css, /\.kp-btn-x:hover \{ translate: 1px 1px; \}/);
  assert.match(r.css, /\[data-theme="dark"\] \.kp-btn-x \{ border-radius: 8px; \}/);
  assert.match(r.css, /\[data-theme="dark"\] \.kp-btn-x:hover \{ box-shadow: 0 0 #0000; \}/);
});

test("the pack over this tree: tokens for both themes, every part and recipe, the guide, the references", async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "app-kit-"));
  try {
    const shots = path.join(tmp, "shots");
    mkdirSync(shots);
    writeFileSync(path.join(shots, "overview-light.png"), "png");
    writeFileSync(path.join(shots, "notes.txt"), "not a picture");
    const r = await buildPack({ target: tmp, shots, stamp: "fixture" });
    assert.deepEqual(r.unmapped, [], "every staged recipe translates fully");
    assert.deepEqual(r.references, ["overview-light.png"]);
    assert.deepEqual(readdirSync(path.join(r.dir, "reference")), ["overview-light.png"]);

    const tokens = readFileSync(path.join(r.dir, "tokens.css"), "utf8");
    assert.match(tokens, /fonts\.googleapis\.com\/css2\?family=Inter[^"]*family=Fraunces[^"]*family=Bricolage\+Grotesque/);
    const [light, dark] = tokens.split('[data-theme="dark"] {');
    for (const t of ["--color-ink", "--color-paper", "--color-coral", "--color-moss", "--color-steel", "--color-white", "--color-stone-200"]) {
      assert.match(light, new RegExp(`${t}: `), `${t} in Studio Light`);
      assert.match(dark, new RegExp(`${t}: `), `${t} in Spark Dark`);
    }
    assert.match(light, /--font-serif: var\(--font-fraunces\)/, "Studio Light's display face is Fraunces");
    assert.match(dark, /--font-serif: var\(--font-bricolage\)/, "Spark Dark's display face is Bricolage");
    assert.match(light, /--text-micro: 14px;/, "the 14px floor");
    assert.match(light, /--k-radius: 8px;/);
    assert.match(dark, /--k-radius: 12px;/);
    assert.match(light, /--panel-shadow: /);
    assert.doesNotMatch(tokens, /--color-cv-|--z-sim/, "feature-only tokens stay out of the pack");
    assert.match(tokens, /:where\(a, button, input, textarea, select, \[tabindex\]\):focus-visible/, "the focus ring");
    assert.match(tokens, /\.text-display \{/);

    const comp = readFileSync(path.join(r.dir, "components.md"), "utf8");
    for (const p of PARTS) assert.match(comp, new RegExp(`### ${p.name.replace(/[/()]/g, ".")} `), p.name);
    for (const p of PARTS) for (const c of p.classes) assert.match(comp, new RegExp(`\\n\\.${c}[ .:\\[_-]|\\n\\[data-theme="dark"\\] \\.${c}`), `${c} has rules`);
    for (const [name] of RECIPES) assert.match(comp, new RegExp(`\\.kp-${name.toLowerCase().replace(/_/g, "-")} \\{`), name);
    assert.match(comp, /<span class="k-mark k-mark--ok"><svg/, "the mark shapes are staged as SVG");

    assert.equal(readFileSync(path.join(r.dir, "GUIDE.md"), "utf8"), readFileSync(path.join(REPO, "docs/design/app-contest-kit.md"), "utf8"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("every staged recipe exists in recipes.ts as a plain string", () => {
  const src = readFileSync(path.join(REPO, "app/_components/ui/recipes.ts"), "utf8");
  const all = recipeStrings(src);
  for (const [name] of RECIPES) assert.ok(all.has(name), name);
  assert.ok(existsSync(path.join(REPO, "node_modules/tailwindcss/theme.css")), "the stock shades come from tailwindcss");
});
