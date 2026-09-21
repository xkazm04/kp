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
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { commsSendSuppression, setRelayHostLookupForTests } from "./comms.ts";
import { buildCommEnvelope, LIST_UNSUBSCRIBE_POST_ONE_CLICK, type CommEnvelope } from "./comms-envelope.ts";
import { createPipelineEntry, findEntryByOptOutToken, recordEntryConsent } from "./db/pipeline.ts";
import { recordCandidateOptOut } from "./outreach-state-store.ts";
import { dispatchRejection } from "./comms-dispatch.ts";

after(() => cleanupUnitDb());

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  setRelayHostLookupForTests(undefined);
  delete process.env.COMMS_WEBHOOK_URL;
  delete process.env.APP_BASE_URL;
});

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

// ---- the PRODUCER, end to end ------------------------------------------------------
//
// The envelope test above hand-feeds a URL that the producer never produced, so for the
// life of that assertion the header was pinned and the thing that BUILDS it was not.
// comms-dispatch.ts aimed `unsubscribeUrl` at `<base>/stop/<token>` — the human PAGE,
// which exports no POST — while the envelope stamped it into `List-Unsubscribe` beside
// `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Every provider that honoured the
// one-click directive POSTed a page route, got 405, and the opt-out was never recorded.
// So the assertions below run a REAL dispatcher and read the wire the relay is handed.

/** A resolver answering one ordinary public address — delivery RESOLVES the relay host
 *  before it posts (SSRF guard), and `relay.example.test` is a fixture no DNS knows. */
const PUBLIC_LOOKUP = async () => [{ address: "93.184.216.34" }];

/** Install a fake relay and capture the kp.comm.v1 envelopes it is POSTed. */
function captureEnvelopes(): CommEnvelope[] {
  const seen: CommEnvelope[] = [];
  process.env.COMMS_WEBHOOK_URL = "https://relay.example.test/hook";
  setRelayHostLookupForTests(PUBLIC_LOOKUP);
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    seen.push(JSON.parse(String(init.body)) as CommEnvelope);
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  return seen;
}

test("the dispatcher aims the List-Unsubscribe header at the POST route and the footer at the page", async () => {
  process.env.APP_BASE_URL = "https://kp.example.com";
  // An explicit locale so the ?lang= pin below asserts a value, not the ambient default.
  const { entry } = createPipelineEntry({
    candidateId: "gate-c-producer",
    candidateLabel: "Producer Subject",
    jobId: "gate-producer-job",
    jobTitle: "Producer Role",
    stage: "Applied",
    contact: "producer@example.com",
    locale: "en",
  });
  recordEntryConsent(entry.id, "test", 365, entry.workspaceId);
  const envelopes = captureEnvelopes();

  await dispatchRejection(entry);

  assert.equal(envelopes.length, 1, "the letter reached the relay");
  const env = envelopes[0];

  // THE HEADER TARGET — what a mail provider POSTs unattended.
  const header = env.listUnsubscribe ?? "";
  assert.match(
    header,
    /^<https:\/\/kp\.example\.com\/api\/stop\/ob-[A-Za-z0-9_~.-]+>$/,
    "List-Unsubscribe must name /api/stop/<token>, the route that serves POST"
  );
  assert.ok(
    !/^<https:\/\/kp\.example\.com\/stop\//.test(header),
    "the page route serves no POST: a One-Click provider would get 405 and the opt-out would be lost"
  );
  assert.equal(env.listUnsubscribePost, LIST_UNSUBSCRIBE_POST_ONE_CLICK);

  // …and it is a LIVE capability, not a well-shaped string: the token in the header
  // resolves to this very entry, so the unattended POST opens the right door.
  const token = header.slice(1, -1).split("/").pop() ?? "";
  assert.equal(findEntryByOptOutToken(decodeURIComponent(token))?.id, entry.id);

  // THE VISIBLE FOOTER — what a person clicks. The explainer PAGE, ?lang=-pinned like
  // the erasure link beside it; a candidate must never be sent to a JSON endpoint.
  assert.match(
    env.body,
    /https:\/\/kp\.example\.com\/stop\/ob-[A-Za-z0-9_~.-]+\?lang=en/,
    "the footer link opens the /stop/<token> page in the letter's language"
  );
  assert.ok(!env.body.includes("kp.example.com/api/stop/"), "the API endpoint never appears in prose a candidate reads");
});

test("the two halves point at DIFFERENT routes, and only one of them answers a POST", () => {
  // The reason they diverge, asserted against the routes themselves rather than trusted:
  // collapse them back into one URL and one of these two files stops matching.
  const here = fileURLToPath(new URL("./", import.meta.url));
  const api = readFileSync(join(here, "..", "api", "stop", "[token]", "route.ts"), "utf8").replace(/\r\n/g, "\n");
  const page = readFileSync(join(here, "..", "stop", "[token]", "page.tsx"), "utf8").replace(/\r\n/g, "\n");
  assert.match(api, /export async function POST\(/, "/api/stop/[token] is the one-click target and must export POST");
  assert.match(api, /export async function GET\(/, "…and the page's own read goes through the same route");
  assert.ok(!/export async function POST\(/.test(page), "/stop/[token] is a page — a POST to it 405s, which is the whole defect");
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
