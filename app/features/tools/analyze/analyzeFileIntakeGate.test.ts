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
  // onAdd covers the empty drop, click-select, Add-variant, sample-CV and
  // drop-anywhere paths; onReplace covers the per-row swap. Either may be passed
  // to accept() BY REFERENCE or called INSIDE its continuation — batch intake
  // needs the continuation form, because it sets a `committed` flag to tell a
  // gate rejection apart from a success and stop the loop right there.
  //
  // So this is no longer "onAdd is never called directly". That phrasing encoded
  // a pass-by-reference assumption, and it went stale the moment batch intake
  // landed: it failed on a call that WAS correctly gated. The invariant it was
  // always reaching for is that no mutator call survives OUTSIDE an accept()
  // continuation — so strip every accept(...) call expression and assert nothing
  // is left. A genuinely ungated call still fails immediately.
  const outsideGate = stripAcceptCalls(src);
  for (const mutator of ["onAdd", "onReplace"]) {
    assert.equal(
      outsideGate.match(new RegExp(String.raw`\b${mutator}\s*\(`, "g")),
      null,
      `${mutator} is called outside an accept() continuation — that intake path bypasses acceptUpload`,
    );
  }
});

// Remove every `accept( … )` call expression, matching parens so a nested call or
// an arrow body is consumed whole. What remains is the code that runs WITHOUT the
// gate, which is exactly what the assertion above must be blind to.
function stripAcceptCalls(src: string): string {
  const CALL = "accept(";
  let out = "";
  let i = 0;
  for (;;) {
    const at = src.indexOf(CALL, i);
    if (at === -1) return out + src.slice(i);
    // `useFileAccept(`, `onAccept(` and friends also end in "accept(" — require a
    // non-identifier char before it so only the bare call is stripped.
    if (at > 0 && /[A-Za-z0-9_$]/.test(src[at - 1])) {
      out += src.slice(i, at + CALL.length);
      i = at + CALL.length;
      continue;
    }
    out += src.slice(i, at);
    let depth = 0;
    let j = at + CALL.length - 1;
    for (; j < src.length; j += 1) {
      if (src[j] === "(") depth += 1;
      else if (src[j] === ")" && --depth === 0) {
        j += 1;
        break;
      }
    }
    assert.equal(depth, 0, "unbalanced accept( … ) — the stripper cannot vouch for this file");
    i = j;
  }
}

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
