// Guards the "every File goes through one gate" contract (idea-c9abc53f).
//
// The Analyze workspace has several File entry points — the empty drop zone, the
// Replace input, the Add-variant input, and the drop-anywhere overlay. They used
// to validate inconsistently: one path called the state mutator directly, so a
// 20 MB PNG used to Replace a CV slipped in and only failed server-side. They now
// all route through `useFileAccept`'s `accept(file, commit)`, which runs the
// single `acceptUpload` gate. There is no render/DOM test layer in this repo, so
// this is a source-level guard: it asserts the raw File->state mutators
// (onFileChange / onAdd / onReplace) are never *invoked* outside an accept()
// continuation. If someone reintroduces a direct call, this fails immediately.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

test("AnalyzeFileDropZone routes every File through the accept() gate", () => {
  const src = read("./AnalyzeFileDropZone.tsx");
  assert.match(src, /useFileAccept/, "must intake via the shared useFileAccept gate");
  assert.doesNotMatch(src, /validateUpload/, "must not reach for the old per-component validator");
  // onFileChange is this component's only File->state mutator. Once gated it is
  // passed to accept() by reference (`accept(next, onFileChange)`), so a bare
  // `onFileChange(...)` call means a path skipped acceptUpload — the exact
  // Replace-input bypass this requirement removed.
  assert.equal(
    src.match(/onFileChange\s*\(/g),
    null,
    "onFileChange is called directly somewhere — that intake path bypasses acceptUpload",
  );
});

test("AnalyzeProfileInput routes every File through the accept() gate", () => {
  const src = read("./AnalyzeProfileInput.tsx");
  assert.match(src, /useFileAccept/, "must intake via the shared useFileAccept gate");
  assert.doesNotMatch(src, /validateUpload/, "must not reach for the old per-component validator");
  // onAdd covers the empty drop, click-select, Add-variant, sample-CV, and
  // drop-anywhere paths; gated it is passed to accept() by reference.
  assert.equal(
    src.match(/onAdd\s*\(/g),
    null,
    "onAdd is called directly somewhere — that intake path bypasses acceptUpload",
  );
  // onReplace needs the row index, so it is wrapped in an accept() continuation
  // instead of passed by reference. Every line that calls it must also carry the
  // accept( gate, proving the wrap is intact.
  for (const line of src.split("\n")) {
    if (/onReplace\s*\(/.test(line)) {
      assert.match(line, /accept\(/, `onReplace called without the accept() gate: ${line.trim()}`);
    }
  }
});

test("upload-constraints exports the paired client + server gates, no divergent duplicate", () => {
  const src = read("../../../_lib/upload-constraints.ts");
  assert.match(src, /export function acceptUpload/, "acceptUpload must be the exported client gate");
  // The server twin (idea-5b61d729): one shared MIME+size gate both upload
  // routes call, instead of each route re-implementing it inline. Its presence
  // is what lets the two endpoints stay paired here rather than drift.
  assert.match(src, /export function validateUploadServer/, "validateUploadServer must be the exported server gate");
  // No second *client* validator (the old per-component `validateUpload`) to
  // drift from acceptUpload. The trailing `(` keeps this from matching the
  // legitimate server gate validateUploadServer.
  assert.doesNotMatch(src, /export function validateUpload\(/, "validateUpload must not be a second client gate");
});
