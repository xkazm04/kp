// Pins the Tab-trap's BOUNDARY rule. useDialogA11y itself needs React and a DOM, and
// this repo has no render/DOM test layer (see Select.test.ts, radio.a11y.test.ts), so
// the predicate that decides what counts as a trap edge is extracted and tested here —
// the same reason select-keys.ts and segmented-control-selection.ts were extracted.
//
// The defect this file exists to prevent recurring: the focusable query matches by TAG,
// so it collected elements that can never receive focus. A hidden input at `last` made
// `active === last` unreachable and Tab escaped the dialog; one at `first` made the
// open-focus call a no-op, so the dialog opened with focus still behind it.
//
// Runner: Node's built-in test runner with type stripping — npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { isTrapFocusable } from "./useDialogA11y.ts";

/** Minimal element stand-in: only the four reads the predicate makes. */
function el(opts: {
  tag?: string;
  attrs?: Record<string, string>;
  rects?: number;
}): HTMLElement {
  const attrs = opts.attrs ?? {};
  return {
    tagName: (opts.tag ?? "BUTTON").toUpperCase(),
    hasAttribute: (n: string) => n in attrs,
    getAttribute: (n: string) => (n in attrs ? attrs[n] : null),
    getClientRects: () => ({ length: opts.rects ?? 1 }),
  } as unknown as HTMLElement;
}

test("a visible, enabled control is a trap boundary", () => {
  assert.equal(isTrapFocusable(el({})), true);
  assert.equal(isTrapFocusable(el({ tag: "input", attrs: { type: "text" } })), true);
  assert.equal(isTrapFocusable(el({ tag: "a", attrs: { href: "/x" } })), true);
});

test("a hidden input is never a boundary — it cannot take focus", () => {
  // Select.tsx renders <input type="hidden" name={name}> whenever it is given a form
  // name, so any dialog containing such a Select carries one in its subtree.
  assert.equal(isTrapFocusable(el({ tag: "input", attrs: { type: "hidden" } })), false);
  // Case-insensitively: the attribute is author-written.
  assert.equal(isTrapFocusable(el({ tag: "input", attrs: { type: "HIDDEN" } })), false);
  // A hidden input is the only input type excluded.
  assert.equal(isTrapFocusable(el({ tag: "input", attrs: { type: "checkbox" } })), true);
});

test("an element with no client rects (display:none, detached) is not a boundary", () => {
  assert.equal(isTrapFocusable(el({ rects: 0 })), false);
  // Visibility is read from rects, not offsetParent, so an SVG child answers correctly
  // too (offsetParent is undefined on SVG and would read as visible).
  assert.equal(isTrapFocusable(el({ tag: "g", attrs: { tabindex: "0" }, rects: 0 })), false);
  assert.equal(isTrapFocusable(el({ tag: "g", attrs: { tabindex: "0" }, rects: 1 })), true);
});

test("disabled and aria-disabled controls stay excluded", () => {
  // Regression guard for the rule this predicate already carried: an aria-disabled
  // button is still tabbable, so counting it would land focus on a dead control.
  assert.equal(isTrapFocusable(el({ attrs: { disabled: "" } })), false);
  assert.equal(isTrapFocusable(el({ attrs: { "aria-disabled": "true" } })), false);
  // aria-disabled="false" is NOT disabled.
  assert.equal(isTrapFocusable(el({ attrs: { "aria-disabled": "false" } })), true);
});
