// The feedback-letter editor's pure rules (spark interview-feedback-letter, WP-beta): the
// counter shows the cap before the server refuses, a door's answer folds to done or a coded
// failure (never a silent click), a delivery outcome earns only the sentence the outbox
// licenses, and a redraft's phase comes from the task watcher without ever blocking.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LETTER_MAX_CHARS } from "../../../_lib/interview-letter-types.ts";
import { deliveryNotice, failureStalesQueue, foldLetterDoor, letterLength, redraftPhase } from "./feedbackLetterEditorLogic.ts";

test("the counter counts what will be stored, and names the overshoot before any refusal", () => {
  assert.deepEqual(letterLength("  Hello.  "), { length: 6, max: LETTER_MAX_CHARS, over: 0, problem: null });
  assert.equal(letterLength("   ").problem, "empty");
  const over = letterLength("x".repeat(LETTER_MAX_CHARS + 7));
  assert.equal(over.over, 7);
  assert.equal(over.problem, "too_long");
  assert.equal(letterLength("x".repeat(LETTER_MAX_CHARS)).problem, null, "exactly at the cap is allowed");
});

test("a door's answer: ok only on the door's own ok:true, every other shape a coded failure", () => {
  const approved = foldLetterDoor(
    { ok: true, status: 200 },
    { ok: true, letter: { id: "il-1", state: "sent" }, delivery: { delivery: "queued", suppressed: false, readableOnStatusPage: true, recorded: true } }
  );
  assert.deepEqual(approved, { ok: true, delivery: { delivery: "queued", suppressed: false, readableOnStatusPage: true }, taskId: null });
  assert.deepEqual(foldLetterDoor({ ok: true, status: 200 }, { ok: true, taskId: "t-9" }), { ok: true, delivery: null, taskId: "t-9" });

  assert.deepEqual(foldLetterDoor({ ok: false, status: 409 }, { code: "FEEDBACK_LETTER_MOVED", state: "sent" }), {
    ok: false,
    failure: { code: "FEEDBACK_LETTER_MOVED", status: 409, capability: null, state: "sent" },
  });
  assert.deepEqual(foldLetterDoor({ ok: false, status: 403 }, { code: "FORBIDDEN_CAPABILITY", capability: "pipeline:write" }), {
    ok: false,
    failure: { code: "FORBIDDEN_CAPABILITY", status: 403, capability: "pipeline:write", state: null },
  });
  // A 2xx that is not the door's shape (a proxy page, an empty body) claims nothing.
  assert.equal(foldLetterDoor({ ok: true, status: 200 }, null).ok, false);
  assert.equal(foldLetterDoor({ ok: true, status: 200 }, "<html>").ok, false);
  // Never landed: no code, no status — and still a failure, never a silent no-op.
  assert.deepEqual(foldLetterDoor(null, null), { ok: false, failure: { code: null, status: null, capability: null, state: null } });
  // An unknown delivery word is not read as a delivery.
  assert.deepEqual(foldLetterDoor({ ok: true, status: 200 }, { ok: true, delivery: { delivery: "delivered" } }), { ok: true, delivery: null, taskId: null });
});

test("only a moved or missing letter makes the list stale", () => {
  assert.equal(failureStalesQueue({ code: "FEEDBACK_LETTER_MOVED", status: 409 }), true);
  assert.equal(failureStalesQueue({ code: "FEEDBACK_LETTER_NOT_FOUND", status: 404 }), true);
  assert.equal(failureStalesQueue({ code: "FEEDBACK_LETTER_TEXT_TOO_LONG", status: 400 }), false);
  assert.equal(failureStalesQueue({ code: null, status: null }), false);
});

test("the delivery sentence is the outbox's truth: never 'sent' unless the relay accepted it", () => {
  const cases: [Parameters<typeof deliveryNotice>[0], ReturnType<typeof deliveryNotice>][] = [
    [{ delivery: "sent", suppressed: false, readableOnStatusPage: true }, { email: "doneSent", page: "doneReadable" }],
    [{ delivery: "queued", suppressed: false, readableOnStatusPage: true }, { email: "doneQueued", page: "doneReadable" }],
    [{ delivery: "failed", suppressed: false, readableOnStatusPage: true }, { email: "doneFailed", page: "doneReadable" }],
    // Suppressed is its own sentence, whatever word the row carries.
    [{ delivery: "failed", suppressed: true, readableOnStatusPage: true }, { email: "doneSuppressed", page: "doneReadable" }],
    [{ delivery: "failed", suppressed: true, readableOnStatusPage: false }, { email: "doneSuppressed", page: "doneUnreadable" }],
  ];
  for (const [outcome, expected] of cases) assert.deepEqual(deliveryNotice(outcome), expected, JSON.stringify(outcome));
});

test("a redraft's phase comes from the task watcher", () => {
  const idle = { status: null, active: false, loading: false, full: null, resultUnavailable: false };
  assert.equal(redraftPhase(null, idle), "idle");
  assert.equal(redraftPhase("t-1", idle), "running", "not yet on the poll");
  assert.equal(redraftPhase("t-1", { ...idle, status: "queued", active: true }), "running");
  assert.equal(redraftPhase("t-1", { ...idle, status: "succeeded", loading: true }), "running", "result still being fetched");
  assert.equal(redraftPhase("t-1", { ...idle, status: "succeeded", full: { result: { saved: true } } }), "saved");
  assert.equal(redraftPhase("t-1", { ...idle, status: "succeeded", full: { result: { saved: false } } }), "notSaved");
  assert.equal(redraftPhase("t-1", { ...idle, status: "failed" }), "failed");
  assert.equal(redraftPhase("t-1", { ...idle, status: "interrupted" }), "failed");
  assert.equal(redraftPhase("t-1", { ...idle, status: "succeeded", resultUnavailable: true }), "unknown", "never a spinner that does not end");
});

// ---- the editor's copy: every sentence it can pick exists in all four catalogs ----------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..", "..");
const editorSrc = readFileSync(path.join(HERE, "DecisionsFeedbackLetterEditor.tsx"), "utf8");

test("every delivery sentence deliveryNotice can pick is a literal the editor renders, in all four catalogs", () => {
  const keys = ["doneSent", "doneQueued", "doneFailed", "doneSuppressed", "doneReadable", "doneUnreadable"];
  for (const key of keys) assert.ok(editorSrc.includes(`${key}: t("editor.${key}")`), `the editor's noticeCopy literal must carry ${key}`);
  for (const locale of ["en", "cs", "de", "fr"]) {
    const editor = (JSON.parse(readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8")) as {
      decisions: { feedbackLetters: { editor: Record<string, string> } };
    }).decisions.feedbackLetters.editor;
    for (const key of [...keys, "rule", "count", "over", "doneUnknown", "doneClosed", "declineConfirm", "declineConfirmCloseOnly", "redraftNote"]) {
      assert.ok(editor[key]?.trim(), `messages/${locale}.json decisions.feedbackLetters.editor.${key} is missing`);
    }
  }
});

test("the editor states the rule and the cap in the editor itself, before any refusal", () => {
  assert.match(editorSrc, /t\("editor\.rule"\)/, "the one-line rule: competencies, never a quote, never a score");
  assert.match(editorSrc, /t\("editor\.count", \{ count: length\.length, max: length\.max \}\)/, "the counter shows the cap");
  assert.match(editorSrc, /disabled=\{busy !== null \|\| length\.problem !== null\}/, "approve is disabled while the text cannot be stored");
});
