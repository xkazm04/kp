// Withdraw reasons (withdraw-reasons.ts): one key per reason however it is punctuated,
// tallies most frequent then newest, and the brief's challenges read from the list first.
// Runner: node --test (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { briefChallenges, challengeKey, tallyWithdrawReasons, withdrawCountsByKey } from "./withdraw-reasons.ts";

const w = (challenge: string, at: string) => ({ withdrawReason: { challenge, index: 0, at } });

test("challengeKey folds case, quotes, whitespace and closing punctuation", () => {
  assert.equal(challengeKey("  The “budget”  is FIXED. "), challengeKey("the budget is fixed"));
  assert.notEqual(challengeKey("The budget is fixed"), challengeKey("The deadline is fixed"));
});

test("tallyWithdrawReasons: one row per reason, most frequent first, then newest; the newest wording wins; unnamed withdraws are not reasons", () => {
  const rows = tallyWithdrawReasons([
    w("Daily calls required", "2026-09-20T00:00:00.000Z"),
    w("The budget is fixed.", "2026-09-21T00:00:00.000Z"),
    w("the budget is fixed", "2026-09-22T00:00:00.000Z"),
    w("NDA before any detail", "2026-09-23T00:00:00.000Z"),
    { withdrawReason: null },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.challenge, r.count]),
    [
      ["the budget is fixed", 2],
      ["NDA before any detail", 1],
      ["Daily calls required", 1],
    ]
  );
  assert.equal(withdrawCountsByKey(rows).get(challengeKey("The budget is fixed!")), 2);
});

test("briefChallenges prefers the stored list and falls back to the Markdown section", () => {
  assert.deepEqual(briefChallenges({ challenges: ["A", " B "], markdown: "" }), ["A", "B"]);
  const markdown = "## What the gig is\nx\n\n## Expected challenges\n- One\n- Two with \\*stars\\*\n\n## Sources read\n- [a](https://a.test) - fetched";
  assert.deepEqual(briefChallenges({ challenges: [], markdown }), ["One", "Two with *stars*"]);
  assert.deepEqual(briefChallenges(undefined), []);
});
