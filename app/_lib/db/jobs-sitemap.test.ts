import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { jdJobId } from "../jd-limits.ts";
import { insertJob, setJobStatus } from "../job-ingest.ts";
import { listLivePublicJds, saveJd, setJdArchived } from "./jobs.ts";
import type { JobRecord } from "./core.ts";

after(() => cleanupUnitDb());

test("sitemap lists only live linked JDs across workspaces", () => {
  const draft = saveJd({ title: "Draft", body: "Draft body" }, "ws-a").slug;
  const liveA = saveJd({ title: "Live A", body: "Live body A" }, "ws-a").slug;
  const liveB = saveJd({ title: "Live B", body: "Live body B" }, "ws-b").slug;
  const closed = saveJd({ title: "Closed", body: "Closed body" }, "ws-a").slug;
  const archived = saveJd({ title: "Archived", body: "Archived body" }, "ws-b").slug;
  for (const [slug, ws, status] of [
    [liveA, "ws-a", "published"],
    [liveB, "ws-b", "published"],
    [closed, "ws-a", "closed"],
    [archived, "ws-b", "published"],
  ] as const) {
    insertJob({ id: jdJobId(slug), title: slug } as JobRecord, undefined, status, ws);
  }
  assert.equal(setJdArchived(archived, true, "ws-b"), true);
  assert.deepEqual(new Set(listLivePublicJds().map(({ slug }) => slug)), new Set([liveA, liveB]));
  assert.ok(!listLivePublicJds().some(({ slug }) => slug === draft));

  setJobStatus(jdJobId(liveA), "closed");
  assert.deepEqual(listLivePublicJds().map(({ slug }) => slug), [liveB]);
});
