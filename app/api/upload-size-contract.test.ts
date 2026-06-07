// Locks the server half of the one end-to-end max-input file-size contract
// (idea-36cc4b87): every upload Route Handler must reject an over-limit file
// with the shared FILE_TOO_LARGE_STATUS (413) — not a hand-rolled 400 — so "too
// big" is reported the same way wherever a file enters, and the limit + status
// live in exactly one place.
//
// Both routes now reach that contract through the one shared server gate,
// validateUploadServer (idea-5b61d729): the over-limit branch lives in
// upload-constraints.ts, and each route just delegates to it instead of
// re-checking MIME/size inline. So this source-level guard (the route modules
// import via the "@/..." alias, which Node's test runner does not resolve)
// asserts two things — the routes delegate to the shared gate, and the shared
// gate wires the size branch to FILE_TOO_LARGE_STATUS. The contract values are
// exercised behaviorally in app/_lib/upload-constraints.test.ts.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FILE_TOO_LARGE_STATUS } from "../_lib/upload-constraints.ts";

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

const ROUTES = ["./analyze/route.ts", "./extract-text/route.ts"];

for (const rel of ROUTES) {
  test(`${rel} rejects an over-limit upload via the shared server gate`, () => {
    const src = read(rel);

    // Both routes must gate uploads through the one shared validator from
    // upload-constraints.ts rather than re-checking MIME/size inline — that
    // shared gate is what keeps "too big" wired to FILE_TOO_LARGE_STATUS.
    assert.match(src, /from "@\/app\/_lib\/upload-constraints"/, "must read the upload-size contract");
    assert.match(src, /validateUploadServer/, "must reject via the shared server gate, not an inline check");

    // No hand-rolled size branch in the route: the `file.size > MAX_FILE_BYTES`
    // guard now lives only in the shared gate, so a route can't quietly collapse
    // "too big" back into a bare `status: 400`.
    assert.doesNotMatch(
      src,
      /file\.size > MAX_FILE_BYTES/,
      "the over-limit check must live in the shared gate, not inline in the route",
    );
  });
}

// The shared gate is the one place the over-limit branch lives: a
// `file.size > MAX_FILE_BYTES` guard returning the shared 413 status with the
// shared message. If someone "simplifies" it to a bare 400, this fails rather
// than silently re-merging the two rejection reasons.
test("validateUploadServer wires the over-limit branch to FILE_TOO_LARGE_STATUS", () => {
  const src = read("../_lib/upload-constraints.ts");
  assert.match(src, /fileTooLargeMessage/, "must use the shared over-limit message");
  const sizeBranch = src.match(/file\.size > MAX_FILE_BYTES[\s\S]{0,160}?status:\s*([A-Za-z0-9_]+)/);
  assert.ok(sizeBranch, "expected a `file.size > MAX_FILE_BYTES` guard returning a status");
  assert.equal(sizeBranch[1], "FILE_TOO_LARGE_STATUS", "the over-limit branch must return FILE_TOO_LARGE_STATUS");
});

// Belt-and-suspenders: the shared constant is the RFC 9110 "Content Too Large"
// code. If someone "simplifies" it back to 400, this and the route guards fail
// together rather than silently re-merging the two rejection reasons.
test("FILE_TOO_LARGE_STATUS is 413", () => {
  assert.equal(FILE_TOO_LARGE_STATUS, 413);
});
