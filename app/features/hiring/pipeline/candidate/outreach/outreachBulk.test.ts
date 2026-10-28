// The bulk dry-run sheet's logic (comms scope C2b, second half), driven against the REAL
// outreach-letter doors in open mode: the client calls are routed to the route handlers, and
// the relay is a counting fixture on globalThis.fetch. unit-db.ts must stay the first import.
import { cleanupUnitDb } from "../../../../../_lib/testing/unit-db.ts";
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createPipelineEntry, listPipelineEventsForEntry } from "../../../../../_lib/db/pipeline.ts";
import { outreachLetterDraft, outreachLetterById } from "../../../../../_lib/db/outreach-letters.ts";
import { listOutboxFiltered } from "../../../../../_lib/db/devcase.ts";
import { DEFAULT_WORKSPACE_ID as WS } from "../../../../../_lib/db/workspaces.ts";
import { approveAndReleaseCohort, cohortForecast, loadCohort, tallyResults } from "./outreachBulk.ts";
import { editLetter } from "./outreachCard.ts";

const { GET: GET_BY_ENTRY } = await import("../../../../../api/outreach-letters/by-entry/[entryId]/route.ts");
const { PATCH, GET } = await import("../../../../../api/outreach-letters/[id]/route.ts");
const { POST: APPROVE } = await import("../../../../../api/outreach-letters/[id]/approve/route.ts");
const { POST: RELEASE } = await import("../../../../../api/outreach-letters/[id]/release/route.ts");

after(() => cleanupUnitDb());
void GET;

const { setRelayHostLookupForTests } = await import("../../../../../_lib/comms.ts");
setRelayHostLookupForTests(async () => [{ address: "93.184.216.34" }]);
after(() => setRelayHostLookupForTests(undefined));

const RELAY = "https://relay.example.com/hook";
const relayPosts: { messageId: string | null }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
  relayPosts.push({ messageId: (JSON.parse(String(init?.body ?? "{}")) as { messageId?: string }).messageId ?? null });
  return new Response(null, { status: 200 });
}) as unknown as typeof fetch;
after(() => {
  globalThis.fetch = realFetch;
});
afterEach(() => {
  delete process.env.COMMS_WEBHOOK_URL;
  relayPosts.length = 0;
});

/** The sheet's client calls, answered by the real handlers. */
const doFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const req = new NextRequest(`http://localhost${url}`, init as ConstructorParameters<typeof NextRequest>[1]);
  const m = url.match(/^\/api\/outreach-letters\/(?:by-entry\/)?([^/]+?)(?:\/(approve|release))?$/);
  assert.ok(m, `unexpected call ${url}`);
  const id = m[1];
  if (url.includes("/by-entry/")) return GET_BY_ENTRY(req, { params: Promise.resolve({ entryId: id }) });
  const ctx = { params: Promise.resolve({ id }) };
  if (m[2] === "approve") return APPROVE(req, ctx);
  if (m[2] === "release") return RELEASE(req, ctx);
  return init?.method === "PATCH" ? PATCH(req, ctx) : GET(req, ctx);
}) as typeof fetch;

let seq = 0;
function held(contact: string | null = `bulk${++seq}@example.cz`) {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `bulk-c${seq}`,
    candidateLabel: `Bulk Candidate ${seq}`,
    jobId: `bulk-job-${seq}`,
    jobTitle: "Platform Engineer",
    locale: "en",
    contact: contact ?? undefined,
    stage: "Screened",
    workspaceId: WS,
  });
  const { letter } = outreachLetterDraft({ entryId: entry.id, subject: "A role", body: `Dear ${seq}, a role.`, lang: "en" }, WS);
  return { entry, letter };
}

test("a relayed cohort of N held letters makes exactly N relay POSTs, each under its draft's messageId, naming the approver", async () => {
  process.env.COMMS_WEBHOOK_URL = RELAY;
  const cohort = [held(), held(), held()];
  const rows = await loadCohort(cohort.map((c) => c.entry.id), doFetch);
  assert.deepEqual(cohortForecast(rows), { send: 3, queue: 0, refuse: 0, settled: 0, missing: 0, refuseReasons: {} });

  const results = await approveAndReleaseCohort(rows, doFetch);
  assert.deepEqual(tallyResults(results), { released: 3, queued: 0, refused: 0, conflict: 0 });
  assert.equal(relayPosts.length, 3);
  assert.deepEqual(relayPosts.map((p) => p.messageId).sort(), cohort.map((c) => c.letter.messageId).sort());
  for (const { entry } of cohort) {
    const sent = listPipelineEventsForEntry(entry.id, 50, WS).filter((e) => e.kind === "outreach_sent");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].actor, "human:recruiter");
  }
});

test("keyless the cohort forecasts and reads queued, with zero network calls", async () => {
  const cohort = [held(), held()];
  const rows = await loadCohort(cohort.map((c) => c.entry.id), doFetch);
  const forecast = cohortForecast(rows);
  assert.equal(forecast.queue, 2);
  assert.equal(forecast.send, 0);
  const results = await approveAndReleaseCohort(rows, doFetch);
  assert.deepEqual(results.map((r) => r.kind), ["queued", "queued"]);
  assert.equal(relayPosts.length, 0);
  assert.equal(listOutboxFiltered({ ref: cohort[0].entry.id, kind: "outreach" }).length, 1);
});

test("a letter edited after render is refused (409 -> conflict) and the rest of the cohort still releases", async () => {
  process.env.COMMS_WEBHOOK_URL = RELAY;
  const cohort = [held(), held(), held()];
  const rows = await loadCohort(cohort.map((c) => c.entry.id), doFetch);
  // Someone else edits the middle letter after the sheet rendered it.
  const other = await editLetter(cohort[1].letter.id, { revision: 1, subject: "Changed", body: "Changed body" }, doFetch);
  assert.equal(other.kind, "ok");

  const results = await approveAndReleaseCohort(rows, doFetch);
  assert.deepEqual(results.map((r) => r.kind), ["released", "conflict", "released"]);
  assert.equal(relayPosts.length, 2, "the edited letter was not sent");
  assert.equal(outreachLetterById(cohort[1].letter.id, WS)?.state, "drafted");
});

test("PATCH is revision-bound: a stale edit is a 409, the fresh one bumps the revision", async () => {
  const { letter } = held();
  const first = await editLetter(letter.id, { revision: 1, subject: "S2", body: "B2" }, doFetch);
  assert.equal(first.kind, "ok");
  if (first.kind === "ok") assert.equal(first.view.letter.revision, 2);
  const stale = await editLetter(letter.id, { revision: 1, subject: "S3", body: "B3" }, doFetch);
  assert.equal(stale.kind, "stale");
  const empty = await editLetter(letter.id, { revision: 2, subject: "S3", body: "   " }, doFetch);
  assert.equal(empty.kind, "error");
});

test("a letter forecast as refused is reported refused without a door call; counts match the rows", async () => {
  const sendable = held();
  const noRecipient = held(null);
  const rows = await loadCohort([sendable.entry.id, noRecipient.entry.id], doFetch);
  const forecast = cohortForecast(rows);
  assert.equal(forecast.queue + forecast.refuse, 2);
  const results = await approveAndReleaseCohort(rows, doFetch);
  const tally = tallyResults(results);
  assert.equal(tally.queued, forecast.queue);
  assert.equal(tally.refused, forecast.refuse);
});

test("a release answering 409 OUTREACH_LETTER_CONFLICT is counted as conflict, not refused", async () => {
  const c = held();
  const rows = await loadCohort([c.entry.id], doFetch);
  const stub = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith("/release")) {
      return new Response(JSON.stringify({ code: "OUTREACH_LETTER_CONFLICT" }), { status: 409, headers: { "content-type": "application/json" } });
    }
    return doFetch(input, init);
  }) as typeof fetch;
  const results = await approveAndReleaseCohort(rows, stub);
  assert.deepEqual(tallyResults(results), { released: 0, queued: 0, refused: 0, conflict: 1 });
});

test("an approve answering 409 OUTREACH_LETTER_CONFLICT is counted as conflict, not refused", async () => {
  const c = held();
  const rows = await loadCohort([c.entry.id], doFetch);
  const stub = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith("/approve")) {
      return new Response(JSON.stringify({ code: "OUTREACH_LETTER_CONFLICT" }), { status: 409, headers: { "content-type": "application/json" } });
    }
    return doFetch(input, init);
  }) as typeof fetch;
  const results = await approveAndReleaseCohort(rows, stub);
  assert.deepEqual(tallyResults(results), { released: 0, queued: 0, refused: 0, conflict: 1 });
});
