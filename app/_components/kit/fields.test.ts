// The kit's form parts, added at Gate 1 (Settings > Hiring): the class a text or select control
// wears, the save bar's tone and mark, and - because the parts are DOM and node:test has no
// renderer - that every class a new part (or a new prop on an old part) emits has a rule in
// kit.css, so a renamed class cannot leave a part unstyled while the tests stay green.
//
// Runner: Node's built-in test runner with type stripping - npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SAVE_MARK, inputClass, saveBarClass, saveTone } from "./fields.ts";

const css = readFileSync(new URL("./kit.css", import.meta.url), "utf8");
const src = (f: string) => readFileSync(new URL(`./${f}`, import.meta.url), "utf8");

test("a field is md (40px) by default and sm (32px) on request; extra classes are kept", () => {
  assert.equal(inputClass(), "k-input");
  assert.equal(inputClass("sm"), "k-input k-input--sm");
  assert.equal(inputClass("md", "wide"), "k-input wide");
  assert.match(css, /input\.k-input\.k-input--sm, select\.k-input\.k-input--sm \{ height: 32px;/);
  assert.match(css, /\.k-input\[aria-invalid="true"\] \{ border-color: var\(--color-red-600\); \}/);
});

test("the save bar's tone: saving, then blocked, then dirty, then clean", () => {
  assert.equal(saveTone({ dirty: true, blocked: true, saving: true }), "saving");
  assert.equal(saveTone({ dirty: true, blocked: true, saving: false }), "blocked");
  // A blocked draft is refused even when the reason is not the draft itself (an occupancy read failed).
  assert.equal(saveTone({ dirty: false, blocked: true, saving: false }), "blocked");
  assert.equal(saveTone({ dirty: true, blocked: false, saving: false }), "dirty");
  assert.equal(saveTone({ dirty: false, blocked: false, saving: false }), "clean");
});

test("each save tone hangs a distinct mark shape, and its class has a rule in both registers", () => {
  const marks = Object.values(SAVE_MARK);
  assert.equal(new Set(marks).size, marks.length);
  assert.equal(saveBarClass("clean"), "k-savebar");
  for (const tone of ["dirty", "blocked", "saving"] as const) {
    assert.equal(saveBarClass(tone), `k-savebar is-${tone}`);
    assert.ok(css.includes(`.k-savebar.is-${tone}`), `light rule for ${tone}`);
    assert.ok(css.includes(`[data-theme="dark"] .k-savebar.is-${tone}`), `dark rule for ${tone}`);
  }
  assert.match(css, /\.k-savebar \{\n  position: sticky; bottom: 0;/);
  // In flow the bar takes its own height, so it can never cover a row.
  assert.equal(saveBarClass("dirty", "flow"), "k-savebar is-dirty is-flow");
  assert.match(css, /\.k-savebar\.is-flow \{ position: relative;/);
});

test("the new props and parts emit classes kit.css styles: SettingRow detail, Segmented lead, Clip", () => {
  assert.match(src("SettingRow.tsx"), /className="k-set__detail"/);
  assert.match(css, /\.k-set__detail \{ grid-column: name \/ end; grid-row: 2;/);
  assert.match(src("Toolbar.tsx"), /className="k-seg-lead"/);
  assert.match(src("Toolbar.tsx"), /className="k-seg-lead__word"/);
  assert.match(css, /\.k-seg-lead \{/);
  assert.match(css, /\.k-seg-lead__word \{/);
  assert.match(src("Clip.tsx"), /className="k-clip" data-tip=\{text\}/);
  assert.match(css, /\.k-clip \{ display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; \}/);
  // Additive: a Segmented without a lead renders exactly the group it always did.
  assert.match(src("Toolbar.tsx"), /if \(!lead\) return group;/);
});
