// The drain's decisions, pinned where they can be pinned cheaply: the mail→lead
// mapping (a behavioural choice with a real cost attached) and the protocol/ordering
// invariants that make the loop safe to crash in the middle of.
//
// The apply loop itself writes to SQLite through the intake core, so it is exercised
// end-to-end by the receiver's own suites rather than re-mocked here. What is
// UNIQUE to the drain — and what would be silently lost in a refactor — is the
// ORDER of its steps, so that is pinned structurally (the repo's source-guard
// pattern: channels-receiver-contract.test.ts, rate-limit-contract.test.ts).
import { after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// unit-db.ts MUST be the first project import: the drain resolves its config and
// writes its ledger through the store.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { drainEdge, mailToLead, setEdgeHostLookupForTests } from "./edge-drain.ts";
import { getEdgeConfig } from "./edge-config.ts";

after(() => cleanupUnitDb());

const src = readFileSync(fileURLToPath(new URL("./edge-drain.ts", import.meta.url)), "utf8");
const workerSrc = readFileSync(fileURLToPath(new URL("../../edge/src/index.ts", import.meta.url)), "utf8");
const callbackAuthSrc = readFileSync(
  fileURLToPath(new URL("../api/comms/callback/callback-auth.ts", import.meta.url)),
  "utf8"
);

test("an inbound mail becomes a reachable lead built from headers alone", () => {
  assert.deepEqual(mailToLead({ from: "jana@example.cz", name: "Jana Nováková", subject: "Přihláška — Java dev" }), {
    email: "jana@example.cz",
    name: "Jana Nováková",
    message: "Přihláška — Java dev",
  });
});

test("a mail with nothing usable maps to an EMPTY email, so the intake refuses it honestly", () => {
  // The one outcome that must not happen is a lead filed with a fabricated address:
  // the whole point of the lead contract is reachability. An empty email reaches the
  // core's deterministic 422 (missing_email), which is handled, counted and visible.
  assert.deepEqual(mailToLead({}), { email: "", name: "", message: "" });
  assert.deepEqual(mailToLead(null), { email: "", name: "", message: "" });
  assert.deepEqual(mailToLead({ from: 42, subject: ["x"] }), { email: "", name: "", message: "" });
});

test("the drain acks only AFTER applying, and only up to what was applied", () => {
  const applyAt = src.indexOf("outcome = await applyEvent(");
  const ackAt = src.indexOf('edgeFetch(edge, `/ack`');
  assert.ok(applyAt >= 0 && ackAt >= 0, "guard the guard: both steps are still recognizable");
  assert.ok(applyAt < ackAt, "acking before applying would delete events that were never filed");
  assert.match(src, /if \(cursor > pageStart\)/, "nothing to ack unless the cursor actually moved on this page");
  assert.match(
    src,
    /recordDrain\(\{ cursor, error: summary\.error, errorKind: summary\.errorKind, pending: summary\.pending \}\)/,
    "the stored cursor is the applied cursor, and the ledger is written with it"
  );
});

test("a hold breaks the loop instead of skipping the event", () => {
  // The failure mode this prevents: a transient store error advances past a real
  // candidate, the edge deletes it on the next ack, and nobody ever learns.
  const holdAt = src.indexOf('if (outcome === "hold")');
  const advanceAt = src.indexOf("cursor = event.seq;");
  assert.ok(holdAt >= 0 && advanceAt >= 0);
  assert.ok(holdAt < advanceAt, "the hold check must precede the cursor advance");
  assert.match(src.slice(holdAt, advanceAt), /break;/, "a hold stops the page");
});

test("the install signs what the Worker verifies — the same payload on both sides", () => {
  // The two halves of one protocol live in two runtimes and cannot import each
  // other. A drift here is a 401 loop nobody can debug from either side alone.
  assert.match(src, /init\.method === "GET" \? path : \(init\.body \?\? ""\)/, "install: GET signs path+query, POST signs the body");
  assert.match(workerSrc, /verify\(req, env, signed\)/, "worker: verifies against the same choice");
  assert.match(workerSrc, /const signed = `\$\{url\.pathname\}\$\{url\.search\}`/, "worker: the GET side signs path+query");
  assert.match(workerSrc, /`\$\{ts\}\.\$\{signed\}`/, "worker: timestamp-then-payload, as edgeSigningPayload states");
  assert.match(src, /"x-kp-timestamp"/, "install: sends the timestamp the freshness window needs");
  assert.match(workerSrc, /x-kp-timestamp/, "worker: reads it");
});

test("the Worker keeps mail HEADERS only — the promise the mail→lead mapping rests on", () => {
  // mailToLead can only produce a subject-line lead because the edge stores nothing
  // else. If the Worker ever starts persisting the body, that is a threat-model
  // change (CVs at rest on the edge) and must not happen by accident.
  const emailHandler = workerSrc.slice(workerSrc.indexOf("async email("));
  assert.match(emailHandler, /append\(env, "mail", token, \{ from, name, subject \}\)/, "exactly three header-derived fields");
  assert.doesNotMatch(emailHandler, /message\.raw|arrayBuffer\(\)/, "the raw message must never be read into storage");
});

test("the edge deletes what it hands over — it is a queue, not a shadow pipeline", () => {
  const ack = workerSrc.slice(workerSrc.indexOf("async function handleAck"));
  assert.match(ack, /DELETE FROM events WHERE seq <= \?/, "an applied event is forgotten, not archived");
});

test("the edge's relay callback is held to the SAME rules as the install's own", () => {
  // TWO DOORS, ONE CONTRACT. A delivery receipt becomes a `bounced` outbox row on
  // either path, and a bounce is a recruiter-visible claim about a real candidate.
  // The install's door (app/api/comms/callback) is hardened three ways; the Worker's
  // twin was fully open, so anyone who learned the Worker URL could inject bounces.
  // The two cannot import each other, so the mirror is pinned as text — the same
  // device the signing contract above uses.
  const receipt = workerSrc.slice(workerSrc.indexOf("async function handleReceipt"), workerSrc.indexOf("type DrainRow"));
  assert.match(receipt, /KP_CALLBACK_SECRET/, "worker: the route is DISABLED until a secret is configured");
  assert.match(receipt, /503/, "worker: unconfigured means 503, exactly as the install answers");
  assert.match(receipt, /secretsMatch\(req\.headers\.get\("x-comms-secret"\)/, "worker: header only, never the URL");
  assert.match(callbackAuthSrc, /export function secretsMatch/, "install: the same constant-time compare it mirrors");
  assert.match(receipt, /timestampFresh\(timestamp, nowMs\)/, "worker: the freshness window bounds a capture");
  assert.match(callbackAuthSrc, /export function isTimestampFresh/, "install: the rule being mirrored");
  assert.match(receipt, /x-comms-nonce/, "worker: prefers the caller's nonce, as callbackNonce does");
  assert.match(receipt, /409/, "worker: a replayed receipt is refused, not recorded twice");
  // The window itself must be the same number on both sides, or a receipt that is
  // fresh for one door is stale for the other.
  assert.match(callbackAuthSrc, /CALLBACK_TIMESTAMP_WINDOW_MS = 5 \* 60 \* 1000/, "install: 5 minutes");
  assert.match(workerSrc, /const SKEW_MS = 5 \* 60_000/, "worker: the same 5 minutes");
});

test("every authenticated edge door spends a nonce — the comment in edge-crypto.ts is TRUE", () => {
  // edge-crypto.ts states "the edge additionally holds a nonce window". Until the
  // nonces table existed that was a promise the Worker did not keep, and a captured
  // signed `POST /ack {upto}` replayed for five minutes DELETING queued events.
  assert.match(workerSrc, /CREATE TABLE|nonces/, "worker: a nonce store exists");
  assert.match(workerSrc, /async function claimNonce/, "worker: nonces are spent, not merely recorded");
  assert.match(workerSrc, /INSERT OR IGNORE INTO nonces/, "worker: the claim is atomic — insert-or-lose");
  const authorize = workerSrc.slice(workerSrc.indexOf("async function authorize"));
  const authorizeBody = authorize.slice(0, authorize.indexOf("return null;"));
  assert.match(
    authorizeBody,
    /verify\(req, env, signed\)[\s\S]*claimNonce/,
    "verify FIRST, then claim: an unverified caller must not be able to write nonce rows"
  );
  for (const handler of ["handleDrain", "handleAck", "handleHeartbeat", "handlePair"]) {
    const body = workerSrc.slice(workerSrc.indexOf(`async function ${handler}`));
    assert.match(body.slice(0, 900), /authorize\(req, env,/, `${handler} goes through the full door`);
  }
});

test("a storage failure is answered 503, never 400 — a 4xx stops the sender retrying", () => {
  assert.match(workerSrc, /function storageFailure/, "one place produces the answer");
  assert.match(workerSrc, /status: 503/, "the class is 'try again', not 'you sent rubbish'");
  assert.match(workerSrc, /"retry-after": "30"/, "and it says when");
  // The thrown message may name internals; it goes to the log, never the wire.
  const fn = workerSrc.slice(workerSrc.indexOf("function storageFailure"));
  assert.match(fn.slice(0, 700), /console\.error/, "the diagnostic is logged");
  assert.doesNotMatch(fn.slice(0, 700), /JSON\.stringify\(\{ error: `/, "and never interpolated into the response");
});

test("the drain CATCHES UP across pages, under a stated bound", () => {
  // One page per tick meant a 500-event backlog needed ten ticks while the `pending`
  // the edge had just reported was fetched and thrown away. The loop now continues
  // while there is more — but it is BOUNDED, because every applied event is a real
  // intake write and an edge whose `pending` never falls would otherwise spin here.
  assert.match(src, /const MAX_PAGES_PER_DRAIN = 5;/, "the bound is a named constant, not a magic number");
  assert.match(src, /for \(let page = 0; page < MAX_PAGES_PER_DRAIN; page\+\+\)/, "and it is the loop's ceiling");
  // Each of the three ways a page is the last one.
  assert.match(src, /if \(events\.length === 0\) break;/, "an empty page ends the run");
  assert.match(src, /if \(summary\.pending !== null && summary\.pending <= 0\) break;/, "so does an empty queue");
  assert.match(src, /if \(events\.length < MAX_EVENTS_PER_DRAIN\) break;/, "so does a short page");
  // A blocked queue must NOT be retried on the next page: the events are ordered.
  const loop = src.slice(src.indexOf("for (let page = 0"));
  assert.match(loop, /if \(held\) break;/, "a hold or a failed ack stops asking for more");
  // What is left over is not lost, and not silent.
  assert.match(src, /pending: summary\.pending/, "the leftover is PERSISTED for the card to show");
});

// --- the SSRF boundary ----------------------------------------------------------
// The edge URL is operator-supplied and stored; setEdgeConfig vets it with the
// string-level guard, which vets the literal NAME. The drain runs off a clock, so the
// address that answers is resolved fresh here, before a call that carries the edge
// HMAC and (on /ack) a candidate's event sequence numbers.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  setEdgeHostLookupForTests(undefined);
  delete process.env.KP_EDGE_URL;
  delete process.env.KP_EDGE_SECRET;
});

function pairEnvEdge() {
  process.env.KP_EDGE_URL = "https://edge.example.test";
  process.env.KP_EDGE_SECRET = "edge-unit-secret";
}

test("an edge host that RESOLVES private is refused before the drain fetches", async () => {
  pairEnvEdge();
  let fetched = 0;
  globalThis.fetch = (async () => {
    fetched += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  setEdgeHostLookupForTests(async () => [{ address: "169.254.169.254" }]);

  const summary = await drainEdge();

  assert.equal(fetched, 0, "no signed call may leave for a host that resolves into private space");
  assert.equal(summary.errorKind, "unreachable", "the refusal reaches the card through the kind it already renders");
  assert.match(String(summary.error), /non-public address/, "the drain ledger carries the reason");
  assert.equal(getEdgeConfig().lastErrorKind, "unreachable", "and it is durable, not just returned");
});

test("a public edge host still drains (the guard is not a blanket refusal)", async () => {
  pairEnvEdge();
  let asked: string | null = null;
  globalThis.fetch = (async (input: string | URL | Request) => {
    asked = String(input);
    return new Response(JSON.stringify({ events: [], pending: 0 }), { status: 200 });
  }) as typeof fetch;
  setEdgeHostLookupForTests(async () => [{ address: "93.184.216.34" }]);

  const summary = await drainEdge();

  assert.equal(summary.error, null, "a public host must still be drained");
  assert.match(String(asked), /^https:\/\/edge\.example\.test\/drain\?since=/);
});
