import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The decide rows' work-sample status ("Work sample — not sent") must wrap, not ellipsize, in the
// narrow fold (container < 560px, i.e. a 375px phone); the wide rule keeps its one-line ellipsis.
const css = readFileSync(new URL("./docket.css", import.meta.url), "utf8");

test("narrow decide rows let the work-sample status wrap", () => {
  const block = css.match(/@container dk \(max-width: 560px\) \{\s*\.dk-rows--ws \.dk-row[^}]*\}[\s\S]*?\.dk-rows--ws \.dk-ws \{([^}]*)\}/);
  assert.ok(block, "the narrow .dk-rows--ws .dk-ws rule exists");
  const decl = block[1];
  assert.match(decl, /white-space:\s*normal/);
  assert.match(decl, /overflow:\s*visible/);
  assert.match(decl, /text-overflow:\s*clip/);
});

test("the wide .dk-ws rule is unchanged", () => {
  assert.match(css, /\.dk-ws \{ display: inline-flex; align-items: baseline; gap: 4px; min-width: 0; font-size: var\(--text-micro\); color: var\(--k-quiet\); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; \}/);
});
