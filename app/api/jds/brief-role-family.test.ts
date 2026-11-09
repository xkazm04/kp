// GET /api/jds/[slug]?brief=1 must carry the linked job's role family: the Dev tab
// reads `jobRoleFamily` off that payload, and no route sent it, so every non-software
// JD was built as "software_engineering". The buildNeed test used to pass only because
// it handed the value in directly; the last test here folds the FETCHED payload.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { saveJd } from "../../_lib/db/jobs.ts";
import { insertJob } from "../../_lib/job-ingest.ts";
import { jdJobId } from "../../_lib/jd-limits.ts";
import { DEFAULT_WORKSPACE_ID } from "../../_lib/db/workspaces.ts";
import { buildNeed } from "../../features/tools/devcases/buildNeed.ts";
import type { JobRecord } from "../../_lib/db/core.ts";

register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

after(() => cleanupUnitDb());

const OTHER_WS = "team-brief-family-b";

function seedJd(title: string): string {
  return saveJd({ title, body: "# body" }, DEFAULT_WORKSPACE_ID).slug;
}

function seedJob(slug: string, roleFamily: string | undefined, ws: string): void {
  insertJob({ id: jdJobId(slug), title: slug, roleFamily } as JobRecord, undefined, "draft", ws);
}

async function fetchBrief(slug: string): Promise<Record<string, unknown> & { slug: string; title: string; body: string }> {
  const { GET } = await import("./[slug]/route.ts");
  const res = await GET(new Request(`http://localhost/api/jds/${slug}?brief=1`), { params: Promise.resolve({ slug }) });
  assert.equal(res.status, 200);
  return (await res.json()) as never;
}

test("?brief=1 returns the linked job's role family", async () => {
  const slug = seedJd("Support Lead Brief Family");
  seedJob(slug, "customer_support", DEFAULT_WORKSPACE_ID);
  assert.equal((await fetchBrief(slug)).jobRoleFamily, "customer_support");
});

test("?brief=1 returns null for a JD with no job, or a job with no family", async () => {
  const bare = seedJd("Bare JD Brief Family");
  assert.equal((await fetchBrief(bare)).jobRoleFamily, null);
  const noFamily = seedJd("Familyless JD Brief Family");
  seedJob(noFamily, undefined, DEFAULT_WORKSPACE_ID);
  assert.equal((await fetchBrief(noFamily)).jobRoleFamily, null);
});

test("?brief=1 never reads another workspace's job", async () => {
  const slug = seedJd("Foreign Job Brief Family");
  seedJob(slug, "customer_support", OTHER_WS);
  assert.equal((await fetchBrief(slug)).jobRoleFamily, null);
});

test("the plain detail payload keeps its shape (no jobRoleFamily)", async () => {
  const slug = seedJd("Plain Detail Brief Family");
  seedJob(slug, "customer_support", DEFAULT_WORKSPACE_ID);
  const { GET } = await import("./[slug]/route.ts");
  const res = await GET(new Request(`http://localhost/api/jds/${slug}`), { params: Promise.resolve({ slug }) });
  assert.ok(!("jobRoleFamily" in ((await res.json()) as object)));
});

test("fetched payload -> buildNeed yields the non-software family", async () => {
  const slug = seedJd("Support Lead End To End");
  seedJob(slug, "customer_support", DEFAULT_WORKSPACE_ID);
  // Mirrors useDevTabData.pickJd's unpacking of the response.
  const p = (await fetchBrief(slug)) as { slug: string; title: string; body: string; intakeBrief?: never; jobRoleFamily?: string | null };
  const need = buildNeed({
    jd: { slug: p.slug, title: p.title, body: p.body, brief: p.intakeBrief ?? null },
    repoUrls: [""],
    seniority: "mid",
    jobRoleFamily: p.jobRoleFamily ?? null,
  });
  assert.equal(need.roleFamily, "customer_support");
});
