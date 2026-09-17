// The panel's label chain must END ON A NAMED KEY, not on a fall-through.
//
// jdLintMessage is exhaustive over JdLintFinding, so adding a finding kind is a
// compile error there (bug-ui-scan-2026-07-09). That error is discharged by adding
// a JdLintMessage member — and the panel's ternary then absorbed the new key into
// whatever its last branch happened to be. Measured on this tree: with a fifth
// finding kind added and jdLintMessage extended to handle it, `tsc --noEmit` was
// CLEAN and the new finding rendered under the "missing place" label. A reader
// whose unrecognized branch does something is reached by every addition to the
// contract it reads, and no gate sees it.
//
// Source-level guard (kp convention: readFileSync + assert, like
// badge-band-vocab.test.ts / match-score.test.ts) because there is no DOM harness
// for the panel. The real gate is the `never` parameter of the residue handler,
// which turns the same addition into a compile error HERE; this test keeps the
// fall-through from coming back and keeps the residue handler wired.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const panel = readFileSync(path.join(here, "JdsLintPanel.tsx"), "utf8");

test("every JdLintMessage key the panel renders is tested by name", () => {
  // The keys jdLintMessage can return. Each must appear as an explicit
  // `m.key === "<key>"` test in the panel, so none is reached by fall-through.
  const keys = ["lintVague", "lintExclusionary", "lintManyMustHaves", "lintMissingSalary", "lintMissingPlace"];
  for (const key of keys) {
    assert.ok(
      panel.includes(`m.key === "${key}"`),
      `JdsLintPanel.tsx must name ${key} explicitly, not absorb it into a fall-through branch`,
    );
  }
});

test("phrase findings call onLocate with the reported substring", () => {
  assert.match(panel, /onLocate\?: \(phrase: string\) => void/);
  assert.match(panel, /lintFindingPhrase\(f\)/);
  assert.match(panel, /onClick=\{\(\) => onLocate\(phrase\)\}/);
});

test("the chain's residue is a compile-time `never`, not a label", () => {
  // The last branch must hand the residue to a handler whose parameter is
  // `never` — that is what makes a sixth message key a build failure here
  // rather than a mislabeled bullet in production.
  assert.ok(
    /assertLintMessageHandled\s*\(\s*m\s*\)/.test(panel),
    "the panel's ternary must end by handing the residue to assertLintMessageHandled(m)",
  );
  assert.ok(
    /function assertLintMessageHandled\(\s*m\s*:\s*never\s*\)\s*:\s*never/.test(panel),
    "assertLintMessageHandled must take `never`, or the guard is decorative",
  );
});
