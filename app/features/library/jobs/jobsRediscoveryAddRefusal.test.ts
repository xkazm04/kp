// remaining-add-callers-read-the-code (wave 19b) — the silver-medalist feed put
// `postPipelineAdd`'s canonical ENGLISH `message` straight into the row's error
// line via applyAddResult. A capability refusal read "Your role does not allow this
// action." in every locale, and the code that would have localized it was dropped.
//
// Non-vacuity: against pre-fix code both source assertions fail — the hook did not
// import useErrorMessage and handed `res` (carrying its `message`) to applyAddResult.
//
// Runner: Node's built-in test runner (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const hook = readFileSync(new URL("./jobsRediscoveryFeedLogic.ts", import.meta.url), "utf8");

test("the feed localizes the refusal before it reaches the row", () => {
  assert.match(hook, /useErrorMessage/, "the hook must bind the code resolver");
  assert.match(hook, /capabilityAwareReason\(errMsg, res, t\("addFailed"\)\)/, "…and fold a capability refusal into it");
  assert.match(hook, /\{ ok: false as const, message: addReason \}/, "the pure transition gets the LOCALIZED reason");
});

test("jobs.rediscoveryFeed.addFailed exists in all four catalogs", () => {
  for (const locale of ["en", "cs", "de", "fr"]) {
    const cat = JSON.parse(readFileSync(new URL(`../../../../messages/${locale}.json`, import.meta.url), "utf8")) as {
      jobs: { rediscoveryFeed: Record<string, string> };
    };
    assert.ok(cat.jobs.rediscoveryFeed.addFailed, `${locale}: jobs.rediscoveryFeed.addFailed must exist`);
  }
});
