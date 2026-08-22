// The drain's decisions, pinned where they can be pinned cheaply: the mail→lead
// mapping (a behavioural choice with a real cost attached) and the protocol/ordering
// invariants that make the loop safe to crash in the middle of.
//
// The apply loop itself writes to SQLite through the intake core, so it is exercised
// end-to-end by the receiver's own suites rather than re-mocked here. What is
// UNIQUE to the drain — and what would be silently lost in a refactor — is the
// ORDER of its steps, so that is pinned structurally (the repo's source-guard
// pattern: channels-receiver-contract.test.ts, rate-limit-contract.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mailToLead } from "./edge-drain.ts";

const src = readFileSync(fileURLToPath(new URL("./edge-drain.ts", import.meta.url)), "utf8");
const workerSrc = readFileSync(fileURLToPath(new URL("../../edge/src/index.ts", import.meta.url)), "utf8");

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
  assert.match(src, /if \(cursor > edge\.cursor\)/, "nothing to ack unless the cursor actually moved");
  assert.match(src, /recordDrain\(\{ cursor, error: summary\.error \}\)/, "the stored cursor is the applied cursor");
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
