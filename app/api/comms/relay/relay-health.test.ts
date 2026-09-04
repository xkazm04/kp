// The relay READ carries a health word, and the card paints it.
//
// WHY: an undecryptable signing secret used to reach the Channels tab as the same
// "Not configured" pill an empty install shows, so an operator who had rotated
// KP_SECRET saw no difference between "you never wired a relay" and "your relay is
// wired and we cannot sign for it". The word is minted once (comms-relay.relayHealth)
// and travels: route → card.
//
// The handler needs a request scope the unit runner cannot give it, so the contract
// is asserted on the SOURCE — the shape rate-limit-contract.test.ts established and
// relay-version.test.ts already uses for this route.
//
// NON-VACUITY: every assertion below fails against the route/card as they stood
// before the health field existed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

test("GET answers the health word from the resolver, not from the stored url", () => {
  const src = read("./route.ts");
  assert.match(src, /relayHealth/, "the route imports the resolver's health");
  assert.match(src, /relay:\s*relayHealth\(\)/, "…and puts it on the wire as `relay`");
});

test("the card distinguishes 'unreadable' from 'off'", () => {
  const src = read("../../../features/hiring/channels/ChannelsRelayConfigCard.tsx");
  assert.match(src, /"unreadable"/, "the card knows the state exists");
  assert.match(src, /statusUnreadable/, "…shows its own badge label, not statusOff");
  assert.match(src, /unreadableNote/, "…and explains what to do about it");
});
