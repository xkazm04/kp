// THE OPT-OUT IS A PROPERTY OF SENDING, NOT OF ONE DISPATCHER.
//
// comms.ts already learned this lesson once: the consent gate lived inside
// dispatchOutreach alone while three other doors (the resend route, the dev-case
// lifecycle close, the intake acknowledgement) called sendComm directly and skipped it.
// A gate with one door that enforces it and three that do not is a gate nobody can
// reason about, which is why commsSendSuppression exists at the channel handoff.
//
// The candidate opt-out is wired into that same chokepoint rather than into
// dispatchOutreach, so a dispatcher written next year inherits the refusal instead of
// having to remember it. This file pins that, plus the two halves of the affordance
// itself: the visible footer in the letter and the machine-readable List-Unsubscribe in
// the wire envelope.
//
// testing/unit-db.ts must stay the FIRST project import (throwaway KP_DB_PATH).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { commsSendSuppression } from "./comms.ts";
import { buildCommEnvelope, LIST_UNSUBSCRIBE_POST_ONE_CLICK } from "./comms-envelope.ts";
import { createPipelineEntry, recordEntryConsent } from "./db/pipeline.ts";
import { recordCandidateOptOut } from "./outreach-state-store.ts";

after(() => cleanupUnitDb());

function read(rel: string): string {
  // Line endings normalised: a checkout with core.autocrlf=true carries CRLF and a
  // marker spanning a newline would then never match (the documented Windows trap).
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

let seq = 0;
function fixture(candidateId: string) {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId,
    candidateLabel: `Gate Subject ${seq}`,
    jobId: `gate-job-${seq}`,
    jobTitle: `Gate Role ${seq}`,
    stage: "Applied",
    contact: `${candidateId}-${seq}@example.com`,
  });
  // A live consent grant, so the CONSENT half of the gate cannot be what refuses the
  // send below. Without this the test would pass for the wrong reason.
  recordEntryConsent(entry.id, "test", 365, entry.workspaceId);
  return entry;
}

const outreach = (ref: string) => ({ to: "x", subject: "s", body: "b", kind: "outreach", ref });

test("the shared send precondition — not just dispatchOutreach — refuses an opted-out candidate", () => {
  const entry = fixture("gate-c-optout");
  assert.equal(commsSendSuppression(outreach(entry.id)), null, "the fixture is contactable before the opt-out");

  recordCandidateOptOut(entry.id, entry.workspaceId);

  assert.equal(
    commsSendSuppression(outreach(entry.id)),
    "candidate",
    "every door into the channel inherits the refusal, including ones written after this one"
  );
});

test("the refusal follows the PERSON, so a rediscovery entry minted later is refused too", () => {
  const candidateId = "gate-c-durable";
  const first = fixture(candidateId);
  recordCandidateOptOut(first.id, first.workspaceId);

  const rediscovered = fixture(candidateId);
  assert.equal(
    commsSendSuppression(outreach(rediscovered.id)),
    "candidate",
    "a fresh per-role entry is exactly how a naive entry-scoped opt-out would be bypassed"
  );
});

test("the opt-out withholds OUTREACH, not the letters a candidate is owed", () => {
  // The scope is deliberate and it is what the law asks for: Art. 13(4) is about
  // unsolicited COMMERCIAL messages. A rejection, an offer or an interview confirmation
  // is a reply within a process the candidate started, and silently withholding one
  // would be its own harm — the page says so in as many words ("it does not withdraw an
  // application"), so the code must match the promise.
  const entry = fixture("gate-c-transactional");
  recordCandidateOptOut(entry.id, entry.workspaceId);
  for (const kind of ["rejection", "offer", "interview_confirmation", "acknowledgement"]) {
    assert.equal(
      commsSendSuppression({ to: "x", subject: "s", body: "b", kind, ref: entry.id }),
      null,
      `${kind} is owed to the candidate and must still go out`
    );
  }
  assert.equal(commsSendSuppression(outreach(entry.id)), "candidate");
});

// ---- the affordance itself ---------------------------------------------------------

test("every candidate comm carries the unsubscribe footer beside the data footer", () => {
  const src = read("./comms-dispatch.ts");
  // ONE builder for both, called from the ONE candidate-facing send wrapper — so a new
  // dispatcher cannot ship a letter with the GDPR link and no opt-out.
  assert.match(src, /async function candidateFooters\(/, "the two footers are built together");
  assert.match(src, /t\("stopFooter", \{ link: /, "the opt-out link is a localized catalog line, not English prose");
  assert.match(src, /ensureOptOutToken\(/, "the footer mints the SCOPED opt-out token");
  const wrapper = src.slice(src.indexOf("async function sendCandidateComm("));
  assert.match(wrapper, /body: msg\.body \+ footers\.text/, "the footers ride on every candidate-facing send");
  assert.match(wrapper, /unsubscribeUrl: footers\.unsubscribeUrl/, "…and the machine-readable half reaches the channel");
});

test("dispatchOutreach still consults the shared halt predicate before sending", () => {
  const src = read("./comms-dispatch.ts");
  const fn = src.slice(src.indexOf("export async function dispatchOutreach("));
  const haltAt = fn.indexOf("outreachHaltFor(entry.id");
  const sendAt = fn.indexOf("sendCandidateComm(");
  assert.ok(haltAt > 0, "dispatchOutreach must ask why a send is refused so it can REPORT the reason");
  assert.ok(haltAt < sendAt, "…and it must ask before it sends");
});

test("the wire envelope carries List-Unsubscribe and RFC 8058 one-click, correctly framed", () => {
  const env = buildCommEnvelope(
    { to: "x", subject: "s", body: "b", kind: "outreach", ref: "e-1", unsubscribeUrl: "https://kp.example/api/stop/ob-abc" },
    null,
    "2026-09-08T00:00:00.000Z"
  );
  // RFC 2369 §2 requires the URL in angle brackets; a bare URL is not a valid header.
  assert.equal(env.listUnsubscribe, "<https://kp.example/api/stop/ob-abc>");
  assert.equal(env.listUnsubscribePost, LIST_UNSUBSCRIBE_POST_ONE_CLICK);
  assert.equal(LIST_UNSUBSCRIBE_POST_ONE_CLICK, "List-Unsubscribe=One-Click");
});

test("a comm with no opt-out link carries NEITHER field — never a One-Click directive with no target", () => {
  const env = buildCommEnvelope({ to: "x", subject: "s", body: "b", kind: "ko_decline" }, null, "2026-09-08T00:00:00.000Z");
  assert.equal(env.listUnsubscribe, null);
  assert.equal(env.listUnsubscribePost, null, "a receiver told to accept one-click POSTs would have nowhere to POST");
  // Present-and-null, not absent: the envelope is a published export contract and an
  // undefined field does not survive JSON.
  const wire = JSON.parse(JSON.stringify(env)) as Record<string, unknown>;
  assert.ok("listUnsubscribe" in wire && "listUnsubscribePost" in wire);
});
