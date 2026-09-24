// The job interview-kit doors, driven through the REAL handlers (spark
// interview-kit-template, WP-A).
//
// What is worth driving rather than reading off the source: the append-only contract is a
// property of a SEQUENCE of requests, not of one. "A version is never rewritten", "the
// latest published one is the one new links mint from", "an older version stays readable
// after a newer one is published" — none of those is visible in a single handler, and all
// three are what makes a pinned candidate link honest.
//
// THE OPEN-MODE CAVEAT, stated so the coverage is not overclaimed: with no
// KP_OPERATOR_PASSWORD (unit-db.ts clears it) every caller resolves as an owner in the
// DEFAULT workspace, which is exactly the single-tenant deployment this product ships as.
// So the foreign-tenant cases below are driven by giving the JOB another team's
// workspace_id and calling as the default one — the same asymmetry every other route test
// here uses, because currentWorkspace() reads cookies this runner cannot set.
//
// The GENERATE door (POST) is driven only up to its refusals. Past them it enqueues a
// background task that spawns Python, and `npm run test:unit` is a Node-only job — so the
// keyless generator itself is covered where it lives, in pipeline/jobfit/tests/
// test_interview_kit.py, and the TS seam by interview-kit-run's own pure exports.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH before any store
// resolves db-path.ts).
import { cleanupUnitDb } from "../../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { InterviewKit } from "../../../../_lib/interview-kit-types.ts";

const kitRoute = await import("./route.ts");
const publishRoute = await import("./publish/route.ts");
const { ensureDb } = await import("../../../../_lib/db/core.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../../../../_lib/db/workspaces.ts");
const { interviewKitById } = await import("../../../../_lib/db/interview-kits.ts");

after(() => cleanupUnitDb());

const OTHER_WS = "team-beta";

/** A job row owned by `ws`. Written with SQL rather than through the ingest path so the
 *  fixture states exactly one thing: who owns this id. */
function seedJob(id: string, ws: string | null): string {
  ensureDb()
    .prepare(
      `INSERT INTO jobs (id, title, payload_json, status, workspace_id, created_at) VALUES (?, ?, ?, 'published', ?, ?)`
    )
    .run(id, "Backend Engineer", JSON.stringify({ id, title: "Backend Engineer", requirements: [] }), ws, new Date().toISOString());
  return id;
}

function kit(title: string, over: Partial<InterviewKit> = {}): InterviewKit {
  return {
    version: 1,
    competencies: [
      {
        id: "c1",
        title,
        weight: 3,
        budgetMin: 12,
        questions: [{ id: "c1q1", text: `Walk me through your work on ${title}.`, mustAsk: true }],
      },
    ],
    faq: [],
    ...over,
  };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const url = (id: string, suffix = "") => `http://localhost/api/jobs/${id}/interview-kit${suffix}`;

function jsonReq(target: string, method: string, body?: unknown): Request {
  return new Request(target, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function put(id: string, body: unknown): Promise<Response> {
  return kitRoute.PUT(jsonReq(url(id), "PUT", body) as never, params(id));
}
async function get(id: string): Promise<Response> {
  return kitRoute.GET(jsonReq(url(id), "GET") as never, params(id));
}
async function publish(id: string, kitId: unknown): Promise<Response> {
  return publishRoute.POST(jsonReq(url(id, "/publish"), "POST", { kitId }) as never, params(id));
}

test("PUT appends a NEW version every time — a save never rewrites the one before it", async () => {
  const id = seedJob("kit-route-versions", DEFAULT_WORKSPACE_ID);

  const first = await put(id, { kit: kit("Service ownership") });
  assert.equal(first.status, 200);
  const firstBody = (await first.json()) as { kit: { id: string; version: number; status: string; source: string } };
  assert.equal(firstBody.kit.version, 1);
  assert.equal(firstBody.kit.status, "draft", "a save lands as a draft — publishing is a separate, human act");
  assert.equal(firstBody.kit.source, "edited");

  const second = await put(id, { kit: kit("Incident response") });
  const secondBody = (await second.json()) as { kit: { id: string; version: number } };
  assert.equal(secondBody.kit.version, 2, "versions are monotonic per job");
  assert.notEqual(secondBody.kit.id, firstBody.kit.id, "a second save is a second ROW, not an update");

  // The load-bearing half: version 1 still asks what it asked. A candidate link minted
  // against it must not silently start asking the new questions.
  const v1 = interviewKitById(firstBody.kit.id, DEFAULT_WORKSPACE_ID);
  assert.equal(v1?.kit.competencies[0].title, "Service ownership");
});

test("publish makes ONE version the live one, and leaves every older version readable", async () => {
  const id = seedJob("kit-route-publish", DEFAULT_WORKSPACE_ID);
  const v1 = (await (await put(id, { kit: kit("First") })).json()) as { kit: { id: string } };
  const v2 = (await (await put(id, { kit: kit("Second") })).json()) as { kit: { id: string } };

  assert.equal((await publish(id, v1.kit.id)).status, 200);
  let read = (await (await get(id)).json()) as {
    published: { id: string; version: number } | null;
    draft: { id: string } | null;
    versions: { id: string; version: number; status: string }[];
  };
  assert.equal(read.published?.id, v1.kit.id, "the published version is the live one");
  assert.equal(read.draft?.id, v2.kit.id, "…and the newer draft is still the one the editor opens");

  // Publishing the NEWER version moves what new links mint from; the older published
  // version is not demoted, it simply stops being the highest.
  assert.equal((await publish(id, v2.kit.id)).status, 200);
  read = (await (await get(id)).json()) as typeof read;
  assert.equal(read.published?.id, v2.kit.id);
  assert.equal(read.published?.version, 2);
  assert.equal(read.draft, null, "with both versions published there is no draft left to open");
  assert.equal(read.versions.length, 2, "and both versions stay in the history");
  assert.ok(interviewKitById(v1.kit.id, DEFAULT_WORKSPACE_ID), "an older version stays readable — links pinned to it still resolve");

  // Publishing twice is not an error the operator caused twice: the second one answers
  // the same 404 as an unknown version, deliberately (api-response.ts states why).
  const again = await publish(id, v1.kit.id);
  assert.equal(again.status, 404);
  assert.equal(((await again.json()) as { code: string }).code, "INTERVIEW_KIT_NOT_FOUND");
});

test("a kit that cannot be stored is a CODED refusal, never a throw", async () => {
  const id = seedJob("kit-route-invalid", DEFAULT_WORKSPACE_ID);
  for (const [body, reason] of [
    [{ kit: null }, "not_an_object"],
    [{ kit: { competencies: [] } }, "no_competencies"],
    [{}, "not_an_object"],
    [{ kit: { competencies: [{ title: "A", weight: 9, budgetMin: 10, questions: [{ text: "Q?" }] }] } }, "weight_invalid"],
    [{ kit: { competencies: [{ title: "A", weight: 2, budgetMin: 0, questions: [{ text: "Q?" }] }] } }, "budget_invalid"],
    [{ kit: { competencies: [{ title: "A", weight: 2, budgetMin: 10, questions: [] }] } }, "competency_has_no_questions"],
  ] as const) {
    const res = await put(id, body);
    assert.equal(res.status, 400, `expected a refusal for ${JSON.stringify(body)}`);
    const payload = (await res.json()) as { code: string; reason: string; error: string };
    assert.equal(payload.code, "INTERVIEW_KIT_INVALID");
    assert.equal(payload.reason, reason, "the specific rule rides as DATA, not as a second English sentence");
  }
  // Nothing was written by any of them — a refused save must not leave a version behind
  // in a table that has no way to take one back.
  const read = (await (await get(id)).json()) as { versions: unknown[] };
  assert.deepEqual(read.versions, []);
});

test("a repaired kit is stored AND the repair is reported back", async () => {
  const id = seedJob("kit-route-adjusted", DEFAULT_WORKSPACE_ID);
  const res = await put(id, {
    kit: {
      competencies: [
        { title: "Ownership", weight: 3, budgetMin: 10, questions: [{ text: "A?" }, { text: "B?" }, { text: "C?" }, { text: "D?" }, { text: "E?" }, { text: "F?" }, { text: "G?" }] },
      ],
    },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { kit: { kit: InterviewKit }; adjusted: string[] };
  assert.equal(body.kit.kit.competencies[0].questions.length, 6, "the cap is repaired by trimming");
  assert.ok(body.adjusted.includes("questions_truncated"), "…and the editor is told, rather than silently losing a question");
  assert.ok(body.adjusted.includes("ids_minted"));
});

test("a job owned by another team 404s on EVERY verb — and nothing is written", async () => {
  const foreign = seedJob("kit-route-foreign", OTHER_WS);
  // A version that already exists over there, so the 404s below are refusing access to a
  // REAL kit rather than to an empty job.
  const { interviewKitAppendVersion } = await import("../../../../_lib/db/interview-kits.ts");
  const theirs = interviewKitAppendVersion({ jobId: foreign, kit: kit("Theirs"), source: "generated" }, OTHER_WS);

  for (const [label, run] of [
    ["GET", () => get(foreign)],
    ["POST", () => kitRoute.POST(jsonReq(url(foreign), "POST") as never, params(foreign))],
    ["PUT", () => put(foreign, { kit: kit("Mine") })],
    ["publish", () => publish(foreign, theirs.id)],
  ] as const) {
    const res = await run();
    assert.equal(res.status, 404, `${label} must 404 for another team's role`);
    assert.equal(((await res.json()) as { code: string }).code, "JOB_NOT_FOUND", `${label} must not confirm the id exists`);
  }
  // The foreign kit is untouched: still a draft, still version 1, still one row.
  const after = interviewKitById(theirs.id, OTHER_WS);
  assert.equal(after?.status, "draft", "a refused publish must not have flipped the other team's row");
  assert.equal(after?.kit.competencies[0].title, "Theirs");

  // An UNKNOWN job id answers identically to a foreign one — the door is not an oracle.
  const unknown = await get("kit-route-no-such-job");
  assert.equal(unknown.status, 404);
});

test("a version id from ANOTHER role of this team cannot be published under this URL", async () => {
  // The id is legitimately this team's, so the store read would happily return it. What
  // stops the wrong role's kit going live is the job re-assertion in the handler — and it
  // has to run BEFORE the flip, because this table cannot take a publish back.
  const roleA = seedJob("kit-route-role-a", DEFAULT_WORKSPACE_ID);
  const roleB = seedJob("kit-route-role-b", DEFAULT_WORKSPACE_ID);
  const a = (await (await put(roleA, { kit: kit("A") })).json()) as { kit: { id: string } };

  const res = await publish(roleB, a.kit.id);
  assert.equal(res.status, 404);
  assert.equal(((await res.json()) as { code: string }).code, "INTERVIEW_KIT_NOT_FOUND");
  assert.equal(
    interviewKitById(a.kit.id, DEFAULT_WORKSPACE_ID)?.status,
    "draft",
    "the refused publish must not have flipped the row on its way out"
  );

  for (const bad of ["", "   ", 42, null, "x".repeat(200)]) {
    assert.equal((await publish(roleA, bad)).status, 404, `a malformed kitId (${String(bad)}) is a refusal, not a 500`);
  }
});

test("the GENERATE door gates and throttles BEFORE it enqueues the model call", () => {
  // Driven as a source guard on purpose: past its refusals this POST enqueues a task that
  // spawns Python, which `npm run test:unit` (a Node-only CI job) must not do. The
  // property asserted — ORDER inside the handler — is exactly what the source states, and
  // it is the same shape jobs/lifecycle-signals.test.ts pins for the sibling spend doors.
  const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const start = src.indexOf("export async function POST(");
  const body = src.slice(start, src.indexOf("export async function PUT("));
  assert.ok(start > 0 && body.length > 0, "the generate door must still be a POST in this file");

  const capabilityAt = body.indexOf('requireCapabilityCoded("pipeline:write"');
  const ownershipAt = body.indexOf("canWriteJobLifecycle(id, ws)");
  const throttleAt = body.indexOf("rateLimit(");
  const spendAt = body.indexOf('startTask("interview_kit"');
  assert.ok(capabilityAt > 0, "the generate door must ask a capability");
  assert.ok(ownershipAt > capabilityAt, "…before it reveals whether the job exists");
  assert.ok(throttleAt > ownershipAt, "…and a refused call must not consume rate-limit budget");
  assert.ok(spendAt > throttleAt, "…and nothing may be enqueued before all three");
});
