// The kit's reduced-motion squash must never START a transition.
//
// The bug this pins: kit.css set `transition-duration: .01ms !important` on every element of a kit
// surface. The initial `transition-property` is `all`, so every element whose styles changed began a
// .01ms transition of EVERY property, and a synchronous measure right after the change read the old
// value. The DataTable measures its spacer after a filter, so under reduced motion the ledger showed
// "Rows 1–2 of 11" until the next scroll (the Night Post pinned it off locally in its ledger.css).
// A 0s duration with a 0s delay does not start a transition at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(DIR, "kit.css"), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");

/** The bodies of every `@media (prefers-reduced-motion: reduce) { … }` block. */
function reducedBlocks(src: string): string[] {
  const out: string[] = [];
  let at = src.indexOf("prefers-reduced-motion: reduce");
  while (at >= 0) {
    const open = src.indexOf("{", at);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) {
        out.push(src.slice(open + 1, i));
        break;
      }
    }
    at = src.indexOf("prefers-reduced-motion: reduce", open);
  }
  return out;
}

test("the kit's reduced-motion rule squashes transitions to 0s, never to a non-zero duration", () => {
  const blocks = reducedBlocks(css);
  assert.ok(blocks.length > 0, "kit.css has a reduced-motion block");
  const universal = blocks.join("\n").split("}").find((rule) => rule.includes(".k-kit *"));
  assert.ok(universal, "the universal squash over .k-kit * exists");
  assert.match(universal, /transition-duration:\s*0s\s*!important/, "a 0s duration: no transition starts");
  assert.match(universal, /transition-delay:\s*0s\s*!important/, "…and no delay (a delay alone would start one)");
  for (const block of blocks) {
    for (const m of block.matchAll(/transition-duration:\s*([\d.]+)(ms|s)/g)) {
      assert.equal(Number(m[1]), 0, `a reduced-motion transition-duration of ${m[1]}${m[2]} starts a transition on every element`);
    }
  }
});
