// The interview feedback letter STORE (spark interview-feedback-letter, WP-alpha): the record
// WP-beta's review queue, approve/decline doors and delivery code against.
//
// What is pinned:
//   • the request is IDEMPOTENT — one letter per application, and a repeat returns the row
//     untouched (never a second letter, never a re-stamped language or outcome);
//   • every transition is a compare-and-swap on the state it moves from, so a late draft
//     never overwrites a person's decision;
//   • the decider is a HUMAN actor, and the text caps are enforced at the store too;
//   • the review queue is the open letters, oldest first.
//
// unit-db.ts MUST be the first project import.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { LETTER_MAX_CHARS } from "../interview-letter-types.ts";

const {
  interviewLetterApprove,
  interviewLetterById,
  interviewLetterDecidingEvent,
  interviewLetterDecline,
  interviewLetterQueue,
  interviewLetterRecordDelivery,
  interviewLetterRequest,
  interviewLetterSaveDraft,
} = await import("./interview-letters.ts");
const { createPipelineEntry, actOnPipelineEntry, reinstatePipelineEntry } = await import("./pipeline.ts");

after(() => cleanupUnitDb());

const WS = "letters-store-team";

function entry() {
  const suffix = Math.random().toString(36).slice(2, 8);
  return createPipelineEntry({
    candidateId: `c-ils-${suffix}`,
    candidateLabel: "Store Candidate",
    jobId: `job-ils-${suffix}`,
    jobTitle: "QA Engineer",
    stage: "Interview",
    workspaceId: WS,
  }).entry;
}

test("a request is idempotent: one letter per application, and a repeat changes nothing", () => {
  const e = entry();
  const first = interviewLetterRequest({ entryId: e.id, lang: "cs", outcome: "not_selected" }, WS);
  assert.equal(first.created, true);
  assert.equal(first.letter.state, "requested");
  assert.equal(first.letter.lang, "cs");
  assert.equal(first.letter.outcome, "not_selected");
  assert.equal(first.letter.draft, null);
  assert.equal(first.letter.finalText, null);

  const again = interviewLetterRequest({ entryId: e.id, lang: "de", outcome: "hired" }, WS);
  assert.equal(again.created, false);
  assert.equal(again.letter.id, first.letter.id, "the same letter, never a second one");
  assert.equal(again.letter.lang, "cs", "the language resolved at the FIRST request stands");
  assert.equal(again.letter.outcome, "not_selected");
});

test("a CHECK violation is not mistaken for 'already requested'", () => {
  const e = entry();
  assert.throws(
    () => interviewLetterRequest({ entryId: e.id, lang: "en", outcome: "withdrawn" as never }, WS),
    /CHECK constraint/,
    "ON CONFLICT names the uniqueness target only — an off-vocabulary outcome must fail loudly"
  );
});

test("draft → redraft → approve → delivery, each a compare-and-swap on the state it leaves", () => {
  const e = entry();
  const { letter } = interviewLetterRequest({ entryId: e.id, lang: "en", outcome: "hired" }, WS);

  const drafted = interviewLetterSaveDraft(letter.id, { text: "First draft.", source: "template" }, WS)!;
  assert.equal(drafted.state, "drafted");
  assert.deepEqual({ text: drafted.draft?.text, source: drafted.draft?.source }, { text: "First draft.", source: "template" });

  // A recruiter's redraft replaces it while nobody has decided.
  const redrafted = interviewLetterSaveDraft(letter.id, { text: "Second draft.", source: "model" }, WS)!;
  assert.equal(redrafted.draft?.text, "Second draft.");
  assert.equal(redrafted.draft?.source, "model");

  const sent = interviewLetterApprove(letter.id, { finalText: "The letter a person owns.", decidedBy: "human:Petra Nováková" }, WS)!;
  assert.equal(sent.state, "sent");
  assert.equal(sent.finalText, "The letter a person owns.");
  assert.equal(sent.decidedBy, "human:Petra Nováková");
  assert.ok(sent.decidedAt);
  assert.equal(sent.delivery, null, "approval records the decision; delivery is recorded separately");
  assert.equal(sent.draft?.text, "Second draft.", "the draft stays as the record of what was reviewed");

  // A draft that finishes AFTER the decision is dropped, and so is a second decision.
  assert.equal(interviewLetterSaveDraft(letter.id, { text: "Late draft.", source: "model" }, WS), null);
  assert.equal(interviewLetterDecline(letter.id, { decidedBy: "human:Someone Else" }, WS), null);
  assert.equal(interviewLetterById(letter.id, WS)!.finalText, "The letter a person owns.");

  assert.equal(interviewLetterRecordDelivery(letter.id, "queued", WS)!.delivery, "queued");
  assert.equal(interviewLetterRecordDelivery(letter.id, "sent", WS)!.delivery, "sent");
});

test("a decline closes the request — no later approval, no later draft, no delivery", () => {
  const e = entry();
  const { letter } = interviewLetterRequest({ entryId: e.id, lang: "fr", outcome: "not_selected" }, WS);
  const declined = interviewLetterDecline(letter.id, { decidedBy: "human:recruiter" }, WS)!;
  assert.equal(declined.state, "declined");
  assert.equal(declined.decidedBy, "human:recruiter");
  assert.equal(interviewLetterApprove(letter.id, { finalText: "Too late.", decidedBy: "human:recruiter" }, WS), null);
  assert.equal(interviewLetterSaveDraft(letter.id, { text: "Too late.", source: "template" }, WS), null);
  assert.equal(interviewLetterRecordDelivery(letter.id, "sent", WS), null, "only a sent letter has a delivery");
});

test("a recruiter may write the letter by hand when no draft exists (requested → sent)", () => {
  const e = entry();
  const { letter } = interviewLetterRequest({ entryId: e.id, lang: "en", outcome: "not_selected" }, WS);
  const sent = interviewLetterApprove(letter.id, { finalText: "Written by a person.", decidedBy: "human:Jana" }, WS)!;
  assert.equal(sent.state, "sent");
  assert.equal(sent.draft, null);
});

test("the decider must be a human actor, and every stored text honours the cap", () => {
  const e = entry();
  const { letter } = interviewLetterRequest({ entryId: e.id, lang: "en", outcome: "hired" }, WS);
  assert.throws(() => interviewLetterApprove(letter.id, { finalText: "Hi.", decidedBy: "auto:sim" }, WS), TypeError);
  assert.throws(() => interviewLetterDecline(letter.id, { decidedBy: "human:" }, WS), TypeError);
  assert.throws(() => interviewLetterDecline(letter.id, { decidedBy: "" }, WS), TypeError);
  assert.throws(() => interviewLetterSaveDraft(letter.id, { text: "  ", source: "template" }, WS), RangeError);
  assert.throws(() => interviewLetterSaveDraft(letter.id, { text: "x".repeat(LETTER_MAX_CHARS + 1), source: "model" }, WS), RangeError);
  assert.throws(
    () => interviewLetterApprove(letter.id, { finalText: "x".repeat(LETTER_MAX_CHARS + 1), decidedBy: "human:Jana" }, WS),
    RangeError
  );
  assert.equal(interviewLetterById(letter.id, WS)!.state, "requested", "a refused write changed nothing");
});

test("the review queue is every open letter, oldest first", () => {
  const team = "letters-queue-team";
  const make = () =>
    createPipelineEntry({ candidateId: `c-q-${Math.random()}`, candidateLabel: "Q", jobId: "job-q", jobTitle: "Q", stage: "Interview", workspaceId: team }).entry;
  const a = interviewLetterRequest({ entryId: make().id, lang: "en", outcome: "hired" }, team).letter;
  const b = interviewLetterRequest({ entryId: make().id, lang: "en", outcome: "hired" }, team).letter;
  const c = interviewLetterRequest({ entryId: make().id, lang: "en", outcome: "hired" }, team).letter;
  interviewLetterSaveDraft(b.id, { text: "Drafted.", source: "template" }, team);
  interviewLetterDecline(c.id, { decidedBy: "human:recruiter" }, team);
  assert.deepEqual(
    interviewLetterQueue(team).map((l) => l.id),
    [a.id, b.id],
    "requested and drafted letters wait; a decided one does not"
  );
});

test("the deciding event is the NEWEST reject — a reversed one never decides", () => {
  const e = entry();
  assert.equal(interviewLetterDecidingEvent(e.id, WS), null, "a live entry has no deciding event");
  // The machine rejects, a person reverses it, and later a PERSON rejects: the person decided.
  actOnPipelineEntry(e.id, "reject", undefined, { actor: "system" }, WS);
  assert.deepEqual(interviewLetterDecidingEvent(e.id, WS), { kind: "auto_rejected", actor: null });
  assert.ok(reinstatePipelineEntry(e.id, WS, "human:Petra"));
  actOnPipelineEntry(e.id, "reject", undefined, { actor: "human", actorRef: "human:Petra" }, WS);
  assert.deepEqual(interviewLetterDecidingEvent(e.id, WS), { kind: "rejected", actor: "human:Petra" });
});
