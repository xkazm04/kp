// Pins that the empty-state reconsider line is an action that opens the
// reconsider queue, matching the header chip's revealReconsider hop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function source(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

test("the empty-state reconsider line calls revealReconsider on click", () => {
  const handoff = source("./DecisionsEmptyHandoff.tsx");
  assert.match(handoff, /onClick=\{onRevealReconsider\}/, "the reconsider line must be a button that reveals the queue");
  assert.match(handoff, /<button/, "the line is an action, not a caption");
  assert.equal(/\s<p[\s>]/.test(handoff.slice(handoff.indexOf("reconsiderCount > 0"))), false, "the reconsider mention must not stay a static <p>");
});

test("DecisionsTab wires onRevealReconsider to revealReconsider", () => {
  const tab = source("./DecisionsTab.tsx");
  assert.match(tab, /<DecisionsEmptyHandoff/, "the caught-up branch still renders the empty handoff");
  assert.match(tab, /onRevealReconsider=\{revealReconsider\}/, "the tab must pass the existing revealReconsider hop");
});
