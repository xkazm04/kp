import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The relay card is the ONE place in the product where the outbound-delivery
// capability changes at runtime. When a save lands (or a 409 hands back a newer
// stored config) it must tell the capability cache — every "sent"/"queued" surface
// reads it — and the live-refresh bus, so the Comms ledger's "relay not configured"
// alert re-reads instead of contradicting the card's own On badge.

const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "ChannelsRelayConfigCard.tsx"),
  "utf8"
);

/** The text of the `{ … }` block that opens right after `marker`. */
function blockAfter(marker: string): string {
  const at = src.indexOf(marker);
  assert.ok(at >= 0, `marker not found: ${marker}`);
  const open = src.indexOf("{", at + marker.length - 1);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`unbalanced block after ${marker}`);
}

test("the successful save announces the capability change", () => {
  const ok = blockAfter("if (r.ok && d?.config) {");
  assert.match(ok, /invalidateCommsCapability\(\)/);
  assert.match(ok, /notifyDataChanged\(\)/);
});

test("the 409 adopt announces the capability change too", () => {
  const conflict = blockAfter("if (r.status === 409) {");
  assert.match(conflict, /invalidateCommsCapability\(\)/);
  assert.match(conflict, /notifyDataChanged\(\)/);
});
