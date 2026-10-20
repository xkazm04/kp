// P2-2: bulk scheduling-invite id coercion.
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { BULK_INVITE_CAP, coerceBulkEntryIds, partitionBulkInviteTargets } from "./bulk-invite.ts";

test("keeps order, trims, drops blanks + non-strings", () => {
  assert.deepEqual(coerceBulkEntryIds([" a ", "b", "", "  ", 5, null, "c"]), ["a", "b", "c"]);
});

test("dedupes (first occurrence wins, post-trim)", () => {
  assert.deepEqual(coerceBulkEntryIds(["a", "a", " a ", "b"]), ["a", "b"]);
});

test("caps at the limit", () => {
  const many = Array.from({ length: BULK_INVITE_CAP + 25 }, (_, i) => `e${i}`);
  const out = coerceBulkEntryIds(many);
  assert.equal(out.length, BULK_INVITE_CAP);
  assert.equal(out[0], "e0");
  const small = coerceBulkEntryIds(["x", "y", "z"], 2);
  assert.deepEqual(small, ["x", "y"]);
});

test("non-array input → empty", () => {
  assert.deepEqual(coerceBulkEntryIds(null), []);
  assert.deepEqual(coerceBulkEntryIds("a,b,c"), []);
  assert.deepEqual(coerceBulkEntryIds(undefined), []);
});

test("partitionBulkInviteTargets: a real address is inviteable; names and the literal candidate are not", () => {
  const jane = { contact: "jane@example.com", candidateLabel: "Jane Doe", candidateId: "ent_ab12" };
  const named = { candidateLabel: "Jane Doe", candidateId: "ent_ab12" };
  const idOnly = { candidateId: "ent_ab12" };
  const literal = {};
  const { inviteable, unaddressable, overflow } = partitionBulkInviteTargets([jane, named, idOnly, literal]);
  assert.deepEqual(inviteable, [jane]);
  assert.deepEqual(unaddressable, [named, idOnly, literal]);
  assert.deepEqual(overflow, []);
});

test("partitionBulkInviteTargets: the cap splits inviteable overflow, not unaddressable", () => {
  const a = { contact: "a@example.com" };
  const b = { contact: "b@example.com" };
  const c = { contact: "c@example.com" };
  const named = { candidateLabel: "No Mail" };
  const { inviteable, unaddressable, overflow } = partitionBulkInviteTargets([a, named, b, c], 2);
  assert.deepEqual(inviteable, [a, b]);
  assert.deepEqual(unaddressable, [named]);
  assert.deepEqual(overflow, [c]);
});

// challenge-r09 comms-locale-optout/A — the planner asks the ONE recipient cascade
// (comms-recipient.ts) instead of a private copy, and a SEND-GATE refusal is its own
// bucket, never folded into "unaddressable" and never into "inviteable".
test("bulk-invite.ts declares no recipient cascade of its own", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./bulk-invite.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /function bulkInviteRecipient/, "the private cascade copy is gone");
  assert.doesNotMatch(src, /\.trim\(\) \|\| \(entry\.candidateLabel/, "no inline copy of the cascade either");
  assert.match(src, /resolveCandidateRecipient/, "it resolves through comms-recipient.ts");
});

test("partitionBulkInviteTargets: a send-gate refusal lands in `suppressed`, not in inviteable", () => {
  const ok = { id: "ok", contact: "ok@example.com" };
  const lapsed = { id: "lapsed", contact: "lapsed@example.com" };
  const named = { id: "named", contact: null, candidateLabel: "Jane Doe" };
  const verdictOf = (e: { id: string }) =>
    e.id === "lapsed" ? ({ ok: false, reason: "consent_expired", code: "COMMS_SUPPRESSED" } as const) : null;
  const { inviteable, unaddressable, suppressed } = partitionBulkInviteTargets([ok, lapsed, named], BULK_INVITE_CAP, verdictOf);
  assert.deepEqual(inviteable.map((e) => e.id), ["ok"]);
  assert.deepEqual(unaddressable.map((e) => e.id), ["named"]);
  assert.deepEqual(suppressed.map((e) => e.id), ["lapsed"]);
});
