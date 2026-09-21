// Pins that an offer-row quick-accept cannot mint an offer without a chosen TTL.
// Batch already excludes offers; the ledger ✓ used defaultOfferTtlDays() via
// act(entry, "accept") with no ttlDays. Hide the icon so the modal deadline
// lever is the only accept door.
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

test("DecisionCell hides quick-accept on offer rows so onAccept cannot fire without a TTL", () => {
  const cells = source("./LedgerCells.tsx");
  assert.match(cells, /row\.kind === "offer" \? null/, "offer rows must not render the quick-accept icon");
  const acceptAt = cells.indexOf('data-sim-click="accept"');
  const guardAt = cells.indexOf('row.kind === "offer" ? null');
  assert.ok(acceptAt > -1, "non-offer rows still have a quick-accept door");
  assert.ok(guardAt > -1 && guardAt < acceptAt, "the offer guard must wrap the accept button");
  assert.equal(cells.includes("defaultOfferTtlDays"), false, "the cell must not mint a default deadline");
});

test("the ledger still wires onAccept without ttlDays, which is why offer rows hide the icon", () => {
  const ledger = source("./DecisionsLedger.tsx");
  assert.match(ledger, /onAccept=\{\(\) => act\(entry, "accept"\)\}/, "the row still calls act(accept) with no ttlDays");
});
