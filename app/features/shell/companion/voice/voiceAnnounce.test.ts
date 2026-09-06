// What voice mode ANNOUNCES, pinned at the source.
//
// The strip is the whole reading surface in this mode, so its live region is not
// marginalia: it is how an answer arrives for anyone not watching the top of the
// screen. Three things were wrong and none of them is reachable from node:test
// (no DOM, a client tree), so each is pinned as a property of the markup that
// produces it.
//
// Line endings are normalized first: this checkout is CRLF and the worktree may
// be LF, and a `^`/`$`-free regex still trips over the difference in a template
// literal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (file: string) =>
  readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

/** The file with its comments blanked, so a `doesNotMatch` reads MARKUP and not
 *  the paragraph explaining why the markup is the way it is. Every one of these
 *  decisions is documented at its site in the very words the assertion searches
 *  for, and a scanner that cannot tell the two apart is one that fails the moment
 *  somebody writes down the reason. */
const markup = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");

test("the live region is PERMANENT — its children swap, it never mounts with its content", () => {
  const ticker = markup("./CompanionVoiceTicker.tsx");
  // The bug: `aria-live` lived on `VoiceProse`, which is the thing that appears.
  // A region inserted together with its first content is not announced by any
  // screen reader, so the FIRST answer of a session was silent and only the
  // second onward were read. The wrapper that holds prose / busy / empty is on
  // screen from mount, so a swap inside it is a change to an existing region.
  assert.match(
    ticker,
    /aria-live="polite"[\s\S]{0,200}\{entry \? <VoiceProse/,
    "the wrapper around the prose/busy/empty swap must carry aria-live",
  );

  const parts = markup("./VoiceParts.tsx");
  assert.doesNotMatch(parts, /aria-live/, "…and no piece inside it may declare a second one");
  // `role="status"` IS a live region. Nested inside the wrapper it announced the
  // same sentence twice on some readers and split it on others.
  assert.doesNotMatch(parts, /role="status"/, "the busy note is inside the region now, so it must not be one");
});

test("a failure is an alert, and a refused proposal is answered BESIDE its card", () => {
  const ticker = markup("./CompanionVoiceTicker.tsx");
  // The thread error line was a plain paragraph: it appeared under a strip the
  // operator is deliberately not looking at, and nothing said so.
  assert.match(ticker, /role="alert"/, "the thread error line must be an alert region");
  // And the proposal failure was not on this surface AT ALL — `proposalError`
  // reached the dock's card and voice mode's card was rendered without it, so
  // pressing Accept on a throttled server left the card re-armed and silent.
  assert.match(ticker, /proposalError=\{proposalError\}/, "the ticker must hand the proposal failure to the proposals");

  const parts = markup("./VoiceParts.tsx");
  assert.match(
    parts,
    /error=\{proposalError\?\.id === proposal\.id \? proposalError\.code : null\}/,
    "…and only the card whose own answer failed may show it",
  );

  const mode = markup("./CompanionVoiceMode.tsx");
  assert.match(mode, /proposalError=\{thread\.proposalError\}/, "which comes from the thread, never re-derived");
});
