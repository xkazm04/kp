// The two PUBLIC apply submissions are anonymous-facing, and both sit on
// better-sqlite3, a Python profile-build subprocess, an fs temp write and the
// comms dispatcher. Their catch blocks used to return the raw `err.message`,
// which for that stack means SQLITE_* codes, absolute db/temp paths and Python
// tracebacks handed to whoever POSTed. The sibling /api/status token route
// already answers generically via safeJsonError; these now do the same.
//
// Source-contract test (the repo pattern — see quick-apply-status-link.test.ts):
// importing the routes or api-response.ts would pull in `next/server`, which the
// unit runner cannot resolve, so the contract is pinned over the source instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(HERE, rel), "utf8");

test("both public apply routes answer their 500 through safeJsonError", () => {
  for (const [rel, tag] of [
    ["[id]/route.ts", "api:apply"],
    ["[id]/quick/route.ts", "api:apply:quick"],
  ] as const) {
    const src = read(rel);
    assert.match(src, new RegExp(`safeJsonError\\(error, "${tag}", "APPLY_FAILED"\\)`), `${rel} must use the safe 500 responder`);
    // The leak itself: a thrown error's own message shaped into a client envelope.
    assert.ok(
      !/NextResponse\.json\(\s*\{\s*error:[^}]*instanceof Error\s*\?/.test(src),
      `${rel} still shapes a thrown error's message into a response body`
    );
  }
});

test("safeJsonError's body is the generic message + code — the raw error only reaches the log", () => {
  const src = readFileSync(path.join(HERE, "..", "..", "_lib", "api-response.ts"), "utf8");
  assert.match(
    src,
    /export function safeJsonError\([\s\S]*?\)\s*:\s*NextResponse\s*\{\s*console\.error\([^)]*\);\s*return NextResponse\.json\(\{ error: STORE_ERRORS\[code\], code \}, \{ status \}\);/,
    "the safe responder must log the raw error and return ONLY the generic message + code"
  );
  assert.match(src, /APPLY_FAILED: "[^"]+"/, "APPLY_FAILED is a generic, client-safe message in the shared catalog");
  // Non-vacuity: the leaky sibling still exists (jsonError forwards err.message),
  // so the assertion above is about which one the apply routes chose.
  assert.match(src, /export function jsonError[\s\S]*?err instanceof Error \? err\.message/, "jsonError is still the message-forwarding variant");
});

// ---------------------------------------------------------------------------
// The OTHER thing these public responses must not leak: another applicant's
// CAPABILITY TOKENS. Both routes detect a repeat application from the submitted
// name/email alone — neither is a secret — so a duplicate response is answering a
// caller we cannot authenticate. It used to hand that caller the matched entry's
// `statusToken` (which opens /status/<token>: live stage + the AI-Act decision
// history, an auto-reject's score-vs-threshold included) and its `leadToken` /
// `followupToken` (which open /apply/<job>?lead=<token> with the person's name and
// email prefilled, and authorize the profile follow-up POST). Guarded here because
// this is the same class as the error-message leak above: a public response
// carrying something the caller did not prove they own.
// ---------------------------------------------------------------------------

test("the quick-apply DUPLICATE response carries no capability token", () => {
  const quick = read("[id]/quick/route.ts");
  const dup = /if \(outcome\.duplicate\) \{([\s\S]*?)\n    \}/.exec(quick);
  assert.ok(dup, "expected the duplicate branch of the quick-apply response");
  assert.doesNotMatch(
    dup[1],
    /Token/,
    "an email address is not proof of identity — a duplicate response must not return the matched entry's tokens"
  );
  // …and the fresh branch still does (the request that actually filed the entry).
  assert.match(quick, /statusToken,/, "a FRESH quick-apply accept still carries its own status token");
});

test("the conversational re-apply response gates its tokens on proven ownership", () => {
  const conversational = read("[id]/route.ts");
  const fn = /function acknowledgeReapply\([\s\S]*?\n\}/.exec(conversational);
  assert.ok(fn, "expected the acknowledgeReapply helper");
  assert.doesNotMatch(
    fn[0],
    /^\s+statusToken:/m,
    "the status token must not be emitted unconditionally — a name-only match is not proof of ownership"
  );
  assert.match(
    fn[0],
    /proven \? \{ statusToken: safeStatusLink\(entryId\), \.\.\.followup \} : \{\}/,
    "tokens (status + the follow-up capability) ride only for a proven caller"
  );
  // Proof is the ?lead= capability token resolving to THIS entry — the emailed
  // enrichment walk, which must keep working — never the submitted name/email.
  // The unproven duplicate now RETURNS before the merge (the write gate,
  // behaviourally pinned by [id]/reapply-capability-gate.test.ts), so the only
  // acknowledgeReapply call left in that branch is the tokenless early exit.
  assert.match(
    conversational,
    /if \(!leadEntry\) \{[\s\S]{0,600}?acknowledgeReapply\(existing\.id, t\("alreadyMessage"\), \[\], false, workspaceId, \{\}, false\);/,
    "a duplicate without the lead token must return the tokenless acknowledgement BEFORE any merge"
  );
  // The event is a write too, so it rides the same proof.
  assert.match(
    fn[0],
    /if \(proven\) recordAutomationEvent\(entryId, "re_applied"/,
    "an unproven repeat must not write a `re_applied` line onto the matched person's timeline"
  );
});

test("every validation refusal on both doors carries a CODE, not English prose", () => {
  // This test used to assert the OPPOSITE — that the hand-written English
  // sentences ("Your name is too long.") stayed in the routes. They were
  // client-safe, but they were also the only thing the door had to show: with no
  // `code`, useErrorMessage fell through to the generic "something went wrong" in
  // all four languages, on a PUBLIC surface a candidate reaches in their own. The
  // copy now lives in REFUSAL_ERRORS (canonical English for the log and for API
  // consumers) and the client renders `errors.<CODE>` instead.
  const refusals = readFileSync(path.join(HERE, "..", "..", "_lib", "api-response.ts"), "utf8");
  for (const rel of ["[id]/route.ts", "[id]/quick/route.ts"] as const) {
    const src = read(rel);
    // ZERO bare `{ error: … }` bodies now remain on either door.
    const bare = [...src.matchAll(/NextResponse\.json\(\{ error: ([^,}]+)/g)].map((m) => m[1].trim());
    // Two survivors were retired in turn. The throttle was a codeless
    // `{ error: RATE_LIMITED_ERROR }` and now answers `jsonRefusal("TOO_MANY_REQUESTS",
    // 429)` like every other limited route (rate-limit-contract.test.ts owns that
    // contract). The last one was the closed-role 410, whose message WAS localized
    // server-side from the `apply` catalog — which reads correct and was not: the
    // client resolves what it renders from the CODE (applySubmitFailure →
    // useErrorMessage), so a bodied sentence with no code fell through to the generic
    // "something went wrong" in all four languages. It is now APPLY_ROLE_CLOSED; the
    // PAGE gate still renders t("roleClosed"), which is a different surface.
    assert.deepEqual(bare, [], `${rel} still answers a validation refusal with a codeless body`);
    for (const [, code] of src.matchAll(/jsonRefusal\("([A-Z_]+)"/g)) {
      assert.ok(new RegExp(`\n  ${code}:`).test(refusals), `${code} is not declared in REFUSAL_ERRORS`);
    }
  }
});

test("a refusal that names a field carries the cap as DATA", () => {
  // "Too long" that cannot say how long is a dead end on a public door: the
  // number is interpolated into the localized message, so it rides beside the
  // code rather than being baked into an English sentence.
  const src = read("[id]/route.ts");
  assert.match(src, /jsonRefusal\("APPLY_NAME_TOO_LONG", 400, \{ field: "name", max: MAX_NAME_LENGTH \}\)/);
  assert.match(src, /jsonRefusal\("APPLY_ANSWER_TOO_LONG", 400, \{ field: overlong\[0\], max: MAX_TEXT_LENGTH \}\)/);
  assert.match(src, /jsonRefusal\("APPLY_EMAIL_TOO_LONG", 400, \{ field: "email", max: MAX_EMAIL_LENGTH \}\)/);
  // …and the rejected answer is named by its STEP ID, which is what lets the door
  // re-ask that one question instead of restarting the conversation.
  assert.match(src, /\["student_project", studentProject\]/, "the free-text cap check is keyed by step id");
});

test("the two SECONDARY apply doors answer with codes too, not English prose", () => {
  // The funnel-start route and the profile-gap follow-up are the same trust
  // boundary as the submissions above — public, unauthenticated, candidate-facing —
  // and both were still answering bare English: "Invalid session.", "Role not
  // found.", "Role closed.", a shared `{ error: "not found" }` on three distinct
  // 404 paths, and "Could not save your answers." on the 500. None carried a code,
  // so none of them reached a candidate in their own language.
  const refusals = readFileSync(path.join(HERE, "..", "..", "_lib", "api-response.ts"), "utf8");
  for (const rel of ["[id]/session/route.ts", "[id]/followup/route.ts"] as const) {
    const src = read(rel);
    assert.deepEqual(
      [...src.matchAll(/NextResponse\.json\(\s*\{\s*error:/g)].map((m) => m[0]),
      [],
      `${rel} still answers a refusal with a bodied message instead of a code`
    );
    for (const [, code] of src.matchAll(/jsonRefusal\("([A-Z_]+)"/g)) {
      assert.ok(new RegExp(`\n  ${code}:`).test(refusals), `${code} is not declared in REFUSAL_ERRORS`);
    }
  }
  // The follow-up's three 404 paths stay INDISTINGUISHABLE — one shared responder,
  // so a caller cannot probe which of "no such token" / "wrong job" / "no profile
  // row" it hit.
  const followup = read("[id]/followup/route.ts");
  assert.match(followup, /const notFound = \(\) => jsonRefusal\("FOLLOWUP_LINK_NOT_FOUND", 404\);/);
  assert.equal((followup.match(/return notFound\(\);/g) ?? []).length, 3, "all three 404 paths share the one responder");
  // …and its 500 goes through the SAFE responder, so profile_cli's reason reaches
  // the log and never the candidate.
  assert.match(followup, /safeJsonError\(\s*new Error\(rebuilt\.reason[\s\S]{0,120}?"FOLLOWUP_FAILED"/);
});
