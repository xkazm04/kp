// A write to an analytics setting must be VISIBLE to the very next read.
//
// What was true before this file existed: /api/analytics memoizes its payload per
// (workspace, window) for 20 s and NEITHER write door cleared it. Both doors are
// inline editors that call `reload()` the moment they succeed — so the read they
// themselves trigger lands milliseconds later and was served the PRE-WRITE payload
// for the rest of the TTL. A recruiter set a time-to-hire goal, watched the panel
// refresh, and read back the old goal line, with nothing on screen saying why.
//
// Driven as REAL handlers (route module in, Response out) against a throwaway
// SQLite file — a unit test over the cache alone could not have caught it, because
// the defect was that the route never called the cache's invalidator at all.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import type { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";

// next/server must resolve to the shared test shim BEFORE the routes load — hooks
// only affect later resolutions, hence the dynamic imports below.
register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// No KP_OPERATOR_PASSWORD: open dev mode folds every caller to owner, which is what
// this file wants — authority is the sibling analytics-writes-authority.test.ts's
// subject, and a session fixture here would only add a way for THIS test to fail for
// a reason that is not its own.
const { GET: readAnalytics } = await import("./route.ts");
const { POST: setTarget } = await import("./targets/route.ts");
const { POST: setSpend } = await import("./spend/route.ts");
const { createPipelineEntry } = await import("../../_lib/db/pipeline.ts");

after(() => cleanupUnitDb());

const post = (url: string, body: unknown): NextRequest =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest;

type Payload = {
  targets: { conversion: Record<string, number>; timeToHireDays: number | null };
  byChannel: { channel: string; spendCzk: number | null }[];
};

const readAll = async (): Promise<Payload> =>
  (await (await readAnalytics(new Request("http://localhost/api/analytics"))).json()) as Payload;

// One real entry on a known channel, so `byChannel` carries a row the spend write
// can attach a figure to.
createPipelineEntry({
  candidateId: "inv-c1",
  candidateLabel: "Invalidation Tester",
  jobId: "inv-job-1",
  jobTitle: "Invalidation Test Role",
  matchScore: 70,
  sourceChannel: "linkedin",
});

test("a target write is visible to the read that follows it, inside the memo TTL", async () => {
  // Warm the memo FIRST — that is the whole scenario: the panel was on screen and
  // had already read the payload before the recruiter typed anything.
  assert.equal((await readAll()).targets.timeToHireDays, null, "fixture: no goal set yet");

  const res = await setTarget(post("/api/analytics/targets", { metric: "time_to_hire", value: 30 }));
  assert.equal(res.status, 200);

  assert.equal(
    (await readAll()).targets.timeToHireDays,
    30,
    "the read straight after the write served a memoized pre-write payload",
  );
});

test("a cleared target is visible to the read that follows it", async () => {
  assert.equal((await readAll()).targets.timeToHireDays, 30, "fixture: the previous test's goal stands");
  assert.equal((await setTarget(post("/api/analytics/targets", { metric: "time_to_hire", value: null }))).status, 200);
  assert.equal((await readAll()).targets.timeToHireDays, null, "clearing a goal is a write like any other");
});

test("a channel spend write is visible to the read that follows it", async () => {
  const before = (await readAll()).byChannel.find((c) => c.channel === "linkedin");
  assert.ok(before, "fixture: the seeded entry produced a linkedin channel row");
  assert.equal(before.spendCzk, null, "fixture: no spend recorded yet");

  assert.equal((await setSpend(post("/api/analytics/spend", { channel: "linkedin", amountCzk: 25_000 }))).status, 200);

  assert.equal(
    (await readAll()).byChannel.find((c) => c.channel === "linkedin")?.spendCzk,
    25_000,
    "the cost-per-hire denominator the recruiter just entered must be the one that comes back",
  );
});
