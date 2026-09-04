// Source-guard: how a traced glyph announces itself to assistive tech.
//
// The renderer shipped `aria-hidden role="img"` on the same <svg> — a
// contradiction. `role="img"` declares an image in the accessibility tree,
// `aria-hidden` removes the subtree from it, and there was no way for a consumer
// to give the drawing a name: a glyph that IS the information (no adjacent
// heading, no body sentence) had no route to one. Nothing in the folder asserted
// anything about accessibility at all.
//
// The contract now: no `label` -> decoration, `aria-hidden` and no role; with a
// `label` -> `role="img"` and `aria-label`, and NO `aria-hidden`. This reads the
// source rather than rendering, because the thing worth pinning is the mutual
// exclusion — a render test would have to assert the absence of an attribute in
// one branch, which is exactly the assertion that silently passes when the branch
// stops existing.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("./MotionizedGlyph.tsx", import.meta.url)), "utf8");

test("self-check: the renderer source was read", () => {
  assert.ok(src.includes("export function MotionizedGlyph"), "MotionizedGlyph.tsx did not parse as expected");
});

test("the glyph takes an optional accessible name", () => {
  assert.match(src, /\blabel\?: string;/, "no optional `label` prop — a glyph that is the information cannot be named");
});

test("aria-hidden and the named image role are mutually exclusive", () => {
  // One spread expression decides both, so the two states cannot drift apart.
  assert.match(
    src,
    /\{\.\.\.\(label \? \{ role: "img", "aria-label": label \} : \{ "aria-hidden": true \}\)\}/,
    "the two a11y states are not derived from one `label ? … : …` spread",
  );
});

test("no unconditional aria-hidden or role survives on the opening svg tag", () => {
  // Comments are stripped first: the prose that explains this contract names both
  // attributes, and a guard that trips on its own documentation is useless.
  const bare = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const tag = bare.slice(bare.indexOf("<svg"), bare.indexOf("<style>"));
  assert.ok(tag.includes("viewBox"), "no <svg> opening tag found");
  assert.doesNotMatch(tag, /(?:^|\s)aria-hidden(?:=|\s|$)/, "a literal aria-hidden attribute is back on the <svg>");
  assert.doesNotMatch(tag, /(?:^|\s)role="img"/, 'a literal role="img" attribute is back on the <svg>');
});

test("a label is never hardcoded English inside the renderer", () => {
  // The name has to come from the consumer's `t(...)`; a default here would ship
  // one locale to every reader (the house rule in .claude/CLAUDE.md).
  assert.doesNotMatch(src, /"aria-label":\s*"/, "a literal aria-label string is hardcoded in the renderer");
});
