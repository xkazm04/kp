// gated-doors-clients-read-the-refusal — the look-before-commit modal is the screen
// the commit button lives on, and POST /api/automation/run is capability-gated.
// Before this the modal took no error at all: a viewer pressed Apply, the gate
// refused, and the modal simply stayed open with nothing said. The refusal now
// arrives as the machine half (code + capability) and is resolved here through
// errors.<CODE> in the reader's language.
//
// Non-vacuity: against pre-fix code every assertion fails — the modal had no
// `commitError` prop, no useErrorMessage, and the dock's hook threw the body away.
//
// .tsx with no component-test runner in this repo, so the contract is pinned by
// reading the source (see PipelineFilterBar.test.ts for the same technique).
//
// Runner: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const modal = readFileSync(new URL("./PassPreviewModal.tsx", import.meta.url), "utf8");
const kit = readFileSync(new URL("../../shell/simulation/simControlCenterKit.ts", import.meta.url), "utf8");
const dock = readFileSync(new URL("../../shell/simulation/SimControlDock.tsx", import.meta.url), "utf8");

test("the modal takes the refusal as code + capability, never a sentence", () => {
  assert.match(modal, /export type PassCommitRefusal = \{ code\?: string \| null; capability\?: string \| null \} \| null;/);
  assert.match(modal, /commitError\?: PassCommitRefusal;/);
});

test("the modal renders the refusal from its code, with the capability as data", () => {
  assert.match(modal, /const errMsg = useErrorMessage\(\);/);
  assert.match(modal, /capabilityAwareReason\(errMsg, commitError, t\("previewCommitFailed"\)\)/);
  assert.match(modal, /role="alert"/, "a refusal must be announced, not just printed");
});

test("the commit hook keeps the machine half and hands it to the modal", () => {
  assert.match(kit, /setCommitError\(\{/, "the refusal body is read, not dropped");
  assert.match(kit, /code: typeof p\?\.code === "string" \? p\.code : null/);
  assert.match(kit, /capability: typeof p\?\.capability === "string" \? p\.capability : null/);
  assert.match(kit, /return \{ busy, preview, entries, committed, error, commitError, dryRun, commit, dismiss \};/);
  assert.match(dock, /commitError=\{pass\.commitError\}/, "the dock threads it into the modal");
});

test("the pass-committed fallback exists in all four catalogs", () => {
  for (const locale of ["en", "cs", "de", "fr"]) {
    const cat = JSON.parse(readFileSync(new URL(`../../../../messages/${locale}.json`, import.meta.url), "utf8")) as {
      pipeline: { tab: Record<string, string> };
    };
    assert.equal(
      typeof cat.pipeline.tab.previewCommitFailed,
      "string",
      `messages/${locale}.json pipeline.tab.previewCommitFailed is missing`
    );
  }
});
