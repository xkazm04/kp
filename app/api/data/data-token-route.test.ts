// Behavioral coverage for the throttle on /api/data/[token] — the Art. 17 erasure
// door. The POST performs an IRREVERSIBLE anonymizeEntry, and until 2026-09-01 it
// was the one public token door with no limiter while every sibling (status,
// offer, schedule, apply) had one. The limiter must sit BEFORE the token lookup,
// so a flood of guesses against this route is refused cheaply — which is exactly
// what this test drives: unknown tokens answer 404 up to the bound, and the next
// hit inside the window is 429, never another lookup.
//
// testing/unit-db.ts must stay the first project import so KP_DB_PATH points at
// the temp file before any store loads (the route imports the pipeline store).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { GET, POST } from "./[token]/route.ts";
import { createPipelineEntry, ensureErasureToken, findEntryByErasureToken } from "../../_lib/db/pipeline.ts";
import { RATE_LIMITED_ERROR } from "../../_lib/rate-limit.ts";

after(() => cleanupUnitDb());

const params = (token: string) => ({ params: Promise.resolve({ token }) });

function erase(token: string, ip: string): Promise<Response> {
  return POST(
    new NextRequest(`http://localhost/api/data/${token}`, {
      method: "POST",
      headers: { "x-forwarded-for": ip },
    }),
    params(token)
  );
}

function view(token: string, ip: string): Promise<Response> {
  return GET(new NextRequest(`http://localhost/api/data/${token}`, { headers: { "x-forwarded-for": ip } }), params(token));
}

/** The route's own bounds, read from source so this test can never drift from them. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const routeSrc = readFileSync(fileURLToPath(new URL("./[token]/route.ts", import.meta.url)), "utf8");
function bound(name: string): number {
  const m = routeSrc.match(new RegExp(`const ${name} = \\{ limit: ([\\d_]+), windowMs: ([\\d_]+) \\}`));
  assert.ok(m, `${name} must stay a literal the test can read`);
  return Number(m[1].replace(/_/g, ""));
}

test("erasure POST: the limiter runs before the token lookup — unknown tokens 404 up to the bound, then 429", async () => {
  const limit = bound("DATA_ERASE_RATE_LIMIT");
  const token = "tk-erase-flood";
  for (let i = 0; i < limit; i++) {
    const res = await erase(token, "203.0.113.7");
    assert.equal(res.status, 404, `hit ${i + 1} under the bound is a plain lookup miss`);
  }
  const refused = await erase(token, "203.0.113.7");
  assert.equal(refused.status, 429, "the next hit inside the window is refused before any lookup");
  // The CODED refusal, not a bare English sentence: this is a PUBLIC door a candidate
  // reaches from an email written in their own language, so the wire carries the code
  // the client resolves and the canonical message only as the log/API-consumer copy.
  assert.deepEqual(await refused.json(), { error: RATE_LIMITED_ERROR, code: "TOO_MANY_REQUESTS" });
});

test("erasure POST: a real token still erases once, and the bucket is per token — a sibling link is unaffected", async () => {
  const { entry } = createPipelineEntry({
    candidateId: "erase-c1",
    candidateLabel: "Erase Candidate",
    jobId: "erase-job-1",
    jobTitle: "Erase Test Role",
    stage: "Applied",
    contact: "erase-c1@example.com",
  });
  const token = ensureErasureToken(entry.id);
  assert.ok(token, "the fixture entry must carry an erasure token");
  const res = await erase(token, "203.0.113.7");
  assert.equal(res.status, 200, "a flood against another token never charges this candidate's bucket");
  assert.deepEqual(await res.json(), { erased: true });
  assert.equal(findEntryByErasureToken(token), null, "the token is spent on first erasure (idempotent replay 404s)");
});

test("data GET: the read side is throttled too, generously — the bound sits well above any page's revalidation", async () => {
  const limit = bound("DATA_VIEW_RATE_LIMIT");
  assert.ok(limit >= 30, "a candidate reading their own data page must never meet the read bound in normal use");
  const token = "tk-view-flood";
  for (let i = 0; i < limit; i++) {
    assert.equal((await view(token, "203.0.113.9")).status, 404);
  }
  assert.equal((await view(token, "203.0.113.9")).status, 429);
});
