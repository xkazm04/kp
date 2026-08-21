// TENANCY pin for the publish door, driven through the REAL route handler.
//
// The defect: `getDevCase(body.caseId)` is a by-id point read on a globally-unique id,
// so it happily returns ANOTHER team's approved case — and `createPosting` then inherits
// the CASE's workspace. Publishing a foreign caseId therefore (a) minted a live apply
// token inside that team's studio, or, once they had already published, (b) re-selected
// their EXISTING open posting and handed its token straight back in the response. That
// token is the bearer credential for their candidate surface: it starts work sessions,
// spends their dev-case chat budget and injects submissions into their funnel.
// `/api/devcase/source` and `/api/devcase/promote` already refuse a foreign entity
// (devcase-source-promote-tenancy.test.ts); this route was the hole in the same wall.
//
// The handler takes its tenant from currentWorkspace(), which reads cookies() — that
// throws outside a request and falls back to the DEFAULT workspace, so the caller here
// IS the default team and a case owned by anyone else must be refused.
//
// unit-db.ts MUST be the first project import (sets KP_DB_PATH before any store resolves).
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// Point next/server at the test shim BEFORE the route loads (hooks only affect LATER
// resolutions — hence the dynamic imports below).
register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const { saveDevCase, listPostings } = await import("../../../_lib/db/devcase.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../../../_lib/db/workspaces.ts");
const { POST } = await import("./route.ts");

after(() => cleanupUnitDb());

const WS_THEIRS = "ws-publish-beta";

function publishReq(caseId: string) {
  return new Request("http://localhost/api/devcase/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ caseId }),
  }) as never;
}

test("publishing ANOTHER team's case is refused, and mints no posting in their studio", async () => {
  const theirs = saveDevCase(
    { need: {}, analysis: {}, role: { title: "Backend Engineer" }, case: { title: "Cache invalidation" } },
    WS_THEIRS
  );

  const res = await POST(publishReq(theirs.id));
  // Pre-fix this was 200 and the body carried their posting + its live apply token.
  assert.equal(res.status, 404, "a known case id from another team must not be publishable");
  const body = (await res.json()) as { posting?: { token?: string } };
  assert.equal(body.posting, undefined, "no posting (and so no apply token) may cross the tenant boundary");
  assert.equal(listPostings(WS_THEIRS).length, 0, "nothing was published into the other team's studio");
});

test("publishing your OWN team's case still works (the guard is not over-broad)", async () => {
  const mine = saveDevCase(
    { need: {}, analysis: {}, role: { title: "Backend Engineer" }, case: { title: "API case" } },
    DEFAULT_WORKSPACE_ID
  );

  const res = await POST(publishReq(mine.id));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { posting?: { caseId?: string; token?: string; status?: string } };
  assert.equal(body.posting?.caseId, mine.id);
  assert.equal(body.posting?.status, "open");
  assert.ok(body.posting?.token, "the caller gets the apply token for the case they own");
});
