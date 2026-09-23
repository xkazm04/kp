// GET /api/jobs as the Roles desk's window (challenge-r07 jobs-table-core/A): the
// route owns sort, the derived status filter and the offset, validates each against
// an allowlist at the trust boundary, and echoes what it actually applied — so the
// client pages through the whole matching set instead of a 300-row entry-ranked cut.
//
// unit-db.ts must stay the FIRST project import (isolated throwaway DB, open mode).
// Outside a request scope currentWorkspace() folds to the default workspace, which
// is where the fixture lives.
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { ensureDb, type JobRecord } from "../../_lib/db/core.ts";
import { insertJob } from "../../_lib/job-ingest.ts";
import { DEFAULT_WORKSPACE_ID } from "../../_lib/db/workspaces.ts";
import { GET } from "./route.ts";

after(() => cleanupUnitDb());

const FAM = "fx-route";
before(() => {
  const tx = ensureDb().transaction(() => {
    for (let i = 0; i < 65; i++) {
      const n = String(i).padStart(2, "0");
      insertJob({ id: `fx-rt-${n}`, title: `Route Role ${n}`, roleFamily: FAM } as unknown as JobRecord, undefined, "published", DEFAULT_WORKSPACE_ID);
    }
    insertJob({ id: "fx-rt-draft", title: "Route Draft", roleFamily: FAM } as unknown as JobRecord, undefined, "draft", DEFAULT_WORKSPACE_ID);
  });
  tx();
});

type Body = {
  jobs: Array<{ id: string; title: string; hired?: number }>;
  matching: number;
  truncated: boolean;
  limit: number;
  window?: { sort: string | null; dir: string | null; offset: number; roleStatus: string | null };
};

async function get(qs: string): Promise<Body> {
  const r = await GET(new NextRequest(`http://localhost/api/jobs?roleFamily=${FAM}&${qs}`));
  assert.equal(r.status, 200);
  return (await r.json()) as Body;
}

test("case 6: a windowed read answers 20 rows, the honesty triple and an echo of what it applied", async () => {
  const body = await get("sort=title&dir=asc&offset=40&roleStatus=open");
  assert.equal(body.jobs.length, 20);
  assert.equal(body.jobs[0]!.id, "fx-rt-40", "offset 40 of the title-sorted open roles");
  assert.equal(body.matching, 65, "the draft is not open, so it is not matching");
  assert.equal(body.limit, 20);
  assert.equal(body.truncated, true);
  assert.deepEqual(body.window, { sort: "title", dir: "asc", offset: 40, roleStatus: "open" });
  assert.ok(body.jobs.every((j) => typeof j.hired === "number"), "every row still carries the pipeline's hired count");
});

test("case 6: unknown sort / dir / roleStatus fall back to the default instead of reaching SQL", async () => {
  const body = await get("sort=payload_json&dir=sideways&roleStatus=hired&offset=0");
  assert.deepEqual(body.window, { sort: null, dir: null, offset: 0, roleStatus: null });
  assert.equal(body.matching, 66, "an unknown status is no filter at all");
});

test("case 6: a malformed offset reads as 0; an offset past matching is an empty page with matching unchanged", async () => {
  for (const bad of ["-1", "abc", "2.5"]) {
    const body = await get(`sort=title&offset=${bad}`);
    assert.equal(body.window?.offset, 0, `offset=${bad}`);
    assert.equal(body.jobs[0]!.id, "fx-rt-draft", "offset 0: 'Route Draft' leads the title order");
  }
  const past = await get("sort=title&offset=500");
  assert.deepEqual(past.jobs, []);
  assert.equal(past.matching, 66);
  assert.equal(past.truncated, false);
});
