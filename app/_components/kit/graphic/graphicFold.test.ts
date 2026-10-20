// The measure's collapse order, as the parts that live on its meta track and the stage cell see it
// (kit-unification Gate K2 fit pass). Pinned the way foldOrder.test.ts pins the tracks: by reading the
// stylesheets, because a container query is the whole mechanism and no DOM runs here.
//
// Runner: Node's built-in test runner with type stripping - npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nullLabelAt, showRankOne, skyTicks, SKY } from "./skylineGeometry.ts";

const kit = readFileSync(new URL("../kit.css", import.meta.url), "utf8");
const graphic = readFileSync(new URL("./graphic.css", import.meta.url), "utf8");
function block(css: string, query: string): string {
  const at = css.indexOf(query);
  assert.ok(at >= 0, `missing ${query}`);
  let depth = 0;
  for (let i = css.indexOf("{", at); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(at, i + 1);
  }
  throw new Error(`unbalanced ${query}`);
}
const step1 = block(kit, "@container sheet (max-width: 1000px)");
const step2 = block(kit, "@container sheet (max-width: 860px)");
const narrowGraphic = block(graphic, "@container sheet (max-width: 860px)");

test("step 1 (<= 1000px): the stage cell keeps shape + stage and folds its reason; section heads wrap by whole units", () => {
  assert.match(step1, /\.k-stagecell \.k-needs-t \{ display: none; \}/);
  assert.match(step1, /\.k-section__head \{ display: flex; flex-wrap: wrap;/);
  assert.match(step1, /\.k-section__state \{ order: 2; flex: 1 0 100%;/, "the state line takes its own line, whole");
  assert.match(step1, /\.k-section__acts \{ order: 1; flex: none;/, "the actions never shrink into a word-wrap");
  assert.match(kit, /\.k-section__count \{[^}]*white-space: nowrap;/, "a count is one unit at every width");
  assert.doesNotMatch(step2, /\.k-section__state span \{[^}]*white-space: normal/, "no step lets the state wrap word by word");
});

test("no fold step hides the graphic parts: the dots and the bars stay at every sheet width", () => {
  for (const [name, css] of [["kit step 2", step2], ["graphic narrow", narrowGraphic]] as const) {
    assert.doesNotMatch(css, /\.k-sieve__dots \{ display: none/, name);
    assert.doesNotMatch(css, /\.k-sky \{ display: none/, name);
    assert.doesNotMatch(css, /\.k-sieve__field[^{]*\{ visibility: hidden/, name);
  }
});

test("on a narrow sheet the Sieve keeps mark, a narrow label, the dot field and the count; sub-line and age fold to the tip", () => {
  assert.match(narrowGraphic, /\.k-sieve__layer, \.k-sieve \.k-sieve__pour \{ grid-template-columns: \[mark\] var\(--m-mark\) \[name\] minmax\(0, 132px\) \[meta\] minmax\(0, 1fr\) \[fig\] 48px \[end\]; \}/);
  assert.match(narrowGraphic, /\.k-row__name small, \.k-sieve \.k-sieve__layer \.k-row__time, \.k-sieve \.k-sieve__layer \.k-row__acts \{ display: none; \}/);
  assert.match(block(graphic, "@container sheet (max-width: 1000px)"), /\.k-sieve__legend \{ grid-column: name \/ end; grid-row: 2; \}/, "from step 1 the legend takes the pour line's second row");
  // 480px of sheet, the floor: mark 28 + label 132 + count 48 + three 16px gaps leave the field >= 220px
  const field = 480 - 28 - 132 - 48 - 3 * 16;
  assert.ok(field >= 220 && Math.floor((field - 4) / 15) >= 14, `the field still lays 14+ dots per line (${field}px)`);
});

test("skyline: fewer labels on a narrow sheet, never fewer bars", () => {
  assert.deepEqual(skyTicks(1100), [0, 50, 100]);
  assert.deepEqual(skyTicks(480), [0, 100]);
  assert.deepEqual(nullLabelAt(300, 1000), { x: 304, textAnchor: "start" });
  assert.deepEqual(nullLabelAt(900, 1000), { x: 1000 - SKY.right, textAnchor: "end" }, "a late null run ends its label at the edge");
  assert.equal(showRankOne(900, 1000), true);
  assert.equal(showRankOne(200, 240), false, "rank 1 gives way before it can touch the null label");
});
