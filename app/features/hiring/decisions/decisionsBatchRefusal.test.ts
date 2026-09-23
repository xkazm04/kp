// remaining-add-callers-read-the-code (wave 19b) — the Decisions queue's bulk
// accept/reject treated a WHOLE-REQUEST refusal as an anonymous transport blip:
// every card stayed selected and the status band said "0 accepted · N couldn't be
// decided" with `reason: null`. The batch door had answered with a CODE and the
// capability it wanted (wave 18a) and the queue read neither — the same defect
// PipelineBulkActionBar fixed one surface over.
//
// Re-anchored by decisions-review-ui/A (challenge-r04): both the bulk path and the
// single-row act() now go through the pure fold in decisionsDecideOutcome.ts. The
// bulk band used to join the server's English per-id `reason`, and act() threw the
// refusal body away (`if (!r.ok) throw new Error()`) and failed silently. These
// guards pin the new shape AND forbid both old defects.
//
// Runner: Node's built-in test runner (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const hook = readFileSync(new URL("./useDecisionsQueue.ts", import.meta.url), "utf8");
const bulk = hook.slice(hook.indexOf("const bulkDecideReviews"), hook.indexOf("const groups ="));
const act = hook.slice(hook.indexOf("const act = async"), hook.indexOf("const decide ="));
const postDecide = hook.slice(hook.indexOf("const postDecide = async"), hook.indexOf("const bulkDecideReviews"));

test("a whole-request refusal says WHY, resolved from the code", () => {
  assert.match(bulk, /foldBatchDecide\(/, "the batch response goes through the shared fold");
  assert.match(bulk, /capabilityAwareReason\(\s*errMsg,\s*folded\.requestFailure/, "the request failure is folded with the permission the door named");
  assert.match(bulk, /t\("batch\.requestFailed"\)/, "…and a localized fallback when there was no code");
});

test("the whole-request refusal OVERRIDES the per-id codes", () => {
  assert.match(bulk, /folded\.requestFailure\s*\?/, "no per-id verdict was ever reached when the call itself fell");
});

test("the bulk band never paints the server's English per-id reason", () => {
  assert.doesNotMatch(bulk, /r\.reason/, "per-id `reason` is canonical English — the band resolves `code`");
  assert.doesNotMatch(bulk, /reasons\.add/);
  assert.match(bulk, /folded\.codes/, "per-id refusals are named from their codes");
});

test("act() folds a refusal to a coded, localized message instead of throwing it away", () => {
  assert.doesNotMatch(act + postDecide, /throw new Error\(\)/, "the refusal body must be read, not discarded");
  assert.match(act, /await postDecide\(/, "act() posts through the one folding poster");
  assert.match(
    postDecide,
    /foldDecideResponse\(e, action, \{ ok: r\.ok, status: r\.status \}, body\)/,
    "…which folds the body on EVERY status, not only a 2xx"
  );
  assert.match(act, /capabilityAwareReason\(\s*errMsg,\s*outcome\.failure,\s*t\("decideFailed"/, "a failed decision says why, in the reader's language");
  assert.match(act, /return false/, "awaiting callers (group-eval rationale, candidate modal) still get the boolean");
});

test("decisions.batch.requestFailed and decisions.decideFailed exist in all four catalogs", () => {
  for (const locale of ["en", "cs", "de", "fr"]) {
    const cat = JSON.parse(readFileSync(new URL(`../../../../messages/${locale}.json`, import.meta.url), "utf8")) as {
      decisions: { batch: Record<string, string>; decideFailed?: string };
    };
    assert.ok(cat.decisions.batch.requestFailed, `${locale}: decisions.batch.requestFailed must exist`);
    assert.ok(cat.decisions.decideFailed, `${locale}: decisions.decideFailed must exist`);
  }
});
