// Pins the RECIPIENT CASCADE — `candidateRecipient` (comms-dispatch.ts), the
// function that decides every outbound message's `to`: captured contact ▸
// display name ▸ candidate id ▸ the literal "candidate".
//
// comms-recipient.test.ts already pins the ADDRESSABILITY half
// (`isDeliverableAddress`), but nothing pinned the cascade that FEEDS it, and
// the two are not wired together: `candidateRecipient` applies no format check,
// so a bare name, a URL or the last-resort literal is returned verbatim and
// shipped as `to`. With COMMS_WEBHOOK_URL set that dead-letters silently. These
// tests document the cascade as it behaves today and pair each fallback with the
// `isDeliverableAddress` verdict, so the day a format check is added to
// `candidateRecipient` the change shows up here as a test delta rather than as a
// behavior change nobody measured.
//
// Runs against an ISOLATED throwaway DB (testing/unit-db.ts must stay the first
// project import) — `candidateRecipient` itself is pure, but comms-dispatch.ts
// transitively loads the stores.
import { test } from "node:test";
import assert from "node:assert/strict";
import "./testing/unit-db.ts";
import { candidateRecipient } from "./comms-dispatch.ts";
import { isDeliverableAddress } from "./comms-recipient.ts";

test("a captured contact wins the cascade and is a deliverable address", () => {
  const to = candidateRecipient({ contact: "jane@example.com", candidateLabel: "Jane Doe", candidateId: "ent_ab12" });
  assert.equal(to, "jane@example.com");
  assert.equal(isDeliverableAddress(to), true, "the inbound-applicant path is the only one a relay can deliver");
});

test("a contact is trimmed before it is used", () => {
  assert.equal(candidateRecipient({ contact: "  jane@example.com  " }), "jane@example.com");
});

test("a NON-EMAIL contact is returned verbatim — the silent-bounce seam", () => {
  // No format check runs in the cascade, so whatever was captured at apply becomes
  // `to`. Each of these is a value a relay would dead-letter.
  for (const junk of ["John Smith", "https://linkedin.com/in/jsmith", "+420 777 123 456", "ent_ab12"]) {
    const to = candidateRecipient({ contact: junk, candidateLabel: "Jane Doe" });
    assert.equal(to, junk, "the cascade does not validate — it takes the first non-empty value");
    assert.equal(isDeliverableAddress(to), false, `a relay cannot deliver to ${junk}`);
  }
});

test("a whitespace-only contact is falsy after trim and falls through to the label", () => {
  assert.equal(candidateRecipient({ contact: "   ", candidateLabel: "Jane Doe", candidateId: "ent_ab12" }), "Jane Doe");
  assert.equal(candidateRecipient({ contact: "\t\n ", candidateLabel: "Jane Doe" }), "Jane Doe");
});

test("whitespace-only contact AND label fall through to the candidate id", () => {
  const to = candidateRecipient({ contact: " ", candidateLabel: "  ", candidateId: "ent_ab12" });
  assert.equal(to, "ent_ab12");
  assert.equal(isDeliverableAddress(to), false, "an opaque id is an identifier, not an address");
});

test("empty strings fall through exactly like nulls", () => {
  assert.equal(candidateRecipient({ contact: "", candidateLabel: "", candidateId: "ent_ab12" }), "ent_ab12");
  assert.equal(candidateRecipient({ contact: null, candidateLabel: null, candidateId: "ent_ab12" }), "ent_ab12");
});

test("all fields absent resolves to the UNADDRESSABLE literal", () => {
  // Every shape of "nothing" — null, undefined, empty, whitespace, and the empty
  // object — lands on the same last-resort literal.
  for (const entry of [
    {},
    { contact: null, candidateLabel: null, candidateId: null },
    { contact: undefined, candidateLabel: undefined, candidateId: undefined },
    { contact: "", candidateLabel: "", candidateId: "" },
    { contact: " ", candidateLabel: "\t", candidateId: "\n" },
  ]) {
    const to = candidateRecipient(entry);
    assert.equal(to, "candidate");
    assert.equal(isDeliverableAddress(to), false, "the literal is the documented dead-letter case");
  }
});

test("the cascade never returns an empty string", () => {
  // The `to` on the wire is always non-empty — `ref` (the entry id) keeps even the
  // unaddressable case traceable in the Outbox, but a blank `to` would not be.
  for (const entry of [{}, { contact: " " }, { candidateLabel: "" }, { candidateId: "\t" }]) {
    assert.ok(candidateRecipient(entry).length > 0);
  }
});
