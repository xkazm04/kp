// LINK RECOVERY FOR A RETURNING APPLICANT — the pure half.
//
// A repeat application matched on name/email alone is UNPROVEN: the capability
// gate (app/api/apply/[id]/route.ts, quick/route.ts) rightly hands that caller no
// tokens. The route's own comment promised the real candidate a way back — "the
// enrichment link is re-sent to the address on file" — and nothing did it. These
// cases pin the two decisions that make the re-send safe:
//   - WHETHER to send (only to an address already on the entry, never to an
//     anonymized record, at most once per cooldown window);
//   - WHAT the caller is told, chosen WITHOUT reading whether an address exists,
//     so the response cannot be used to probe for one.
// The route-level cases (outbox rows, cooldown, no entry writes) live in
// app/api/apply/[id]/reapply-capability-gate.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideLinkRecovery, recoveryMessageKey, LINK_RECOVERY_THROTTLE, linkRecoveryKey } from "./apply-link-recovery.ts";

const base = { contact: "dana@x.invalid", anonymized: false, throttled: false, relayConfigured: true };

test("decideLinkRecovery sends only to an address on file, never to an anonymized record, never inside the cooldown", () => {
  assert.deepEqual(decideLinkRecovery(base), { send: true });
  assert.deepEqual(decideLinkRecovery({ ...base, contact: null }), { send: false, reason: "no_contact" });
  assert.deepEqual(decideLinkRecovery({ ...base, contact: "   " }), { send: false, reason: "no_contact" });
  assert.deepEqual(decideLinkRecovery({ ...base, anonymized: true }), { send: false, reason: "anonymized" });
  assert.deepEqual(decideLinkRecovery({ ...base, throttled: true }), { send: false, reason: "cooldown" });
});

test("the response copy key never depends on whether an address is on file", () => {
  // Same key for an entry WITH a contact and one WITHOUT: the only input is the relay.
  assert.equal(recoveryMessageKey(true), "alreadyMessageRecover");
  assert.equal(recoveryMessageKey(false), "alreadyMessageNoRelay");
  // Structural: the function takes ONE argument, so it cannot be handed the contact.
  assert.equal(recoveryMessageKey.length, 1);
});

test("the cooldown is one send per entry per 24h, keyed on the entry (not the caller)", () => {
  assert.deepEqual(LINK_RECOVERY_THROTTLE, { limit: 1, windowMs: 24 * 60 * 60_000 });
  assert.equal(linkRecoveryKey("pe-123"), "apply-links:pe-123");
});
