// The candidate's interview FEEDBACK LETTER on the public status surface (spark
// interview-feedback-letter, WP-alpha), driven through the REAL handlers.
//
// What is pinned:
//   • the GET projection gains `letter` — the contract's CandidateLetterView and nothing
//     else: no draft, no reviewer, no ids — and consent withheld blanks it silently;
//   • WHO may ask, read off the record: a person's reject and a hire may; an automated
//     screen-out, a closed role, a live application and an application with no interview may
//     not;
//   • the POST door's gate order: throttle → token → body cap → eligibility / idempotency →
//     record + queue; ONE coded refusal for every "not eligible" reason; a second request
//     returns the existing state as 409 STATUS_LETTER_ALREADY_REQUESTED and never a second
//     letter or a second queued draft;
//   • the request is recorded in the candidate's language and the draft is QUEUED — with
//     the letter id and the role, never the candidate's name, on the task row.
//
// unit-db.ts must stay the first project import (isolated throwaway DB). The drafting CLI
// is never run here: PYTHON_CMD points at a binary that does not exist, so a queued draft
// fails at spawn and the letter stays `requested` — the task is asserted QUEUED, which is
// this door's whole job. The CLI is pinned by pipeline/jobfit/tests/test_interview_letter.py.
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";

process.env.PYTHON_CMD = "kp-status-letter-test-has-no-python";

const { GET: STATUS_GET } = await import("./[token]/route.ts");
const { POST: LETTER_POST } = await import("./[token]/letter/route.ts");
const { ensureDb } = await import("../../_lib/db/core.ts");
const { actOnPipelineEntry, closeEntriesByJobId, createPipelineEntry } = await import("../../_lib/db/pipeline.ts");
const { completeInterviewSession, createInterviewSession } = await import("../../_lib/db/interviews.ts");
const { getOrCreateStatusLink } = await import("../../_lib/application-status-store.ts");
const { interviewLetterApprove, interviewLetterByEntry, interviewLetterSaveDraft } = await import("../../_lib/db/interview-letters.ts");
const { getTask } = await import("../../_lib/db/tasks.ts");

after(() => cleanupUnitDb());

const WS = "workspace";
let ip = 0;

const SPOKEN = "I rewrote the Zanzibar ledger over one rainy weekend";

type Fixture = { entryId: string; jobId: string; token: string };

function candidate(opts: { stage?: string; interview?: boolean; locale?: string } = {}): Fixture {
  const suffix = Math.random().toString(36).slice(2, 8);
  const jobId = `job-sl-${suffix}`;
  const { entry } = createPipelineEntry({
    candidateId: `c-sl-${suffix}`,
    candidateLabel: "Letter Candidate",
    jobId,
    jobTitle: "Backend Engineer",
    stage: opts.stage ?? "Interview",
    ...(opts.locale ? { locale: opts.locale } : {}),
  });
  if (opts.interview !== false) {
    const session = createInterviewSession({ provider: "openai", mode: "candidate", entryId: entry.id, candidateLabel: "Letter Candidate", workspaceId: WS });
    completeInterviewSession(session.id, {
      transcript: [
        { role: "interviewer", text: "Tell me about a system you owned." },
        { role: "candidate", text: `${SPOKEN}.` },
      ],
      scorecard: {
        recommendation: "hold",
        ratings: [
          { competency: "Technical depth", rating: 5, evidence: SPOKEN },
          { competency: "Problem-solving", rating: 2, evidence: "I usually just try things until it works" },
        ],
      },
    });
  }
  return { entryId: entry.id, jobId, token: getOrCreateStatusLink(entry.id) };
}

function humanReject(f: Fixture) {
  assert.ok(actOnPipelineEntry(f.entryId, "reject", undefined, { actor: "human", actorRef: "human:Petra Nováková" }, WS));
}

function status(token: string) {
  return STATUS_GET(new NextRequest(`http://localhost/api/status/${token}`, { headers: { "x-forwarded-for": `10.8.0.${++ip}` } }), {
    params: Promise.resolve({ token }),
  });
}

function ask(token: string, body?: string, client?: string) {
  const headers: Record<string, string> = { "x-forwarded-for": client ?? `10.9.${Math.floor(++ip / 250)}.${ip % 250}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  return LETTER_POST(new NextRequest(`http://localhost/api/status/${token}/letter`, { method: "POST", headers, body }), {
    params: Promise.resolve({ token }),
  });
}

async function letterView(token: string) {
  const body = (await (await status(token)).json()) as { letter: Record<string, unknown> };
  return body.letter;
}

function tasksFor(letterId: string) {
  return (
    ensureDb().prepare(`SELECT id, kind, label, params_json FROM tasks WHERE kind = 'interview_letter'`).all() as {
      id: string;
      kind: string;
      label: string;
      params_json: string;
    }[]
  ).filter((t) => (JSON.parse(t.params_json) as { letterId?: string }).letterId === letterId);
}

/** A queued draft fails at spawn here (no Python). Wait for it to settle so the test file
 *  never ends with a task still writing to a DB the cleanup is closing. */
async function settled(taskId: string) {
  for (let i = 0; i < 200; i++) {
    const t = getTask(taskId);
    if (t && !["queued", "running"].includes(t.status)) return t;
    await new Promise((r) => setTimeout(r, 10));
  }
  return getTask(taskId);
}

// ---- the GET projection ---------------------------------------------------

test("the status projection gains `letter` — the contract's four fields and nothing else", async () => {
  const f = candidate();
  humanReject(f);
  const res = await status(f.token);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(body).sort(),
    ["company", "hasInterviewRecording", "jobTitle", "letter", "relayConfigured", "status", "updatedAt"],
    "the candidate projection must not grow silently"
  );
  assert.deepEqual(body.letter, { canRequest: true, state: null, requestedAt: null, text: null });
});

test("who may ask, read off the record", async () => {
  const humanRejected = candidate();
  humanReject(humanRejected);
  assert.equal((await letterView(humanRejected.token)).canRequest, true, "a person's reject");

  const hired = candidate({ stage: "Hired" });
  assert.equal((await letterView(hired.token)).canRequest, true, "a hire");

  const screenedOut = candidate();
  // The screen wave's exact write: actor "system", no actorRef (screen-wave.ts).
  assert.ok(actOnPipelineEntry(screenedOut.entryId, "reject", "Below the floor · approved by Petra", { actor: "system" }, WS));
  assert.equal((await letterView(screenedOut.token)).canRequest, false, "an automated screen-out, even with a named approver");

  const closed = candidate();
  assert.equal(closeEntriesByJobId(closed.jobId, WS), 1);
  assert.equal((await letterView(closed.token)).canRequest, false, "a closed role is no decision about this candidate");

  const live = candidate();
  assert.equal((await letterView(live.token)).canRequest, false, "nothing decided yet");

  const noInterview = candidate({ interview: false });
  humanReject(noInterview);
  assert.equal((await letterView(noInterview.token)).canRequest, false, "no interview on record, nothing to report");
});

test("consent withheld: the page is told nothing, and the door refuses with the same code", async () => {
  const f = candidate();
  humanReject(f);
  ensureDb()
    .prepare(`UPDATE pipeline_entries SET consent_given_at = ?, consent_expires_at = ? WHERE id = ?`)
    .run("2024-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z", f.entryId);
  assert.deepEqual(await letterView(f.token), { canRequest: false, state: null, requestedAt: null, text: null });
  const res = await ask(f.token);
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { code?: string }).code, "STATUS_LETTER_NOT_ELIGIBLE");
  assert.equal(interviewLetterByEntry(f.entryId, WS), null, "nothing was recorded");
});

// ---- the POST door --------------------------------------------------------

test("gate order: the throttle answers before the token is even looked up", async () => {
  // The bucket is per client AND token; with no trusted proxy configured every caller
  // shares one client key, so a token of its own keeps this burst out of the other tests.
  const client = "10.99.0.1";
  const token = "as-throttled-unknown-token";
  for (let i = 0; i < 10; i++) assert.equal((await ask(token, undefined, client)).status, 404);
  const res = await ask(token, undefined, client);
  assert.equal(res.status, 429);
  assert.equal(((await res.json()) as { code?: string }).code, "TOO_MANY_REQUESTS");
});

test("an unknown status token answers the same coded refusal its siblings do", async () => {
  const res = await ask("as-not-a-real-token");
  assert.equal(res.status, 404);
  assert.equal(((await res.json()) as { code?: string }).code, "STATUS_LINK_INVALID");
});

test("the body is capped on the bytes read", async () => {
  const f = candidate();
  humanReject(f);
  const res = await ask(f.token, JSON.stringify({ lang: "cs", pad: "x".repeat(2048) }));
  assert.equal(res.status, 413);
  const body = (await res.json()) as { code?: string; maxBytes?: number };
  assert.equal(body.code, "PAYLOAD_TOO_LARGE");
  assert.equal(body.maxBytes, 1024);
  assert.equal(interviewLetterByEntry(f.entryId, WS), null, "an over-cap request records nothing");
});

test("not eligible is ONE refusal, whatever the reason", async () => {
  const screenedOut = candidate();
  actOnPipelineEntry(screenedOut.entryId, "reject", undefined, { actor: "system" }, WS);
  const live = candidate();
  for (const f of [screenedOut, live]) {
    const res = await ask(f.token, JSON.stringify({ lang: "en" }));
    assert.equal(res.status, 409);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.code, "STATUS_LETTER_NOT_ELIGIBLE");
    assert.deepEqual(Object.keys(body).sort(), ["code", "error"], "no reason, no hint, on the public wire");
    assert.equal(interviewLetterByEntry(f.entryId, WS), null);
  }
});

test("a request is recorded in the candidate's language, queues ONE draft, and is idempotent", async () => {
  const f = candidate();
  humanReject(f);
  const res = await ask(f.token, JSON.stringify({ lang: "cs" }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; letter: Record<string, unknown> };
  assert.equal(body.ok, true);
  assert.equal(body.letter.canRequest, false);
  assert.equal(body.letter.state, "requested");
  assert.equal(typeof body.letter.requestedAt, "string");
  assert.equal(body.letter.text, null);
  assert.deepEqual(Object.keys(body.letter).sort(), ["canRequest", "requestedAt", "state", "text"]);

  const stored = interviewLetterByEntry(f.entryId, WS)!;
  assert.equal(stored.lang, "cs", "the language the page was showing");
  assert.equal(stored.outcome, "not_selected");
  assert.ok(!JSON.stringify(body).includes(stored.id), "no letter id on the public wire");
  assert.ok(!JSON.stringify(body).includes(f.entryId), "no entry id on the public wire");

  const queued = tasksFor(stored.id);
  assert.equal(queued.length, 1, "the draft is queued");
  assert.deepEqual(JSON.parse(queued[0].params_json), { letterId: stored.id, jobTitle: "Backend Engineer" });
  assert.doesNotMatch(queued[0].label + queued[0].params_json, /Letter Candidate/, "the task row never names the candidate");

  // The second ask: the SAME state back, coded, and nothing new anywhere.
  const again = await ask(f.token, JSON.stringify({ lang: "de" }));
  assert.equal(again.status, 409);
  const againBody = (await again.json()) as { code?: string; letter?: unknown };
  assert.equal(againBody.code, "STATUS_LETTER_ALREADY_REQUESTED");
  assert.deepEqual(againBody.letter, body.letter, "the existing request's state, exactly");
  assert.equal(interviewLetterByEntry(f.entryId, WS)!.id, stored.id, "never a second letter");
  assert.equal(interviewLetterByEntry(f.entryId, WS)!.lang, "cs", "and the first language stands");
  assert.equal(tasksFor(stored.id).length, 1, "never a second queued draft");

  // …and the page now shows the request, with no button.
  assert.deepEqual(await letterView(f.token), body.letter);

  const task = await settled(queued[0].id);
  assert.equal(task?.status, "failed", "(no Python in this test) the draft failed at spawn…");
  assert.equal(interviewLetterByEntry(f.entryId, WS)!.state, "requested", "…and the letter stays requested, never half-drafted");
});

test("no language in the body → the entry's comms locale; a junk one is ignored, not refused", async () => {
  const quiet = candidate({ stage: "Hired", locale: "de" });
  assert.equal((await ask(quiet.token)).status, 200);
  assert.equal(interviewLetterByEntry(quiet.entryId, WS)!.lang, "de");
  assert.equal(interviewLetterByEntry(quiet.entryId, WS)!.outcome, "hired");

  const junk = candidate({ stage: "Hired", locale: "fr" });
  assert.equal((await ask(junk.token, JSON.stringify({ lang: "klingon" }))).status, 200);
  assert.equal(interviewLetterByEntry(junk.entryId, WS)!.lang, "fr");

  for (const f of [quiet, junk]) {
    const [t] = tasksFor(interviewLetterByEntry(f.entryId, WS)!.id);
    if (t) await settled(t.id);
  }
});

test("the candidate never sees a draft — only the text a person approved and sent", async () => {
  const f = candidate();
  humanReject(f);
  assert.equal((await ask(f.token)).status, 200);
  const letter = interviewLetterByEntry(f.entryId, WS)!;
  const [t] = tasksFor(letter.id);
  if (t) await settled(t.id);

  interviewLetterSaveDraft(letter.id, { text: `A machine draft that mentions ${SPOKEN}.`, source: "model" }, WS);
  const drafted = await letterView(f.token);
  assert.equal(drafted.state, "drafted");
  assert.equal(drafted.text, null);
  assert.doesNotMatch(JSON.stringify(await (await status(f.token)).json()), /Zanzibar|machine draft|Petra/, "no draft, no reviewer on the wire");

  interviewLetterApprove(letter.id, { finalText: "Thank you for your interview. Communication came through well.", decidedBy: "human:Petra Nováková" }, WS);
  const sent = await letterView(f.token);
  assert.equal(sent.state, "sent");
  assert.equal(sent.text, "Thank you for your interview. Communication came through well.");
  assert.doesNotMatch(JSON.stringify(sent), /Petra|human:/, "who approved it stays server-side");
});

test("source: the tenant comes off the entry, never a session or the default team", () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "[token]", "letter", "route.ts"), "utf8");
  assert.match(src, /const workspaceId = getEntryWorkspace\(entryId\)/);
  assert.match(src, /getPipelineEntry\(entryId, workspaceId\)/);
  const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!code.includes("currentWorkspace("), "a public token route has no session workspace to read");
  assert.ok(!code.includes("DEFAULT_WORKSPACE"), "the default workspace must never be hardcoded here");
  assert.match(code, /jsonRefusal\("STATUS_LETTER_NOT_ELIGIBLE", 409\)/);
  assert.match(code, /jsonRefusal\("STATUS_LETTER_ALREADY_REQUESTED", 409, \{ letter: outcome\.view \}\)/);
});
