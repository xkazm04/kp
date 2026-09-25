// PATCH /api/gigs/[id] { action: "route" | "unroute" } on an isolated DB, in open auth
// mode (unit-db.ts scrubs the password): the input refusal, the coded 409s, and a route +
// unroute round trip. The routing rules themselves are pinned in gigs/routing.test.ts.
//
// unit-db.ts must be the first project import (it sets KP_DB_PATH before any store opens).
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WORKSPACE_ID } from "../../_lib/db/workspaces.ts";
import { getGig, transitionGig } from "../../_lib/db/gigs.ts";
import { fixtureGig, fixtureSpecialist } from "../../_lib/gigs/__fixtures__/sent-gig.ts";
import { PATCH as PATCH_GIG } from "./[id]/route.ts";

const WS = DEFAULT_WORKSPACE_ID;

after(() => cleanupUnitDb());

function patch(body: unknown): Request {
  return new Request("http://localhost/api/gigs/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function answer(res: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

test("route needs a specialistId (400 GIG_INPUT_INVALID naming the field)", async () => {
  const gig = fixtureGig(WS, { arena: "freelance" });
  for (const body of [{ action: "route" }, { action: "route", specialistId: "  " }, { action: "route", specialistId: 7 }]) {
    const r = await answer(await PATCH_GIG(patch(body), params(gig.id)));
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "GIG_INPUT_INVALID");
    assert.equal(r.body.field, "specialistId");
  }
});

test("route + unroute round trip; the refusals are coded 404 / 409", async () => {
  const spec = fixtureSpecialist(WS, "freelance");
  const other = fixtureSpecialist(WS, "security");
  const pending = fixtureSpecialist(WS, "freelance", "pending_approval", null);
  const gig = fixtureGig(WS, { arena: "freelance" });

  const routed = await answer(await PATCH_GIG(patch({ action: "route", specialistId: spec.id }), params(gig.id)));
  assert.equal(routed.status, 200);
  const g = routed.body.gig as { specialistId: string; niche: string };
  assert.equal(g.specialistId, spec.id);
  assert.equal(g.niche, spec.spec.niche);

  const mismatch = await answer(await PATCH_GIG(patch({ action: "route", specialistId: other.id }), params(gig.id)));
  assert.deepEqual([mismatch.status, mismatch.body.code], [409, "GIG_ROUTE_ARENA_MISMATCH"]);

  const notReady = await answer(await PATCH_GIG(patch({ action: "route", specialistId: pending.id }), params(gig.id)));
  assert.deepEqual([notReady.status, notReady.body.code, notReady.body.detail], [409, "GIG_SPECIALIST_NOT_READY", "hire_pending_approval"]);

  const unrouted = await answer(await PATCH_GIG(patch({ action: "unroute" }), params(gig.id)));
  assert.equal(unrouted.status, 200);
  assert.equal((unrouted.body.gig as { niche: string | null }).niche, null);

  const missing = await answer(await PATCH_GIG(patch({ action: "unroute" }), params("gig-nope")));
  assert.deepEqual([missing.status, missing.body.code], [404, "GIG_NOT_FOUND"]);

  // Never while a run holds the specialist.
  const cur = getGig(WS, gig.id)!;
  if (cur.status === "new") assert.ok(transitionGig(WS, gig.id, { from: "new", to: "qualified" }).ok);
  assert.ok(transitionGig(WS, gig.id, { from: "qualified", to: "dispatched" }).ok);
  const busy = await answer(await PATCH_GIG(patch({ action: "route", specialistId: spec.id }), params(gig.id)));
  assert.deepEqual([busy.status, busy.body.code, busy.body.gigStatus], [409, "GIG_ACTION_NOT_ALLOWED", "dispatched"]);
});
