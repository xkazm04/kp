// The candidate's feedback-letter card (spark interview-feedback-letter, WP-beta): which
// state of their letter renders which copy, how the request door's answer folds back, and
// that every key the rules can pick is a literal the card renders, in all four catalogs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { foldLetterRequest, statusLetterCopy, statusLetterPhase, type StatusLetterCopyKey, type StatusLetterPhase } from "./statusLetterView.ts";

const BLANK = { canRequest: false, state: null, requestedAt: null, text: null } as const;

test("which state of the letter is which phase", () => {
  assert.equal(statusLetterPhase(undefined), "hidden", "an older status payload with no letter field");
  assert.equal(statusLetterPhase(BLANK), "hidden", "no right to ask and nothing asked — including every consent-withheld page");
  assert.equal(statusLetterPhase({ ...BLANK, canRequest: true }), "offer");
  assert.equal(statusLetterPhase({ ...BLANK, state: "requested", requestedAt: "2026-09-18T10:00:00.000Z" }), "requested");
  assert.equal(statusLetterPhase({ ...BLANK, state: "drafted", requestedAt: "2026-09-18T10:00:00.000Z" }), "preparing", "a draft is being reviewed; the draft itself never reaches this page");
  assert.equal(statusLetterPhase({ ...BLANK, state: "sent", requestedAt: "x", text: "Dear candidate, …" }), "sent");
  assert.equal(statusLetterPhase({ ...BLANK, state: "sent", requestedAt: "x", text: null }), "hidden", "a sent state with no readable text says nothing, never an empty letter");
  assert.equal(statusLetterPhase({ ...BLANK, state: "declined", requestedAt: "x" }), "declined");
});

test("which copy each phase renders — and the email is promised only when a relay exists", () => {
  const expected: Record<StatusLetterPhase, [StatusLetterCopyKey | null, StatusLetterCopyKey | null, StatusLetterCopyKey | null]> = {
    // phase: [body, follow-up with a relay, follow-up without one]
    hidden: [null, null, null],
    offer: ["letter.offer", null, null],
    requested: ["letter.requested", "letter.whenReadyEmail", "letter.whenReadyPage"],
    preparing: ["letter.preparing", "letter.whenReadyEmail", "letter.whenReadyPage"],
    sent: ["letter.sentIntro", null, null],
    declined: ["letter.declined", null, null],
  };
  for (const [phase, [body, withRelay, withoutRelay]] of Object.entries(expected) as [StatusLetterPhase, (typeof expected)[StatusLetterPhase]][]) {
    assert.deepEqual(statusLetterCopy(phase, true), { body, followUp: withRelay }, `${phase} with a relay`);
    assert.deepEqual(statusLetterCopy(phase, false), { body, followUp: withoutRelay }, `${phase} with no relay`);
    // The page's own reading of an absent flag (StatusClient `emailPromised`).
    assert.deepEqual(statusLetterCopy(phase, undefined), { body, followUp: withRelay }, `${phase} with the flag absent`);
  }
});

test("the request door's answer folds back into the card", () => {
  const requested = { canRequest: false, state: "requested", requestedAt: "2026-09-18T10:00:00.000Z", text: null };
  assert.deepEqual(foldLetterRequest({ ok: true, status: 200 }, { ok: true, letter: requested }), { kind: "letter", letter: requested });
  // A repeated click: the existing request's state is as good as a 200 to the candidate.
  assert.deepEqual(foldLetterRequest({ ok: false, status: 409 }, { code: "STATUS_LETTER_ALREADY_REQUESTED", letter: requested }), {
    kind: "letter",
    letter: requested,
  });
  assert.deepEqual(foldLetterRequest({ ok: false, status: 409 }, { code: "STATUS_LETTER_NOT_ELIGIBLE" }), {
    kind: "not_eligible",
    code: "STATUS_LETTER_NOT_ELIGIBLE",
  });
  assert.deepEqual(foldLetterRequest({ ok: false, status: 429 }, { code: "TOO_MANY_REQUESTS" }), { kind: "failed", code: "TOO_MANY_REQUESTS" });
  assert.deepEqual(foldLetterRequest({ ok: false, status: 502 }, "<html>"), { kind: "failed", code: null });
  assert.deepEqual(foldLetterRequest(null, null), { kind: "failed", code: null }, "never landed: said, never silent");
  // A 409 of another kind that happens to carry a letter-like field is not a success.
  assert.equal(foldLetterRequest({ ok: false, status: 409 }, { code: "SOMETHING_ELSE", letter: requested }).kind, "failed");
});

// ---- the copy the rules pick is the copy the card renders --------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");
const cardSrc = readFileSync(path.join(HERE, "StatusLetterCard.tsx"), "utf8");
const ALL_KEYS: StatusLetterCopyKey[] = [
  "letter.offer",
  "letter.requested",
  "letter.preparing",
  "letter.sentIntro",
  "letter.declined",
  "letter.whenReadyEmail",
  "letter.whenReadyPage",
];

test("every key the rules can pick is a literal in the card's copy map", () => {
  for (const key of ALL_KEYS) assert.ok(cardSrc.includes(`"${key}": t("${key}"`), `StatusLetterCard has no literal copy for ${key}`);
});

test("every letter key exists, non-empty, in all four catalogs — and none promises what the page cannot keep", () => {
  for (const locale of ["en", "cs", "de", "fr"]) {
    const letter = (JSON.parse(readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8")) as { status: { letter: Record<string, string> } }).status.letter;
    for (const key of [...ALL_KEYS.map((k) => k.slice("letter.".length)), "title", "request", "requesting", "failed"]) {
      assert.ok(letter[key]?.trim(), `messages/${locale}.json status.letter.${key} is missing`);
    }
    assert.match(letter.requested, /\{date\}/, `${locale}: the requested line names the date`);
  }
  // The source copy (en) states the three promises in words a candidate can hold us to.
  const en = (JSON.parse(readFileSync(path.join(ROOT, "messages", "en.json"), "utf8")) as { status: { letter: Record<string, string> } }).status.letter;
  assert.match(en.offer, /person .* reviews it before it is sent/, "a person reviews the letter before it is sent");
  assert.doesNotMatch(en.whenReadyPage, /email/i, "no email is promised when no relay exists");
  for (const key of ["whenReadyEmail", "whenReadyPage"]) assert.match(en[key], /decides not to send individual feedback, this page will say so/, `${key}: a decline is never silence`);
});
