// The offer letter's data -> parts mapping (Gate 2 kit view), pinned.
// Runner: Node's built-in test runner with type stripping.  npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { offerKitDeadline, offerKitHead, offerKitPhase, offerKitTerms, type OfferKitInput } from "./offerKitModel.ts";

const base: OfferKitInput = {
  company: "Česká spořitelna",
  jobTitle: "Junior Analytics Engineer",
  candidateLabel: "Adam Sedláček",
  currency: "CZK",
  salary: 53000,
  notes: null,
  startDate: null,
  expiresAt: "2026-10-01T12:00:00.000Z",
  hoursRemaining: 120,
  minutesRemaining: 7200,
};

test("the lower half is the decision until the server records an outcome, then that outcome", () => {
  assert.equal(offerKitPhase(null), "decide");
  assert.equal(offerKitPhase("accepted"), "accepted");
  assert.equal(offerKitPhase("declined"), "declined");
  assert.equal(offerKitPhase("expired"), "expired");
});

test("the head: the role is the title, with today's two fallbacks, and the candidate is the context", () => {
  assert.deepEqual(offerKitHead(base), {
    company: "Česká spořitelna",
    title: { key: "jobTitle", text: "Junior Analytics Engineer" },
    preparedFor: "Adam Sedláček",
  });
  assert.deepEqual(offerKitHead({ ...base, jobTitle: null }).title, { key: "roleAt", company: "Česká spořitelna" });
  const bare = offerKitHead({ ...base, jobTitle: null, company: null, candidateLabel: null });
  assert.deepEqual(bare, { company: null, title: { key: "roleGeneric" }, preparedFor: null });
});

test("the terms: salary with its OWN currency (never an invented one), blank notes and dates omitted", () => {
  assert.deepEqual(offerKitTerms(base), { salary: { value: 53000, unit: "CZK" }, startDate: null, notes: null });
  assert.deepEqual(offerKitTerms({ ...base, currency: null }).salary, { value: 53000, unit: null });
  assert.equal(offerKitTerms({ ...base, salary: null }).salary, null);
  // a zero salary is a stated figure, not an absence
  assert.deepEqual(offerKitTerms({ ...base, salary: 0 }).salary, { value: 0, unit: "CZK" });
  const t = offerKitTerms({ ...base, notes: "  Hybrid, 3 days on site  ", startDate: " 2026-11-01 " });
  assert.equal(t.notes, "Hybrid, 3 days on site");
  assert.equal(t.startDate, "2026-11-01");
  assert.equal(offerKitTerms({ ...base, notes: "   ", startDate: "" }).notes, null);
});

test("the deadline: needs the server's hours AND a deadline; coral inside 48h; minutes inside the last hour", () => {
  assert.deepEqual(offerKitDeadline(base), { urgent: false, unit: "hours", hours: 120 });
  assert.deepEqual(offerKitDeadline({ ...base, hoursRemaining: 48, minutesRemaining: 2880 }), { urgent: true, unit: "hours", hours: 48 });
  assert.deepEqual(offerKitDeadline({ ...base, hoursRemaining: 0, minutesRemaining: 42 }), { urgent: true, unit: "minutes", minutes: 42 });
  assert.equal(offerKitDeadline({ ...base, hoursRemaining: null }), null);
  assert.equal(offerKitDeadline({ ...base, expiresAt: null }), null);
  // a null minutes figure keeps the hours line
  assert.deepEqual(offerKitDeadline({ ...base, hoursRemaining: 3, minutesRemaining: null }), { urgent: true, unit: "hours", hours: 3 });
});
