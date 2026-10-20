// POST /api/ats/import — the operator door onto ingestAtsApplications
// (challenge-r05 ats-sync-egress/B).
//
// The door writes pipeline rows from an untrusted vendor payload, so its controls are
// pinned here: the operator gate (401 without an operator session when a password is
// set), the capability gate, the byte cap (413 PAYLOAD_TOO_LARGE), the record cap,
// coded refusals for a bad provider / job / connection, and the {results, counts} answer.
//
// unit-db.ts must stay the first project import; next/server resolves to the shared shim
// BEFORE the route loads — hence the dynamic imports.
import { test, before, beforeEach, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

type Route = { POST: (req: Request) => Promise<Response> };
let route: Route;
let store: typeof import("../../../_lib/ats/connections-store.ts");
let links: typeof import("../../../_lib/ats/links-store.ts");
let pipeline: typeof import("../../../_lib/db/pipeline.ts");
let JOB: string;
let FOREIGN_JOB: string;

before(async () => {
  route = (await import("./route.ts")) as unknown as Route;
  store = await import("../../../_lib/ats/connections-store.ts");
  links = await import("../../../_lib/ats/links-store.ts");
  pipeline = await import("../../../_lib/db/pipeline.ts");
  const { insertJob } = await import("../../../_lib/job-ingest.ts");
  const { createWorkspace, DEFAULT_WORKSPACE_ID } = await import("../../../_lib/db/workspaces.ts");
  JOB = insertJob({ id: "ats-import-route-job", title: "Route role" } as never, undefined, "published", DEFAULT_WORKSPACE_ID).id;
  const other = createWorkspace("ATS import route other team").id;
  FOREIGN_JOB = insertJob({ id: "ats-import-route-foreign", title: "Other team role" } as never, undefined, "published", other).id;
});

beforeEach(() => {
  delete process.env.KP_OPERATOR_PASSWORD;
  for (const p of store.ATS_PROVIDERS) {
    store.deleteAtsConnection(p);
    links.deleteAtsLinksForProviderEverywhere(p);
  }
  store.setAtsConnection({ provider: "recruitee", enabled: true });
});
afterEach(() => {
  delete process.env.KP_OPERATOR_PASSWORD;
});
after(() => cleanupUnitDb());

const post = (body: unknown): Promise<Response> =>
  route.POST(
    new Request("http://localhost/api/ats/import", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
  );

const record = (id: number) => ({
  id,
  candidate: { name: `Route Applicant ${id}`, emails: [`route-${id}@example.invalid`] },
  stage: { name: "1st round" },
});

async function refusal(res: Response): Promise<{ status: number; code: string | undefined }> {
  const body = (await res.json()) as { code?: string };
  return { status: res.status, code: body.code };
}

test("operator-gated: a password set and no operator session answers 401 and writes nothing", async () => {
  process.env.KP_OPERATOR_PASSWORD = "unit-test-password";
  const res = await post({ provider: "recruitee", jobId: JOB, records: [record(1)] });
  assert.equal(res.status, 401);
  assert.equal(links.findAtsLink("recruitee", "1"), null);
});

test("the answer is {results, counts} and the entry is on the board", async () => {
  const res = await post({ provider: "recruitee", jobId: JOB, records: [record(2), { nope: true }] });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    results: { externalId: string | null; outcome: string; entryId?: string }[];
    counts: Record<string, number>;
  };
  assert.deepEqual(
    body.results.map((r) => r.outcome),
    ["created", "invalid"]
  );
  assert.equal(body.counts.created, 1);
  assert.equal(body.counts.invalid, 1);
  assert.equal(pipeline.getPipelineEntry(body.results[0].entryId!)?.stage, "Interview");
});

test("a body over the byte cap is 413 PAYLOAD_TOO_LARGE", async () => {
  const huge = { provider: "recruitee", jobId: JOB, records: [{ id: 3, pad: "x".repeat(3 * 1024 * 1024) }] };
  assert.deepEqual(await refusal(await post(huge)), { status: 413, code: "PAYLOAD_TOO_LARGE" });
  assert.equal(links.findAtsLink("recruitee", "3"), null);
});

test("records must be a non-empty array under the record cap", async () => {
  for (const records of [undefined, "907", [], Array.from({ length: 101 }, (_, i) => record(1000 + i))]) {
    assert.deepEqual(
      await refusal(await post({ provider: "recruitee", jobId: JOB, records })),
      { status: 400, code: "ATS_IMPORT_RECORDS_INVALID" },
      `records=${Array.isArray(records) ? `array(${records.length})` : String(records)}`
    );
  }
  assert.equal(links.findAtsLink("recruitee", "1000"), null);
});

test("coded refusals: unknown provider, missing connection, job outside the team", async () => {
  assert.deepEqual(await refusal(await post({ provider: "greenhoose", jobId: JOB, records: [record(4)] })), {
    status: 400,
    code: "ATS_CONNECTION_PROVIDER_UNKNOWN",
  });
  assert.deepEqual(await refusal(await post({ provider: "teamio", jobId: JOB, records: [record(5)] })), {
    status: 404,
    code: "ATS_CONNECTION_NOT_FOUND",
  });
  assert.deepEqual(await refusal(await post({ provider: "recruitee", jobId: FOREIGN_JOB, records: [record(6)] })), {
    status: 404,
    code: "ATS_IMPORT_JOB_NOT_FOUND",
  });
  assert.deepEqual(await refusal(await post({ provider: "recruitee", records: [record(7)] })), {
    status: 404,
    code: "ATS_IMPORT_JOB_NOT_FOUND",
  });
  for (const id of ["4", "5", "6", "7"]) assert.equal(links.findAtsLink("recruitee", id), null);
});
