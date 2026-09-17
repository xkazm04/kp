// Source pins for NoMatchesExplainer's optional next-action slot. The unit
// runner has no DOM renderer, so these read the component as text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, "MatchPresentation.tsx"), "utf8");

test("NoMatchesExplainer with action renders a link or button; without action, no control", () => {
  assert.match(src, /action\?: NoMatchesAction/, "the action slot is optional");
  const card = src.slice(src.indexOf("function Card"), src.indexOf("export function Chip"));
  assert.ok(card.length > 0, "could not isolate Card");
  assert.match(card, /action\?\.href/, "href paints a link");
  assert.match(card, /<button type="button" onClick=\{action\.onClick\}/, "onClick paints a button");
  assert.match(card, /action \? <button/, "omitting action paints no control");
  assert.match(card, /BTN_GHOST/, "the control composes the ghost recipe");
});
