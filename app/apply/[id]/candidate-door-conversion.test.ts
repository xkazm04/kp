import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Conversion guards for the two CANDIDATE-facing doors (the conversational chat
// and the one-screen quick form). Each pins a leak that was live and is cheap to
// silently regress in a restyle/refactor:
//   (a) a knockout question must not STEER the answer with a success tone,
//   (b) a decline must not be a dead end,
//   (c) the quick form's submit must never be a dead disabled button.
// Source-contract tests — the repo pattern for UI wiring unit tests can't reach
// (no DOM renderer in the unit runner).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(HERE, rel), "utf8");

test("chat knockout buttons are tonally neutral — neither answer is signposted as the passing one", () => {
  const src = read("ConversationalApply.tsx");
  // Isolate the ko branch's control block: everything between the `cur.type === "ko"`
  // test and the next branch (`cur.type === "choice"`).
  const koBlock = src.slice(src.indexOf('cur.type === "ko"'), src.indexOf('cur.type === "choice"'));
  assert.ok(koBlock.length > 0, "could not locate the ko control block");
  assert.equal(
    (koBlock.match(/hover:border-coral\/50/g) ?? []).length,
    2,
    "both KO buttons use the same neutral coral hover as the quick form and the choice buttons"
  );
  // The rendered classes only — the block's prose deliberately explains the moss ban.
  const classNames = [...koBlock.matchAll(/className="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(classNames.length >= 2, "expected a className on each KO button");
  for (const cls of classNames) {
    assert.doesNotMatch(
      cls,
      /moss/,
      "moss (the success tone) must not style a KO answer — it tells the candidate which answer passes the gate"
    );
  }
});

test("a declined outcome is recoverable in place", () => {
  const src = read("ConversationalApply.tsx");
  assert.match(
    src,
    /done\.result === "declined" \? \(/,
    "the done screen forks on a decline to offer a restart"
  );
  assert.match(src, /onClick=\{restartConversation\}/, "the decline restart reuses the start-over machinery");
  assert.match(src, /t\("declinedRestartNote"\)/, "the restart is honest that the earlier answers are gone");
  assert.match(src, /setDone\(null\)/, "restartConversation clears the done state so the chat actually re-runs");
});

test("the quick form's submit is always live and names what is missing", () => {
  const src = read("quick/QuickApplyForm.tsx");
  assert.match(src, /disabled=\{submitting\}\r?\n\s*className="focus-ring mt-5/, "submit is disabled only while POSTing");
  assert.doesNotMatch(src, /disabled=\{!ready\}/, "the dead !ready-disabled submit is gone");
  assert.match(src, /firstMissingControlId/, "an incomplete submit resolves the first blocking control");
  assert.match(src, /setIncompleteError\(t\("quick\.incompleteHint"\)\)/, "…and raises a localized hint");
  assert.match(src, /incompleteError \? \(\r?\n\s*<p role="alert"/, "the hint renders as an assertive alert");
  assert.match(src, /el\?\.focus\(\);/, "…and moves focus to that control");
  assert.match(src, /el\?\.scrollIntoView\(/, "…and scrolls it into view (KO gates sit below the fold on a phone)");
});

test("the quick form keeps its honeypot and the strict server KO contract untouched", () => {
  const src = read("quick/QuickApplyForm.tsx");
  assert.match(src, /company_url/, "the honeypot field is still posted");
  assert.match(src, /aria-hidden="true"/, "…and still out of the a11y tree");
  // Every KO answer is still gathered client-side before any POST — the server
  // reads an ABSENT key as a fail, so an incomplete form must never reach it.
  assert.match(src, /koSteps\.find\(\(s\) => ko\[s\.id\] === undefined\)/, "an unanswered KO gate still blocks the POST");
});
