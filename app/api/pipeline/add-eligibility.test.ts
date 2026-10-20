// POST /api/pipeline honours THE rediscovery eligibility gate (withheldCandidateIds,
// rediscovery-eligibility.ts) on a RE-SURFACE add — source "rediscovery" (the feed's
// Add button) or "sourcing" (the recruiter/rediscover panels) — the same predicate the
// rank, the alert write wall, the feed read and the Reach-out door already ask. A
// direct call used to file an opted-out or consent-lapsed person onto a board the
// ranker had deliberately kept them off.
//
// A HUMAN add with no re-surface marker (manual board add, match, re-application) is
// NOT refused: an opt-out stops outreach, it does not withdraw a person from a process
// (docs/features/comms/README.md, "Candidate opt-out"). What keeps that person from
// being CONTACTED is the channel gate (commsSendSuppression), which resolves at the
// durable candidate identity — pinned here on the entry the manual add minted.
//
// testing/unit-db.ts must stay the FIRST project import (throwaway KP_DB_PATH).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { POST as boardPost } from "./route.ts";
import { createPipelineEntry, recordEntryConsent } from "../../_lib/db/pipeline.ts";
import { recordCandidateOptOut } from "../../_lib/outreach-state-store.ts";
import { commsSendSuppression } from "../../_lib/comms.ts";
import { ensureDb } from "../../_lib/db/core.ts";

after(() => cleanupUnitDb());

let seq = 0;
/** A person who already has one entry (the prior role), with live consent. */
function priorEntry(candidateId: string) {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId,
    candidateLabel: `Eligibility Subject ${seq}`,
    jobId: `elig-prior-job-${seq}`,
    jobTitle: "Prior Role",
    stage: "Applied",
    contact: `${candidateId}@example.com`,
  });
  recordEntryConsent(entry.id, "test", 365, entry.workspaceId);
  return entry;
}

function add(candidateId: string, jobId: string, source?: string) {
  return boardPost(
    new NextRequest("http://localhost/api/pipeline", {
      method: "POST",
      body: JSON.stringify({ candidateId, jobId, jobTitle: "New Role", ...(source ? { source } : {}) }),
      headers: { "content-type": "application/json" },
    })
  );
}

const entriesFor = (candidateId: string, jobId: string) =>
  (ensureDb().prepare(`SELECT COUNT(*) AS n FROM pipeline_entries WHERE candidate_id = ? AND job_id = ?`).get(candidateId, jobId) as { n: number }).n;

for (const source of ["rediscovery", "sourcing"]) {
  test(`a ${source} re-surface of an OPTED-OUT person is refused with a coded 409 and files nothing`, async () => {
    const cid = `elig-optout-${source}`;
    const prior = priorEntry(cid);
    recordCandidateOptOut(prior.id, prior.workspaceId);

    const res = await add(cid, `elig-new-${source}`, source);
    assert.equal(res.status, 409);
    const body = (await res.json()) as { code: string; withheld: string };
    assert.equal(body.code, "PIPELINE_ADD_CANDIDATE_WITHHELD");
    assert.equal(body.withheld, "opted_out");
    assert.equal(entriesFor(cid, `elig-new-${source}`), 0, "no entry may be minted for the new role");
  });
}

test("a rediscovery re-surface of a CONSENT-LAPSED person is refused with its own reason", async () => {
  const cid = "elig-lapsed";
  const prior = priorEntry(cid);
  recordEntryConsent(prior.id, "test", -1, prior.workspaceId); // ttl -1 ⇒ already expired

  const res = await add(cid, "elig-new-lapsed", "rediscovery");
  assert.equal(res.status, 409);
  const body = (await res.json()) as { code: string; withheld: string };
  assert.equal(body.code, "PIPELINE_ADD_CANDIDATE_WITHHELD");
  assert.equal(body.withheld, "consent_expired");
  assert.equal(entriesFor(cid, "elig-new-lapsed"), 0);
});

test("an eligible person re-surfaced by rediscovery is filed as before", async () => {
  const cid = "elig-ok";
  priorEntry(cid);
  const res = await add(cid, "elig-new-ok", "rediscovery");
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { created: boolean }).created, true);
});

test("a HUMAN add with no re-surface marker still files an opted-out person — and the channel still refuses to contact them", async () => {
  const cid = "elig-manual";
  const prior = priorEntry(cid);
  recordCandidateOptOut(prior.id, prior.workspaceId);

  const res = await add(cid, "elig-new-manual");
  assert.equal(res.status, 200, "an opt-out stops outreach; it does not withdraw a person a human deliberately files");
  const { entry, created } = (await res.json()) as { entry: { id: string }; created: boolean };
  assert.equal(created, true);
  assert.equal(
    commsSendSuppression({ to: "x", subject: "s", body: "b", kind: "outreach", ref: entry.id }),
    "candidate",
    "the fresh entry inherits the person's opt-out at the send door"
  );
});
