// THE CANDIDATE OPT-OUT DOOR — /api/stop/[token].
//
// kp sends candidate outreach, including talent-rediscovery campaigns to people who
// never applied, and carried no unsubscribe of any kind: the only candidate-facing lever
// in every letter was the GDPR "review or erase your data" link. ePrivacy Art. 13(4)
// prohibits a commercial message with no valid address to decline further messages, and
// in this product's primary market § 7(4)(c) with § 11(2)(a)(4) of zák. č. 480/2004 Sb.
// makes it a standalone offence with a fine up to 10,000,000 Kč. Offering erasure as the
// only way to stop the mail is not a substitute — it is the coupling the law forbids.
//
// What this file pins, and why each one would have been a real hole:
//   1. The stop actually STOPS a send: outreachHaltFor, the predicate every send path
//      shares, reports the candidate halt.
//   2. It resolves at the DURABLE CANDIDATE IDENTITY. Rediscovery mints a fresh entry
//      per role with a blank outreach_state, so an entry-scoped opt-out would be
//      re-armed by the next campaign — the exact bypass the consent gate already had to
//      close.
//   3. The token is SCOPED. It opens neither the held-data projection nor the erasure
//      write, and an erasure token does not open this door either.
//   4. The refusal is not an existence oracle: "no such token" and "no such entry" are
//      one answer.
//   5. The limiter runs BEFORE the token lookup on both verbs.
//
// testing/unit-db.ts must stay the FIRST project import so KP_DB_PATH points at the temp
// file before any store loads (the route imports the pipeline store).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { GET, POST } from "./[token]/route.ts";
import {
  anonymizeEntry,
  createPipelineEntry,
  ensureErasureToken,
  ensureOptOutToken,
  findEntryByErasureToken,
  findEntryByOptOutToken,
} from "../../_lib/db/pipeline.ts";
import { candidateOptOutHalt, outreachHaltFor, outreachStateFor, haltOutreach } from "../../_lib/outreach-state-store.ts";
import { RATE_LIMITED_ERROR } from "../../_lib/rate-limit.ts";

after(() => cleanupUnitDb());

const params = (token: string) => ({ params: Promise.resolve({ token }) });

function stop(token: string, ip: string): Promise<Response> {
  return POST(
    new NextRequest(`http://localhost/api/stop/${token}`, { method: "POST", headers: { "x-forwarded-for": ip } }),
    params(token)
  );
}

function view(token: string, ip: string): Promise<Response> {
  return GET(new NextRequest(`http://localhost/api/stop/${token}`, { headers: { "x-forwarded-for": ip } }), params(token));
}

const routeSrc = readFileSync(fileURLToPath(new URL("./[token]/route.ts", import.meta.url)), "utf8").replace(/\r\n/g, "\n");

/** The route's own bounds, read from source so this test can never drift from them. */
function bound(name: string): number {
  const m = routeSrc.match(new RegExp(`const ${name} = \\{ limit: ([\\d_]+), windowMs: ([\\d_]+) \\}`));
  assert.ok(m, `${name} must stay a literal the test can read`);
  return Number(m[1].replace(/_/g, ""));
}

let seq = 0;
function fixture(candidateId: string) {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId,
    candidateLabel: `Opt Out ${seq}`,
    jobId: `stop-job-${seq}`,
    jobTitle: `Stop Test Role ${seq}`,
    stage: "Applied",
    contact: `${candidateId}-${seq}@example.com`,
  });
  return entry;
}

// ---- 1. the stop stops a send ------------------------------------------------------

test("a candidate opt-out halts outreach — the predicate every send path shares reports it", async () => {
  const entry = fixture("stop-c-basic");
  assert.equal(outreachHaltFor(entry.id, entry.workspaceId), null, "nothing halts this entry before the opt-out");

  const token = ensureOptOutToken(entry.id, entry.workspaceId);
  assert.ok(token, "the fixture entry must carry an opt-out token");
  const res = await stop(token, "203.0.113.20");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { stopped: true });

  assert.equal(outreachHaltFor(entry.id, entry.workspaceId), "candidate", "the send gate now refuses this entry");
});

test("the opt-out is a DIFFERENT fact from the recruiter's halt, and outranks it in the reported reason", () => {
  const operatorOnly = fixture("stop-c-operator");
  haltOutreach(operatorOnly.id, operatorOnly.workspaceId);
  assert.equal(outreachHaltFor(operatorOnly.id, operatorOnly.workspaceId), "manual");
  assert.equal(
    outreachStateFor(operatorOnly.id, operatorOnly.workspaceId).candidateHaltAt,
    null,
    "a recruiter halt must never write the candidate's column — that is the fact an operator may clear"
  );

  const both = fixture("stop-c-both");
  haltOutreach(both.id, both.workspaceId);
  const state = outreachStateFor(both.id, both.workspaceId);
  assert.ok(state.manualHaltAt);
  // …and once the candidate objects, THAT is the reason surfaced, because it is the one
  // with legal force rather than workflow force.
  const token = ensureOptOutToken(both.id, both.workspaceId)!;
  return stop(token, "203.0.113.21").then(() => {
    assert.equal(outreachHaltFor(both.id, both.workspaceId), "candidate");
    assert.ok(outreachStateFor(both.id, both.workspaceId).manualHaltAt, "the operator halt is still on the record");
  });
});

// ---- 2. the durable-identity resolution --------------------------------------------

test("the opt-out resolves at the durable identity — a FRESH entry for the same person cannot re-arm contact", async () => {
  const candidateId = "stop-c-durable";
  const first = fixture(candidateId);
  const token = ensureOptOutToken(first.id, first.workspaceId)!;
  assert.equal((await stop(token, "203.0.113.22")).status, 200);

  // Exactly what talent rediscovery does: mint a brand-new pipeline entry for the SAME
  // person under a DIFFERENT role. Its own outreach_state row is empty.
  const rediscovered = fixture(candidateId);
  assert.notEqual(rediscovered.id, first.id, "the rediscovery entry is a different row");
  assert.equal(
    outreachStateFor(rediscovered.id, rediscovered.workspaceId).candidateHaltAt,
    null,
    "the new entry's OWN row carries no halt — which is precisely why an entry-scoped read is not enough"
  );

  assert.equal(
    outreachHaltFor(rediscovered.id, rediscovered.workspaceId),
    "candidate",
    "the person opted out, so the new entry is refused too"
  );
});

test("the opt-out is bounded to the person — someone else's entry is untouched", async () => {
  const mine = fixture("stop-c-mine");
  const theirs = fixture("stop-c-theirs");
  const token = ensureOptOutToken(mine.id, mine.workspaceId)!;
  assert.equal((await stop(token, "203.0.113.23")).status, 200);
  assert.equal(outreachHaltFor(theirs.id, theirs.workspaceId), null, "a stop is not a global mute");
});

test("an entry with NO candidate_id still gets the exact entry-level guarantee", async () => {
  const { entry } = createPipelineEntry({
    candidateId: "",
    candidateLabel: "Anonymous Lead",
    jobId: "stop-job-nolabel",
    jobTitle: "Stop Test Role (no identity)",
    stage: "Applied",
  });
  const token = ensureOptOutToken(entry.id, entry.workspaceId)!;
  assert.equal((await stop(token, "203.0.113.24")).status, 200);
  assert.equal(outreachHaltFor(entry.id, entry.workspaceId), "candidate");
  // …and a blank candidate_id must not fan the halt out to every other blank-id row.
  const other = createPipelineEntry({
    candidateId: "",
    candidateLabel: "Another Anonymous Lead",
    jobId: "stop-job-nolabel-2",
    jobTitle: "Stop Test Role (no identity 2)",
    stage: "Applied",
  }).entry;
  assert.equal(
    outreachHaltFor(other.id, other.workspaceId),
    null,
    "an empty candidate_id is not an identity — it must never join two different people"
  );
});

// ---- 3. the token is SCOPED ---------------------------------------------------------

test("the opt-out token opens NOTHING but this door", () => {
  const entry = fixture("stop-c-scope");
  const optOut = ensureOptOutToken(entry.id, entry.workspaceId)!;
  const erasure = ensureErasureToken(entry.id, entry.workspaceId)!;

  assert.notEqual(optOut, erasure, "the two capabilities must not be the same string");
  assert.equal(
    findEntryByErasureToken(optOut),
    null,
    "an opt-out token must not resolve on the erasure door — that would make 'stop the mail' a door to erasure"
  );
  assert.equal(
    findEntryByOptOutToken(erasure),
    null,
    "…and the erasure token must not resolve here either; neither key opens the other lock"
  );
  assert.equal(findEntryByOptOutToken(optOut)?.id, entry.id, "its own door still opens");
});

test("the stop route reads and writes ONLY the opt-out surface — it can neither project held data nor erase", () => {
  // A source guard, because the damage would be a future edit rather than today's code:
  // the two functions that make the /data door consequential must never appear here.
  assert.doesNotMatch(routeSrc, /\banonymizeEntry\b/, "the opt-out door must never reach the erasure write");
  assert.doesNotMatch(routeSrc, /\bheldDataCategories\b/, "the opt-out door must never project what we hold");
  assert.doesNotMatch(routeSrc, /\bfindEntryByErasureToken\b/, "it resolves its OWN token only");
});

test("the GET is an explicit allowlist — no internal id, name, score or stage on the wire", async () => {
  const entry = fixture("stop-c-projection");
  const token = ensureOptOutToken(entry.id, entry.workspaceId)!;
  const body = (await (await view(token, "203.0.113.25")).json()) as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(body).sort(),
    ["company", "jobTitle", "stopped"],
    "the projection is a fixed field list, never a serialized store row"
  );
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, new RegExp(entry.id), "the internal entry id must not reach a public wire");
  assert.doesNotMatch(serialized, /Opt Out/, "the candidate's own label is not part of the answer");
});

test("the GET reports an ALREADY-stopped person honestly, resolved the same way the send gate resolves", async () => {
  const candidateId = "stop-c-already";
  const first = fixture(candidateId);
  assert.equal((await stop(ensureOptOutToken(first.id, first.workspaceId)!, "203.0.113.26")).status, 200);

  // A link from an OLDER letter about a DIFFERENT role must not tell the candidate they
  // are still subscribed when the sender already refuses to mail them.
  const other = fixture(candidateId);
  const body = (await (await view(ensureOptOutToken(other.id, other.workspaceId)!, "203.0.113.26")).json()) as {
    stopped: boolean;
  };
  assert.equal(body.stopped, true);
});

// ---- 4. no existence oracle ---------------------------------------------------------

test("a token that resolves to nothing answers ONE refusal, whatever the reason", async () => {
  const unknown = await view("ob-never-minted", "203.0.113.30");
  assert.equal(unknown.status, 404);
  const unknownBody = await unknown.json();

  // A token that WAS minted and then spent by an erasure: the entry exists, the token
  // does not. A different cause, and it must be indistinguishable.
  const erased = fixture("stop-c-erased");
  const token = ensureOptOutToken(erased.id, erased.workspaceId)!;
  anonymizeEntry(erased.id, "erasure", erased.workspaceId);
  const spent = await view(token, "203.0.113.30");
  assert.equal(spent.status, 404);
  assert.deepEqual(await spent.json(), unknownBody, "both readings share one refusal — the door is not an oracle");
  assert.equal((await stop(token, "203.0.113.30")).status, 404, "and the write half answers the same way");
});

// ---- 5. the throttle ----------------------------------------------------------------

test("POST: the limiter runs before the token lookup — unknown tokens 404 up to the bound, then 429", async () => {
  const limit = bound("STOP_WRITE_RATE_LIMIT");
  const token = "ob-write-flood";
  for (let i = 0; i < limit; i++) {
    assert.equal((await stop(token, "203.0.113.40")).status, 404, `hit ${i + 1} under the bound is a plain lookup miss`);
  }
  const refused = await stop(token, "203.0.113.40");
  assert.equal(refused.status, 429, "the next hit inside the window is refused before any lookup");
  // The CODED refusal, not a bare English sentence: this is a PUBLIC door a candidate
  // reaches from a letter written in their own language.
  assert.deepEqual(await refused.json(), { error: RATE_LIMITED_ERROR, code: "TOO_MANY_REQUESTS" });
});

test("GET: the read side is throttled too, generously enough that a candidate never meets it", async () => {
  const limit = bound("STOP_VIEW_RATE_LIMIT");
  assert.ok(limit >= 30, "a candidate opening their own unsubscribe page must never meet the read bound");
  const token = "ob-view-flood";
  for (let i = 0; i < limit; i++) {
    assert.equal((await view(token, "203.0.113.41")).status, 404);
  }
  assert.equal((await view(token, "203.0.113.41")).status, 429);
});

test("the write is idempotent — a second click, or a mail client's unattended POST, changes nothing", async () => {
  const entry = fixture("stop-c-idempotent");
  const token = ensureOptOutToken(entry.id, entry.workspaceId)!;
  assert.equal((await stop(token, "203.0.113.42")).status, 200);
  const first = outreachStateFor(entry.id, entry.workspaceId).candidateHaltAt;
  assert.ok(first);
  assert.equal((await stop(token, "203.0.113.42")).status, 200, "the replay answers the same thing");
  assert.equal(
    outreachStateFor(entry.id, entry.workspaceId).candidateHaltAt,
    first,
    "the FIRST objection timestamp is kept — that is the date a regulator would ask about"
  );
  assert.equal(candidateOptOutHalt(entry.id), "candidate");
});

test("the RFC 8058 one-click request — the EXACT shape a mail provider sends — records the stop and answers 200", async () => {
  // The header kp asks the relay to emit (`List-Unsubscribe-Post: List-Unsubscribe=One-Click`)
  // is a promise about THIS route: a provider POSTs it unattended, with no session, no
  // cookie and a form body the route must tolerate. Every other write test here posts an
  // empty body, so the shape the promise is actually about was never exercised.
  const entry = fixture("stop-c-one-click");
  const token = ensureOptOutToken(entry.id, entry.workspaceId)!;
  const res = await POST(
    new NextRequest(`http://localhost/api/stop/${token}`, {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.43", "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    }),
    params(token)
  );
  assert.equal(res.status, 200, "RFC 8058 requires a 200 on success — a provider treats anything else as a broken link");
  assert.deepEqual(await res.json(), { stopped: true });
  assert.equal(candidateOptOutHalt(entry.id), "candidate", "the unattended POST really recorded the objection");
});
