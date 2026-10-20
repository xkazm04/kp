// Locks the candidate portal's card choice so a live in_progress session is a
// busy card, not Start. /connect already refuses INTERVIEW_ALREADY_LIVE; the
// page used to mount VoiceInterviewClient anyway.
//
// Runner: node --test with type stripping (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { INTERVIEW_LINK_TTL_DAYS, LIVE_INTERVIEW_RECENCY_MIN } from "@/app/_lib/db/interviews.ts";
import { interviewInactiveCopyKeys, interviewPortalOffers, interviewPortalView } from "./portal-state.ts";

function iso(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

test("a live in_progress session is the busy card, not Start", () => {
  assert.equal(
    interviewPortalView({
      status: "in_progress",
      createdAt: iso(5 * 60_000),
      updatedAt: iso(60_000),
    }),
    "live",
  );
});

test("a stale in_progress session past the recency window is still Start", () => {
  assert.equal(
    interviewPortalView({
      status: "in_progress",
      createdAt: iso((LIVE_INTERVIEW_RECENCY_MIN + 5) * 60_000),
      updatedAt: iso((LIVE_INTERVIEW_RECENCY_MIN + 1) * 60_000),
    }),
    "ready",
  );
});

test("a failed session is Start — failed stays reconnectable", () => {
  assert.equal(
    interviewPortalView({
      status: "failed",
      createdAt: iso(5 * 60_000),
      updatedAt: iso(60_000),
    }),
    "ready",
  );
});

test("completed and revoked keep their closed cards", () => {
  assert.equal(
    interviewPortalView({ status: "completed", createdAt: iso(60_000), updatedAt: iso(1_000) }),
    "completed",
  );
  assert.equal(
    interviewPortalView({ status: "revoked", createdAt: iso(60_000), updatedAt: iso(1_000) }),
    "inactive",
  );
});

test("revoked tokens use revoked copy keys; expired created tokens use expired keys", () => {
  assert.deepEqual(interviewInactiveCopyKeys({ status: "revoked" }), {
    title: "revokedTitle",
    body: "revokedBody",
  });
  const expiredCreated = { status: "created", createdAt: iso((INTERVIEW_LINK_TTL_DAYS + 1) * 86_400_000) };
  assert.equal(interviewPortalView(expiredCreated), "inactive");
  assert.deepEqual(interviewInactiveCopyKeys(expiredCreated), {
    title: "expiredTitle",
    body: "expiredBody",
  });
});

test("the portal page and all four catalogs split revoked from expired copy", () => {
  const src = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  assert.match(src, /interviewInactiveCopyKeys/);
  assert.doesNotMatch(src, /inactiveTitle|inactiveBody/);
  for (const locale of ["en", "cs", "de", "fr"]) {
    const cat = JSON.parse(
      readFileSync(fileURLToPath(new URL(`../../../messages/${locale}.json`, import.meta.url)), "utf8"),
    ) as { interview: Record<string, string> };
    for (const key of ["revokedTitle", "revokedBody", "expiredTitle", "expiredBody"]) {
      assert.equal(typeof cat.interview[key], "string", `${locale}.json must define interview.${key}`);
    }
    assert.equal(cat.interview.inactiveTitle, undefined);
    assert.equal(cat.interview.inactiveBody, undefined);
    assert.ok(!cat.interview.expiredBody.includes(" or "), `${locale} expired copy must not keep the ambiguous or`);
    assert.ok(!cat.interview.revokedBody.includes(" or "), `${locale} revoked copy must not keep the ambiguous or`);
  }
});

// ---- what the portal OFFERS (spark interview-kit-template, WP-D) -----------------------
// A recruiter's kit REHEARSAL is a test-mode session run on this same portal. It must
// never be offered an audio recording (the page used to read the workspace setting for
// every session, while /connect only ever stamps recording consent for candidate mode)
// and never link to — or mint — a candidate's /status page.

test("a rehearsal (test mode, no entry) is offered neither a recording nor a status link", () => {
  assert.deepEqual(interviewPortalOffers({ mode: "test", entryId: null }), { recording: false, statusLink: false });
});

test("a test session that somehow carries an entry still gets neither — it is not a candidate interview", () => {
  assert.deepEqual(interviewPortalOffers({ mode: "test", entryId: "pe-someone" }), { recording: false, statusLink: false });
});

test("a candidate interview keeps both; a /simulate demo (candidate mode, no entry) keeps the recording offer it had", () => {
  assert.deepEqual(interviewPortalOffers({ mode: "candidate", entryId: "pe-1" }), { recording: true, statusLink: true });
  assert.deepEqual(interviewPortalOffers({ mode: "candidate", entryId: null }), { recording: true, statusLink: false });
});

test("the portal page reads both offers from interviewPortalOffers, never from the entry or the workspace alone", () => {
  const src = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  assert.match(src, /const offers = interviewPortalOffers\(session\);/);
  assert.match(src, /const statusHref = offers\.statusLink && session\.entryId \? safeStatusHref\(session\.entryId\) : null;/);
  assert.match(src, /recordingOffered=\{offers\.recording && recordingOffer\(session\.workspaceId\)\}/);
  assert.doesNotMatch(src, /recordingOffered=\{recordingOffer\(/, "the workspace setting alone no longer decides the offer");
});
