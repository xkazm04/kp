// gated-doors-clients-read-the-refusal — POST /api/llm/keys/test is gated on
// org:manage. The row resolved a failure through the CANARY vocabulary only
// (modelsTestReason: auth, rate_limit, timeout…), and a capability refusal carries
// none of those codes — so a recruiter who pressed Test read a flat "Test failed"
// and had no way to learn the button was refused, not the key.
//
// The fix layers the two vocabularies: the canary code still wins where it exists,
// and the API's refusal code is the fallback UNDER it, with FORBIDDEN_CAPABILITY
// naming the permission it wanted.
//
// Non-vacuity: against pre-fix code the second and third assertions fail — the row
// passed the flat `t("testFailed")` as the canary fallback and never imported
// useErrorMessage.
//
// .tsx with no component-test runner in this repo, so the contract is pinned by
// reading the source.
//
// Runner: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const row = readFileSync(new URL("./ModelsKeyRow.tsx", import.meta.url), "utf8");

test("the row never renders the server's own error text", () => {
  assert.doesNotMatch(row, /verdict\?\.error|verdict\.error/, "the verdict's English sentence is for the log, not the panel");
});

test("an API refusal code is the fallback under the canary vocabulary", () => {
  assert.match(row, /const errMsg = useErrorMessage\(\);/);
  assert.match(
    row,
    /reasonFor\(verdict, capabilityAwareReason\(errMsg, verdict, t\("testFailed"\)\)\)/,
    "the canary code wins; the API code resolves under it; the flat sentence is last"
  );
});

test("the refused body's capability is typed so it can be rendered as data", () => {
  assert.match(row, /\(ModelsTestVerdict & \{ capability\?: string \}\) \| null/);
});
