// The sources doors on an isolated DB, in open auth mode (unit-db.ts scrubs the
// password): tier C is refused at create, tier B cannot be enabled without the
// acknowledgement of the current terms hash, rules are validated and persisted with
// their baseline, and the preview runs the engine against a scripted page without
// writing anything.
//
// unit-db.ts must be the first project import (it sets KP_DB_PATH before any store opens).
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { getJobseekerSource } from "../../../_lib/db/jobseeker-sources.ts";
import { _resetPolitenessForTests, _setPoliteFetchDepsForTests } from "../../../_lib/jobseeker/fetch/politeFetch.ts";
import { catalogEntry } from "../../../_lib/jobseeker/sources-catalog.ts";
import type { JobseekerSource } from "../../../_lib/jobseeker/types.ts";
import { GET, POST } from "./route.ts";
import { PATCH } from "./[id]/route.ts";
import { POST as PREVIEW } from "./[id]/preview/route.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "_lib", "jobseeker", "__fixtures__");
const listing = readFileSync(path.join(FIXTURES, "jobscz-listing.html"), "utf8");
const rules = JSON.parse(readFileSync(path.join(FIXTURES, "jobscz-rules.json"), "utf8")) as unknown;

after(() => cleanupUnitDb());
afterEach(() => {
  _resetPolitenessForTests();
  delete process.env.KP_OFFLINE;
});

const json = (method: string, body?: unknown) =>
  new Request("http://localhost/api/jobseeker/sources", { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function create(body: unknown): Promise<JobseekerSource> {
  const res = await POST(json("POST", body));
  const text = await res.text();
  assert.equal(res.status, 201, text);
  return (JSON.parse(text) as { source: JobseekerSource }).source;
}

test("GET returns the catalog with tiers + termsHash and this workspace's sources", async () => {
  const res = await GET();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { catalog: { id: string; tier: string; termsHash: string; refusedReason: string | null }[]; sources: unknown[] };
  const ids = body.catalog.map((c) => c.id);
  for (const id of ["eures", "mpsv", "greenhouse", "startupjobs", "prace", "profesia", "cocuma", "jobs", "linkedin", "indeed", "stepstone"]) assert.ok(ids.includes(id), id);
  assert.ok(body.catalog.every((c) => /^[0-9a-f]{64}$/.test(c.termsHash)));
  assert.ok(body.catalog.filter((c) => c.tier === "C").every((c) => c.refusedReason), "every tier-C entry says why");
  assert.ok(Array.isArray(body.sources));
});

test("POST: tier C from the catalog → 403 JOBSEEKER_SOURCE_REFUSED; a tier-C host by adapter → 403; a bad adapter → 400", async () => {
  const c = await POST(json("POST", { catalogId: "linkedin" }));
  assert.equal(c.status, 403);
  assert.equal(((await c.json()) as { code: string }).code, "JOBSEEKER_SOURCE_REFUSED");
  const byHost = await POST(json("POST", { adapter: "board_rules", host: "www.indeed.com", config: {} }));
  assert.equal(byHost.status, 403);
  const bad = await POST(json("POST", { adapter: "ats_xyz", config: {} }));
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as { code: string }).code, "JOBSEEKER_RULES_INVALID");
  const noToken = await POST(json("POST", { catalogId: "greenhouse" }));
  assert.equal(noToken.status, 400, "an ATS entry needs its company config");
});

test("POST creates a disabled source from the catalog (tier A) and from an ATS slug; PATCH enabled:true on tier A needs no acknowledgement", async () => {
  const eures = await create({ catalogId: "eures" });
  assert.equal(eures.tier, "A");
  assert.equal(eures.enabled, false, "a new source starts disabled whatever its tier");
  assert.equal(eures.host, "europa.eu");
  const gh = await create({ adapter: "ats_greenhouse", config: { token: "acme" } });
  assert.equal(gh.host, "boards-api.greenhouse.io");
  assert.equal(gh.kind, "ats");
  assert.equal(gh.tier, "A", "the ATS host is catalogued as A");
  const res = await PATCH(json("PATCH", { enabled: true }), params(eures.id));
  assert.equal(res.status, 200);
  assert.equal(getJobseekerSource(eures.id)!.enabled, true);
  assert.equal(getJobseekerSource(eures.id)!.acknowledgedTermsHash, null, "tier A records no acknowledgement");
});

test("PATCH: tier B enabled:true without acknowledge → 409; with acknowledge → enabled + the current termsHash recorded; a stale hash re-asks", async () => {
  const src = await create({ catalogId: "jobs" });
  assert.equal(src.tier, "B");
  const refused = await PATCH(json("PATCH", { enabled: true }), params(src.id));
  assert.equal(refused.status, 409);
  const refusedBody = (await refused.json()) as { code: string; termsHash: string };
  assert.equal(refusedBody.code, "JOBSEEKER_SOURCE_NOT_ACKNOWLEDGED");
  assert.equal(refusedBody.termsHash, catalogEntry("jobs")!.termsHash, "the refusal names the hash the owner must acknowledge");
  assert.equal(getJobseekerSource(src.id)!.enabled, false);

  const ok = await PATCH(json("PATCH", { enabled: true, acknowledge: true }), params(src.id));
  assert.equal(ok.status, 200);
  const after = getJobseekerSource(src.id)!;
  assert.equal(after.enabled, true);
  assert.equal(after.acknowledgedTermsHash, catalogEntry("jobs")!.termsHash);
  assert.ok(after.acknowledgedAt);

  // Disabled and re-enabled with the SAME terms: the recorded acknowledgement carries.
  await PATCH(json("PATCH", { enabled: false }), params(src.id));
  const again = await PATCH(json("PATCH", { enabled: true }), params(src.id));
  assert.equal(again.status, 200);
  // Pause/resume are the owner's; a pause reason outside the vocabulary is ignored.
  await PATCH(json("PATCH", { pause: "owner" }), params(src.id));
  assert.equal(getJobseekerSource(src.id)!.pausedReason, "owner");
  await PATCH(json("PATCH", { pause: "whatever" }), params(src.id));
  assert.equal(getJobseekerSource(src.id)!.pausedReason, "owner");
  await PATCH(json("PATCH", { resume: true }), params(src.id));
  assert.equal(getJobseekerSource(src.id)!.pausedReason, null);
  // Unknown id → 404 with the (proposed) code.
  const missing = await PATCH(json("PATCH", { enabled: false }), params("jss-nope"));
  assert.equal(missing.status, 404);
});

test("PATCH rules: invalid → 400 JOBSEEKER_RULES_INVALID; valid needs the baseline; then both persist", async () => {
  const src = await create({ catalogId: "jobs" });
  const invalid = await PATCH(json("PATCH", { rules: [{ field: "title" }], rulesBaseline: {} }), params(src.id));
  assert.equal(invalid.status, 400);
  assert.equal(((await invalid.json()) as { code: string }).code, "JOBSEEKER_RULES_INVALID");
  const noBaseline = await PATCH(json("PATCH", { rules }), params(src.id));
  assert.equal(noBaseline.status, 400);
  const ok = await PATCH(json("PATCH", { rules, rulesBaseline: { url: 3, title: 3 } }), params(src.id));
  assert.equal(ok.status, 200);
  const after = getJobseekerSource(src.id)!;
  assert.equal(after.rules!.length, 6);
  assert.deepEqual(after.rulesBaseline, { url: 3, title: 3 });
});

test("preview: runs the rules against the scripted live page, writes nothing; offline → 503; blocked → 423", async () => {
  const src = await create({ catalogId: "jobs" });
  const calls: string[] = [];
  _setPoliteFetchDepsForTests({
    now: () => 1_000_000,
    sleep: async () => undefined,
    fetch: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      if (url.includes("blocked")) return new Response("no", { status: 403 });
      return new Response(listing, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    },
  });
  const res = await PREVIEW(json("POST", { rules }), params(src.id));
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as { outcome: string; perRule: { field: string; matched: number; verdict: string }[]; items: Record<string, unknown>[]; itemCount: number; baseline: Record<string, number> };
  assert.equal(body.outcome, "ok");
  assert.equal(body.itemCount, 3);
  assert.equal(body.items.length, 3);
  assert.equal(body.items[0].title, "Senior Java Developer");
  assert.equal(body.baseline.url, 3);
  assert.ok(body.perRule.every((r) => r.verdict === "hit"));
  assert.equal(getJobseekerSource(src.id)!.rules, null, "the preview persisted nothing");
  assert.ok(calls.some((c) => c.startsWith("https://www.jobs.cz/")), "the fetch went to the source's listing page through politeFetch");

  const blocked = await PREVIEW(json("POST", { rules, url: "https://www.jobs.cz/blocked" }), params(src.id));
  assert.equal(blocked.status, 423);
  assert.equal(((await blocked.json()) as { code: string }).code, "JOBSEEKER_SOURCE_BLOCKED");

  const before = calls.length;
  process.env.KP_OFFLINE = "1";
  const offline = await PREVIEW(json("POST", { rules }), params(src.id));
  assert.equal(offline.status, 503);
  assert.equal(((await offline.json()) as { code: string }).code, "JOBSEEKER_OFFLINE");
  assert.equal(calls.length, before, "offline is decided before any fetch");
});
