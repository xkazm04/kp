// GET /api/jds — the JD library list. It took NO Request at all and called
// `listJds(200, ws)`, so the `?limit=` the analyze picker has been sending since
// JD_LIBRARY_LIMIT landed was unreadable by construction, and the answer was a
// bare `{ jds }`: a slice cut at a server-side constant, presented as the library.
// The jobs list beside it has answered `{ truncated, limit }` since listJobsPage.
//
// This drives the REAL handler on a throwaway SQLite file in OPEN mode
// (KP_OPERATOR_PASSWORD unset), where currentWorkspace() falls back to the default
// workspace because there is no request-scoped cookie jar.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// Point next/server at the shared test shim BEFORE the route loads.
register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

after(() => cleanupUnitDb());

type Route = typeof import("./route.ts");
let route: Route | null = null;
async function get(url: string): Promise<{ status: number; body: Record<string, unknown> }> {
  route ??= (await import("./route.ts")) as Route;
  const res = await route.GET(new Request(url));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

// The throwaway DB self-seeds a demo corpus, so the library is not empty to begin
// with — the total is READ rather than assumed, and stays well under the max cap.
let libraryTotal = 0;

before(async () => {
  const { saveJd, jdLibraryStats } = await import("../../_lib/db/jobs.ts");
  const { DEFAULT_WORKSPACE_ID } = await import("../../_lib/db/workspaces.ts");
  for (let i = 0; i < 6; i += 1) {
    saveJd({ title: `Route role ${i}`, body: `Route body ${i}` }, DEFAULT_WORKSPACE_ID);
  }
  libraryTotal = jdLibraryStats(DEFAULT_WORKSPACE_ID).total;
  assert.ok(libraryTotal >= 6 && libraryTotal < 200, `unexpected fixture size ${libraryTotal}`);
});

test("the list answers the honest page shape, not a bare array", async () => {
  const { status, body } = await get("http://localhost/api/jds");
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.jds), "the payload still carries `jds`");
  assert.equal(typeof body.truncated, "boolean", "…and says whether the slice was cut");
  assert.equal(typeof body.limit, "number", "…and the bound it was cut at");
  assert.equal(body.truncated, false);
});

test("the route READS ?limit= — the picker's bound is no longer ignored", async () => {
  const { body } = await get("http://localhost/api/jds?limit=2");
  assert.equal(body.limit, 2);
  assert.equal((body.jds as unknown[]).length, 2, "the page honours the requested bound");
  assert.equal(body.truncated, true, "…and admits there is more behind it");
});

test("a hostile limit is clamped, never bound verbatim", async () => {
  const { JDS_PAGE_DEFAULT_LIMIT, JDS_PAGE_MAX_LIMIT } = await import("../../_lib/db/jobs.ts");
  // SQLite reads LIMIT -1 as unbounded; "abc" and "" bind NaN.
  for (const raw of ["-1", "0", "abc", "", "2.5"]) {
    const { body } = await get(`http://localhost/api/jds?limit=${encodeURIComponent(raw)}`);
    assert.equal(body.limit, JDS_PAGE_DEFAULT_LIMIT, `limit=${raw} must fall back to the default`);
  }
  const { body } = await get("http://localhost/api/jds?limit=100000");
  assert.equal(body.limit, JDS_PAGE_MAX_LIMIT, "an over-large limit is capped");
  assert.equal((body.jds as unknown[]).length, libraryTotal, "…and the whole small library still fits");
});

test("every row still carries the decorations the library table renders", async () => {
  const { body } = await get("http://localhost/api/jds?limit=1");
  const row = (body.jds as Record<string, unknown>[])[0]!;
  for (const key of ["slug", "title", "preview", "jobStatus", "analysisCount", "roleFamily", "seniority", "company", "pipeline"]) {
    assert.ok(key in row, `the row lost \`${key}\``);
  }
});
