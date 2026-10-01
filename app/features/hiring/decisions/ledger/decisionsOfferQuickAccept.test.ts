// Pins that an offer-row quick-accept cannot mint an offer without a chosen TTL.
// Batch already excludes offers; the quick-accept door used defaultOfferTtlDays() via
// act(entry, "accept") with no ttlDays. Hide the icon so the modal deadline lever is the only
// accept door. The Docket board (docket/DocketBoard.tsx) owns the row now.
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

test("the board hides quick-accept on offer rows so accept cannot fire without a TTL", () => {
  const board = source("../docket/DocketBoard.tsx");
  assert.match(board, /row\.kind === "offer" \? null/, "offer rows must not render the quick-accept icon");
  const acceptAt = board.indexOf('data-sim-click="accept"');
  const guardAt = board.indexOf('row.kind === "offer" ? null');
  assert.ok(acceptAt > -1, "non-offer rows still have a quick-accept door");
  assert.ok(guardAt > -1 && guardAt < acceptAt, "the offer guard must wrap the accept button");
  assert.equal(board.includes("defaultOfferTtlDays"), false, "the board must not mint a default deadline");
});

test("the board still wires accept without ttlDays, which is why offer rows hide the icon", () => {
  const board = source("../docket/DocketBoard.tsx");
  assert.match(board, /h\.act\(entry, "accept"\)/, "the row still calls act(accept) with no ttlDays");
});
