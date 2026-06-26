import { test } from "node:test";
import assert from "node:assert/strict";
import { isDeliverableAddress, extractDeliverableAddress, extractRecipientName } from "./comms-recipient.ts";

test("isDeliverableAddress accepts a well-formed single address", () => {
  assert.equal(isDeliverableAddress("jane@example.com"), true);
  assert.equal(isDeliverableAddress("  jane.doe+tag@sub.example.co.uk  "), true);
});

test("isDeliverableAddress rejects the values candidateRecipient falls back to", () => {
  // Display name, opaque id, and the last-resort literal — all dead-letter on a real relay.
  assert.equal(isDeliverableAddress("Jane Doe"), false);
  assert.equal(isDeliverableAddress("ent_ab12cd"), false);
  assert.equal(isDeliverableAddress("candidate"), false);
  assert.equal(isDeliverableAddress("Candidate"), false); // case-insensitive literal
});

test("isDeliverableAddress rejects malformed / empty / multi-token", () => {
  assert.equal(isDeliverableAddress(""), false);
  assert.equal(isDeliverableAddress(null), false);
  assert.equal(isDeliverableAddress(undefined), false);
  assert.equal(isDeliverableAddress("jane@localhost"), false); // no dot in domain
  assert.equal(isDeliverableAddress("@example.com"), false); // empty local part
  assert.equal(isDeliverableAddress("jane@ex ample.com"), false); // whitespace
  assert.equal(isDeliverableAddress("jane@a@b.com"), false); // two @
});

test("extractDeliverableAddress pulls an address out of a Name <email> free-text", () => {
  assert.equal(extractDeliverableAddress("Alice Ng <alice@co.com>"), "alice@co.com");
  assert.equal(extractDeliverableAddress("alice@co.com"), "alice@co.com");
  assert.equal(extractDeliverableAddress("Alice, alice@co.com"), "alice@co.com");
});

test("extractDeliverableAddress returns null for a name-only field", () => {
  assert.equal(extractDeliverableAddress("Alice Ng"), null);
  assert.equal(extractDeliverableAddress(""), null);
  assert.equal(extractDeliverableAddress(null), null);
});

test("extractRecipientName strips the address and keeps the human name", () => {
  assert.equal(extractRecipientName("Alice Ng <alice@co.com>"), "Alice Ng");
  assert.equal(extractRecipientName("Alice Ng"), "Alice Ng");
  assert.equal(extractRecipientName("alice@co.com"), null); // address only → no name
  assert.equal(extractRecipientName(""), null);
});
