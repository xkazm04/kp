// The held-outreach doors (comms scope C2a), driven through the REAL handlers in open
// mode (no KP_OPERATOR_PASSWORD: requireOperator is a documented no-op and humanActor()
// answers the role token "human:recruiter"):
//
//   GET  /api/outreach-letters/[id]          the draft + the letter its release would send
//   POST /api/outreach-letters/[id]/approve  approve ONE revision
//   POST /api/outreach-letters/[id]/release  send it
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createPipelineEntry, listPipelineEventsForEntry } from "../../_lib/db/pipeline.ts";
import { outreachLetterById, outreachLetterDraft, OUTREACH_SUBJECT_MAX_LENGTH } from "../../_lib/db/outreach-letters.ts";
import { listOutboxFiltered } from "../../_lib/db/devcase.ts";
import { DEFAULT_WORKSPACE_ID as WS } from "../../_lib/db/workspaces.ts";

const { GET, PATCH } = await import("./[id]/route.ts");
const { POST: APPROVE } = await import("./[id]/approve/route.ts");
const { POST: RELEASE } = await import("./[id]/release/route.ts");

after(() => cleanupUnitDb());

const realFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = (async () => {
  networkCalls += 1;
  return new Response(null, { status: 200 });
}) as unknown as typeof fetch;
after(() => {
  globalThis.fetch = realFetch;
});
afterEach(() => {
  delete process.env.COMMS_WEBHOOK_URL;
});

let seq = 0;
function draftedLetter(ws = WS) {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `olr-c${seq}`,
    candidateLabel: `Route Candidate ${seq}`,
    jobId: `olr-job-${seq}`,
    jobTitle: "Platform Engineer",
    locale: "en",
    contact: `route${seq}@example.cz`,
    stage: "Screened",
    workspaceId: ws,
  });
  const { letter } = outreachLetterDraft({ entryId: entry.id, subject: "A role for you", body: `Dear candidate ${seq}, …`, lang: "en" }, ws);
  return { entry, letter };
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (url: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });

test("GET returns the draft, its revision, and the letter with its footers — writing nothing", async () => {
  const { entry, letter } = draftedLetter();
  const res = await GET(req(`/api/outreach-letters/${letter.id}`), ctx(letter.id));
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    letter: { id: string; state: string; revision: number; messageId: string };
    preview: { body: string; forecast: string; recipient: string | null };
  };
  assert.equal(body.letter.state, "drafted");
  assert.equal(body.letter.revision, 1);
  assert.equal(body.letter.messageId, letter.messageId);
  assert.ok(body.preview.body.startsWith(letter.body!), "the model's text, verbatim");
  assert.match(body.preview.body, /\/data\/preview\?lang=en/, "the erasure footer, with a placeholder token");
  assert.match(body.preview.body, /\/stop\/preview\?lang=en/, "the opt-out footer, with a placeholder token");
  assert.equal(body.preview.forecast, "local", "keyless: the local outbox is the destination");
  assert.equal(listOutboxFiltered({ ref: entry.id }).length, 0);
});

test("a letter from another workspace is invisible to every door", async () => {
  const { letter } = draftedLetter("team-olr-beta");
  const seen = await GET(req(`/api/outreach-letters/${letter.id}`), ctx(letter.id));
  assert.equal(seen.status, 404);
  assert.equal(((await seen.json()) as { code: string }).code, "OUTREACH_LETTER_NOT_FOUND");
  assert.equal((await APPROVE(req(`/api/outreach-letters/${letter.id}/approve`, { revision: 1 }), ctx(letter.id))).status, 404);
  assert.equal((await RELEASE(req(`/api/outreach-letters/${letter.id}/release`, {}), ctx(letter.id))).status, 404);
});

test("approving a stale revision answers 409 and approves nothing; the current one names the approver", async () => {
  const { entry, letter } = draftedLetter();
  outreachLetterDraft({ entryId: entry.id, subject: "A role for you", body: "Edited after it was read.", lang: "en" }, WS);
  const stale = await APPROVE(req(`/api/outreach-letters/${letter.id}/approve`, { revision: 1 }), ctx(letter.id));
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), {
    error: (await import("../../_lib/api-response.ts")).REFUSAL_ERRORS.OUTREACH_LETTER_CONFLICT,
    code: "OUTREACH_LETTER_CONFLICT",
    state: "drafted",
    revision: 2,
  });
  const ok = await APPROVE(req(`/api/outreach-letters/${letter.id}/approve`, { revision: 2 }), ctx(letter.id));
  assert.equal(ok.status, 200);
  const approved = (await ok.json()) as { letter: { state: string; approvedBy: string } };
  assert.equal(approved.letter.state, "approved");
  assert.equal(approved.letter.approvedBy, "human:recruiter");
});

test("release sends once, keyless queued with 0 network calls, and the timeline names the approver", async () => {
  const { entry, letter } = draftedLetter();
  const early = await RELEASE(req(`/api/outreach-letters/${letter.id}/release`, {}), ctx(letter.id));
  assert.equal(early.status, 409, "a draft nobody approved cannot be released");
  await APPROVE(req(`/api/outreach-letters/${letter.id}/approve`, { revision: 1 }), ctx(letter.id));

  const before = networkCalls;
  const res = await RELEASE(req(`/api/outreach-letters/${letter.id}/release`, {}), ctx(letter.id));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { delivery: string; letter: { state: string; messageId: string } };
  assert.equal(body.delivery, "queued");
  assert.equal(body.letter.state, "released");
  assert.equal(networkCalls, before, "keyless makes no network call");
  const rows = listOutboxFiltered({ ref: entry.id, kind: "outreach" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].messageId, letter.messageId);
  const sent = listPipelineEventsForEntry(entry.id, 50, WS).filter((e) => e.kind === "outreach_sent");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].actor, "human:recruiter");

  const again = await RELEASE(req(`/api/outreach-letters/${letter.id}/release`, {}), ctx(letter.id));
  assert.equal(again.status, 409);
  assert.equal(listOutboxFiltered({ ref: entry.id, kind: "outreach" }).length, 1, "released once");
});

const { GET: BY_ENTRY } = await import("./by-entry/[entryId]/route.ts");
const entryCtx = (entryId: string) => ({ params: Promise.resolve({ entryId }) });

test("by-entry returns the letter held for an application, the same shape as GET by id", async () => {
  const { entry, letter } = draftedLetter();
  const res = await BY_ENTRY(req(`/api/outreach-letters/by-entry/${entry.id}`), entryCtx(entry.id));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { letter: { id: string; revision: number }; preview: { forecast: string; body: string } };
  assert.equal(body.letter.id, letter.id);
  assert.equal(body.letter.revision, 1);
  assert.equal(body.preview.forecast, "local");
  assert.match(body.preview.body, /\/stop\/preview\?lang=en/);
});

test("by-entry answers nulls for an application with no letter, and 404 for a foreign or unknown entry", async () => {
  const { entry } = createPipelineEntry({
    candidateId: "olr-none",
    candidateLabel: "No Letter",
    jobId: "olr-job-none",
    jobTitle: "Platform Engineer",
    locale: "en",
    contact: "none@example.cz",
    stage: "Screened",
    workspaceId: WS,
  });
  const none = await BY_ENTRY(req(`/api/outreach-letters/by-entry/${entry.id}`), entryCtx(entry.id));
  assert.equal(none.status, 200);
  assert.deepEqual(await none.json(), { letter: null, preview: null });

  const foreign = draftedLetter("team-olr-gamma");
  assert.equal((await BY_ENTRY(req(`/api/outreach-letters/by-entry/${foreign.entry.id}`), entryCtx(foreign.entry.id))).status, 404);
  assert.equal((await BY_ENTRY(req(`/api/outreach-letters/by-entry/nope`), entryCtx("nope"))).status, 404);
});

// The SUBJECT had no gate: the body is cleaned and capped (outreach-body.ts) but the subject
// went to the relay as written — by the model from a CV, or by a person through PATCH.
const patch = (id: string, body: unknown) =>
  new NextRequest(`http://localhost/api/outreach-letters/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

const RLO = String.fromCharCode(0x202e); // a right-to-left override, the spoofed-extension trick

test("PATCH stores the subject cleaned onto one line: no markup, no line break, no bidi override", async () => {
  const { letter } = draftedLetter();
  const res = await PATCH(
    patch(letter.id, {
      revision: 1,
      subject: "Hello <a href=\"https://evil.example\">click</a>\r\nBcc: victim@example.cz " + RLO + "exe.pdf",
      body: "Dear candidate, a new text.",
    }),
    ctx(letter.id)
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { letter: { subject: string; revision: number }; preview: { subject: string } };
  assert.equal(body.letter.revision, 2);
  assert.equal(body.letter.subject, "Hello click Bcc: victim@example.cz exe.pdf");
  assert.equal(body.preview.subject, body.letter.subject, "the letter a release would send carries the cleaned subject");
});

test("PATCH refuses an over-long subject with 422 and writes nothing", async () => {
  const { letter } = draftedLetter();
  const res = await PATCH(
    patch(letter.id, { revision: 1, subject: "x".repeat(OUTREACH_SUBJECT_MAX_LENGTH + 1), body: "Dear candidate." }),
    ctx(letter.id)
  );
  assert.equal(res.status, 422);
  assert.equal(((await res.json()) as { code: string }).code, "OUTREACH_BODY_TOO_LONG");
  const now = outreachLetterById(letter.id, WS)!;
  assert.equal(now.revision, 1);
  assert.equal(now.subject, letter.subject);
});

test("a model-drafted subject is cleaned and clipped before it is held, so release can only send that", async () => {
  const { entry } = createPipelineEntry({
    candidateId: "olr-subject",
    candidateLabel: "Subject Candidate",
    jobId: "olr-job-subject",
    jobTitle: "Platform Engineer",
    locale: "en",
    contact: "subject@example.cz",
    stage: "Screened",
    workspaceId: WS,
  });
  const injected = "<img src=\"https://track.example/p.gif\">A role\nfor you " + "y".repeat(OUTREACH_SUBJECT_MAX_LENGTH);
  const { letter } = outreachLetterDraft({ entryId: entry.id, subject: injected, body: "Dear candidate.", lang: "en" }, WS);
  assert.ok(letter.subject!.startsWith("A role for you y"), letter.subject!);
  assert.ok(!/[<>\n]/.test(letter.subject!));
  assert.equal(letter.subject!.length, OUTREACH_SUBJECT_MAX_LENGTH);
  // A re-draft of the same raw text is not an edit: the cleaned value compares equal.
  const again = outreachLetterDraft({ entryId: entry.id, subject: injected, body: "Dear candidate.", lang: "en" }, WS);
  assert.equal(again.changed, false);
  assert.equal(again.letter.revision, 1);
});
