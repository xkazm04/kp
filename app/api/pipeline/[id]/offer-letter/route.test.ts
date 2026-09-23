// GET /api/pipeline/[id]/offer-letter - the side-effect-free preview of the offer
// letter the approval card is about to send (challenge-r06 comms-dispatch-relay/B).
//
// Open mode (no KP_OPERATOR_PASSWORD): requireOperator is a no-op and currentWorkspace
// falls back to the default team outside a request scope - the ats-routes-auth shape.
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "../../../../_lib/testing/unit-db.ts";
import { createPipelineEntry, setApproval } from "../../../../_lib/db/pipeline.ts";
import { defaultOfferTtlDays } from "../../../../_lib/offer-policy.ts";
import { GET } from "./route.ts";

after(() => cleanupUnitDb());

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTE_SRC = readFileSync(resolve(HERE, "route.ts"), "utf8");
const API_REFERENCE = readFileSync(resolve(HERE, "../../../../../docs/architecture/api-reference.md"), "utf8");

let seq = 0;
function entry(approval: "offer_review" | "screening_review" | null) {
  seq += 1;
  const { entry: e } = createPipelineEntry({
    candidateId: `ol-route-c${seq}`,
    candidateLabel: `Route Candidate ${seq}`,
    jobId: `ol-route-job-${seq}`,
    jobTitle: "Data Engineer",
    stage: "Offer",
    locale: "en",
  });
  if (approval) setApproval(e.id, approval, JSON.stringify({ subject: "Offer", body: "Hello." }));
  return e;
}

function get(id: string, query = "") {
  return GET(new Request(`http://localhost:3000/api/pipeline/${id}/offer-letter${query}`), {
    params: Promise.resolve({ id }),
  });
}

test("6a. an entry not at offer_review answers 409 with a coded refusal", async () => {
  const res = await get(entry("screening_review").id, "?ttlDays=10");
  assert.equal(res.status, 409);
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, "OFFER_LETTER_NOT_PENDING");
});

test("6b. an unknown entry answers 404 PIPELINE_ENTRY_NOT_FOUND", async () => {
  const res = await get("no-such-entry", "?ttlDays=10");
  assert.equal(res.status, 404);
  assert.equal(((await res.json()) as { code?: string }).code, "PIPELINE_ENTRY_NOT_FOUND");
});

test("6c. ttlDays is resolved, never refused: in range is honoured, out of range falls back", async () => {
  const id = entry("offer_review").id;
  const ok = await get(id, "?ttlDays=10");
  assert.equal(ok.status, 200);
  const preview = (await ok.json()) as { ttlDays?: number; subject?: string; body?: string; forecast?: string };
  assert.equal(preview.ttlDays, 10);
  assert.equal(preview.subject, "Offer");
  assert.ok(preview.body?.startsWith("Hello."));
  assert.equal(preview.forecast, "local");
  const wild = await get(id, "?ttlDays=9999");
  assert.equal(wild.status, 200);
  assert.equal(((await wild.json()) as { ttlDays?: number }).ttlDays, defaultOfferTtlDays());
  const junk = await get(id, "?ttlDays=abc");
  assert.equal(junk.status, 200);
});

test("7. the route gates on requireOperator first and has its api-reference row", () => {
  const gate = ROUTE_SRC.search(/const\s+denied\s*=\s*await\s+requireOperator\(\)\s*;?\s*if\s*\(\s*denied\s*\)\s*return\s+denied/);
  assert.ok(gate >= 0, "requireOperator is called");
  assert.ok(gate < ROUTE_SRC.indexOf("getPipelineEntry("), "before any store read");
  assert.match(API_REFERENCE, /\| `\/api\/pipeline\/\[id\]\/offer-letter` \| GET \| gated \|/);
});
