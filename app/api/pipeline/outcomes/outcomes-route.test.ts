// UAT KAT-L1-002 — guards for the on-the-job rating surface.
//
// The rating is the most sensitive field this store has ever carried: a judgement
// about a NAMED PERSON who now works here, living in the same database as sealed
// decision records. Three properties have to hold, and none of them is visible in
// a behavioural test of the store:
//
//   1. both handlers take the shared operator gate before doing any work (the
//      authz-parity contract the sibling /api/pipeline routes already keep);
//   2. the rating never reaches a candidate-facing or unauthenticated surface —
//      most sharply the Activity feed, which is served UNAUTHENTICATED and would
//      carry the rating in `detail` if the write ever emitted a pipeline event;
//   3. no publicly-reachable route can read the outcome store at all.
//
// (3) is DERIVED from the fail-closed allow-list rather than hand-listed (drain
// method-commitment M3: a guard that asserts "every X is covered" reads its X from
// the source the producer consumes, or it is a dated snapshot that passes while the
// gap is live). Adding a new public prefix therefore extends this guard for free.
//
// Source-guard style mirrors ../batch/authz-parity.test.ts: route modules import via
// the "@/…" alias and pull in next/server, so the properties are asserted against the
// route SOURCE, which is exactly where they are stated.
// unit-db FIRST (it points KP_DB_PATH at a throwaway file before any store opens):
// the roster read and the GET/POST round trip below run the real handlers on it.
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_API_EXACT, PUBLIC_API_PREFIXES } from "../../../_lib/auth/public-routes.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const API_DIR = resolve(HERE, "..", "..");
const ROUTE = readFileSync(resolve(HERE, "route.ts"), "utf8");

const GATE_IMPORT = /import\s*\{\s*requireOperator\s*\}\s*from\s*"@\/app\/_lib\/auth\/require-operator"/;
const GATE_CALL = /const\s+denied\s*=\s*await\s+requireOperator\(\)\s*;?\s*if\s*\(\s*denied\s*\)\s*return\s+denied\s*;?/;

test("both handlers are operator-gated, before any read or write", () => {
  assert.match(ROUTE, GATE_IMPORT, "must import the shared requireOperator gate");
  const getAt = ROUTE.indexOf("export async function GET");
  const postAt = ROUTE.indexOf("export async function POST");
  assert.ok(getAt >= 0 && postAt >= 0, "the route must export both GET and POST");

  const getBody = ROUTE.slice(getAt, postAt);
  const postBody = ROUTE.slice(postAt);
  assert.match(getBody, GATE_CALL, "the GET (one hire's rating / the workspace's hire counts) must be gated");
  assert.match(postBody, GATE_CALL, "the POST (records a judgement about a named person) must be gated");

  // The gate precedes the body read and every store call, so a refused caller never
  // reaches the write path.
  const gateAt = postBody.search(GATE_CALL);
  const bodyAt = postBody.indexOf("request.json()");
  const writeAt = postBody.indexOf("recordHirePerformance(");
  assert.ok(gateAt >= 0 && bodyAt > gateAt, "POST must gate before reading the request body");
  assert.ok(writeAt > gateAt, "POST must gate before writing the rating");
});

test("every store call is scoped to the caller's workspace", () => {
  assert.match(ROUTE, /const\s+ws\s*=\s*await\s+currentWorkspace\(\)/, "must resolve the caller's workspace");
  // The tenant-defaulting store functions this route calls; each must be handed `ws`
  // (they all default to DEFAULT_WORKSPACE_ID, so an omitted argument silently reads
  // or writes another team's hires — the exact class route-tenancy-coverage ratchets).
  for (const call of [
    /getPipelineEntry\([^)]*,\s*ws\)/,
    /latestOutcomeByRefs\(\[ref\],\s*ws\)/,
    // challenge-r07 pipeline-api/B: the counter reads the hire roster and joins its
    // refs, instead of countRatedHires(ws) over every rated row and listPipeline(ws)
    // over the whole board. Both new calls are handed ws.
    /listWorkspaceHires\(ws,/,
    /latestOutcomeByRefs\(roster\.map\(\(h\)\s*=>\s*h\.ref\),\s*ws\)/,
    /recordHirePerformance\(entry,\s*parsed\.data\.performance,\s*ws\)/,
  ]) {
    assert.match(ROUTE, call, `tenant-scoped call missing: ${call}`);
  }
  // …and the old defect stays out: a numerator counted over every rated row in the
  // store (dev-case lane and ex-hires included) against a denominator counted over
  // the hydrated board. Matched as calls, so the comment naming them does not trip it.
  assert.doesNotMatch(ROUTE, /countRatedHires\s*\(/, "rated must be folded over the hire roster, not counted store-wide");
  assert.doesNotMatch(ROUTE, /listPipeline\s*\(/, "hires must be read as a roster, not by hydrating the capped board");
});

test("the write refuses a candidate who was never hired, against the LIVE stage", () => {
  // The cross-field rule of the store (performance rides a "hired" outcome only) is
  // re-derived server-side from the entry's current stage rather than trusted from a
  // client that may be holding a stale drawer.
  const postBody = ROUTE.slice(ROUTE.indexOf("export async function POST"));
  assert.match(postBody, /stageHasRole\(entry\.stage,\s*"terminal"/, "must check the terminal role server-side");
  // UPDATED DELIBERATELY (not relaxed): this read `/status:\s*409/` when the route
  // answered with an inline NextResponse.json({ error }). It now returns a CODED
  // refusal, because the i18n gate forbids leaking the server's canonical English
  // into a localized drawer and "why was this refused" is the useful half. The
  // assertion follows the refusal to its new shape, still pinning both halves:
  // the 409, and that the reason is a resolvable code rather than a bare string.
  assert.match(
    postBody,
    /jsonRefusal\(\s*"HIRE_RATING_NOT_HIRED"\s*,\s*409\s*\)/,
    "a non-hire must be refused with a coded 409, not silently recorded"
  );
});

test("the rating never enters the unauthenticated Activity feed", () => {
  // /api/pipeline/events is served without a session; its public projection copies
  // `detail` verbatim (pipeline-events-public.ts). A rating written as a pipeline
  // event would therefore be readable by anyone, so this route emits none.
  // Matched as CODE (a call or an import), not as text: the route's own comment
  // names these modules to explain why it stays away from them, and a guard that a
  // comment can trip is a guard people delete.
  for (const forbidden of [/recordPipelineEvent\s*\(/, /toPublicPipelineEvent\s*\(/, /from\s+"[^"]*pipeline-events/]) {
    assert.ok(!forbidden.test(ROUTE), `the rating write must not reach the public event feed (${forbidden})`);
  }
});

/** Every directory under app/api that the fail-closed gate lets an anonymous caller
 *  reach, derived from the allow-list itself. */
function publicApiDirs(): string[] {
  const paths = [...PUBLIC_API_PREFIXES, ...PUBLIC_API_EXACT]
    .map((p) => p.replace(/^\/api\//, "").replace(/\/$/, ""))
    .filter(Boolean);
  return [...new Set(paths)].map((rel) => resolve(API_DIR, rel)).filter((abs) => existsSync(abs));
}

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!statSync(dir).isDirectory()) return [dir];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

test("no publicly-reachable route can read the on-the-job rating store", () => {
  const dirs = publicApiDirs();
  // A guard that scanned nothing would pass forever; pin that the allow-list actually
  // resolved to real route trees.
  assert.ok(dirs.length >= 5, `expected the public allow-list to resolve to route trees, got ${dirs.length}`);
  const offenders: string[] = [];
  for (const dir of dirs) {
    for (const file of walkFiles(dir)) {
      if (/from\s+"[^"]*dev-outcomes"/.test(readFileSync(file, "utf8"))) offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [], "an unauthenticated route imports the outcome store");
});

// ---- challenge-r07 pipeline-api/B: the hire roster and the in-place rating ----------
//
// Behavioural, on the throwaway unit DB: the roster read the counter now stands on, and
// the round trip the Quality queue makes (GET the unrated hires, POST one rating through
// the one gated write door, GET again).

after(() => cleanupUnitDb());

const { GET, POST } = await import("./route.ts");
const { listWorkspaceHires } = await import("./hire-roster.ts");
const { createPipelineEntry } = await import("../../../_lib/db/pipeline.ts");
const { ensureDb } = await import("../../../_lib/db/core.ts");
const { recordOutcome } = await import("../../../_lib/dev-outcomes.ts");
const { setDecisionConfig } = await import("../../../_lib/decision-config-store.ts");
const { PIPELINE_BOARD_CAP } = await import("../../../_lib/db/pipeline.ts");
const { NextRequest } = await import("next/server");

let seq = 0;
function hireFixture(workspaceId: string | undefined, stage: string, hiredAt?: string) {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `hr-c${seq}`,
    candidateLabel: `Hire ${seq}`,
    jobId: `hr-job-${seq}`,
    jobTitle: "Roster Role",
    stage,
    ...(workspaceId ? { workspaceId } : {}),
  });
  if (hiredAt) ensureDb().prepare(`UPDATE pipeline_entries SET stage_changed_at = ? WHERE id = ?`).run(hiredAt, entry.id);
  return entry;
}
const setStatus = (id: string, status: string) =>
  ensureDb().prepare(`UPDATE pipeline_entries SET status = ? WHERE id = ?`).run(status, id);

test("listWorkspaceHires: the workspace's own terminal column, its own tenant, active rows only, uncapped", () => {
  const WS = "ws-joined";
  setDecisionConfig(
    "pipelineStages",
    {
      stages: [
        { id: "Accepted", label: "Accepted", role: "entry" },
        { id: "Screened", label: "Screened", role: "screening" },
        { id: "Interview", label: "Interview", role: "interview" },
        { id: "Offer", label: "Offer", role: "offer" },
        { id: "Joined", label: "Joined", role: "terminal" },
      ],
      retired: [],
    },
    WS,
    "team"
  );
  const joined = hireFixture(WS, "Joined");
  // A row literally on "Hired" in a workspace whose terminal column is Joined is not a hire.
  hireFixture(WS, "Hired");
  const declined = hireFixture(WS, "Joined");
  setStatus(declined.id, "declined");
  const rejected = hireFixture(WS, "Joined");
  setStatus(rejected.id, "rejected");
  // Another tenant's hire on the shipped column.
  const elsewhere = hireFixture(undefined, "Hired");

  const roster = listWorkspaceHires(WS, ["Joined"]);
  assert.deepEqual(roster.map((h) => h.entryId), [joined.id]);
  assert.ok(!listWorkspaceHires(WS, ["Hired"]).some((h) => h.entryId === elsewhere.id), "another workspace's hire never appears");
  // The roster row carries what the ref join needs, plus the label, role and hire stamp.
  assert.equal(roster[0].ref, `pe:${joined.id}`, "an ordinary board hire is keyed by the namespaced entry ref (hireOutcomeRef)");
  assert.equal(roster[0].candidateLabel, joined.candidateLabel);
  assert.equal(roster[0].jobTitle, "Roster Role");

  // Not truncated by the board cap: the counter used to hydrate the board to count it.
  const BULK = "ws-bulk";
  const insert = ensureDb().prepare(
    `INSERT INTO pipeline_entries (id, candidate_label, job_title, stage, status, workspace_id, stage_changed_at) VALUES (?, ?, 'Bulk', 'Hired', 'active', ?, '2026-01-01T00:00:00.000Z')`
  );
  ensureDb().transaction(() => {
    for (let i = 0; i <= PIPELINE_BOARD_CAP; i += 1) insert.run(`bulk-${i}`, `Bulk ${i}`, BULK);
  })();
  assert.equal(listWorkspaceHires(BULK, ["Hired"]).length, PIPELINE_BOARD_CAP + 1);
  assert.deepEqual(listWorkspaceHires(BULK, []), [], "an axis with no terminal column has no hires");
});

type CounterBody = {
  rated: number;
  hires: number;
  minOutcomes: number;
  unrated: Array<{ entryId: string; candidateLabel: string; jobTitle: string | null; hiredAt: string | null }>;
  unratedTotal: number;
};
const getCounter = async (): Promise<CounterBody> => {
  const res = await GET(new NextRequest("http://localhost/api/pipeline/outcomes"));
  assert.equal(res.status, 200);
  return (await res.json()) as CounterBody;
};
const rate = (entryId: string, performance: number) =>
  POST(
    new NextRequest("http://localhost/api/pipeline/outcomes", {
      method: "POST",
      body: JSON.stringify({ entryId, performance }),
      headers: { "content-type": "application/json" },
    })
  );

test("GET with no ?entry answers the counter AND the queue; ?entry keeps its single-hire shape", async () => {
  const body = await getCounter();
  assert.deepEqual(Object.keys(body).sort(), ["hires", "minOutcomes", "rated", "unrated", "unratedTotal"]);
  assert.ok(body.rated <= body.hires);
  assert.equal(body.rated + body.unratedTotal, body.hires);

  const one = hireFixture(undefined, "Hired");
  const res = await GET(new NextRequest(`http://localhost/api/pipeline/outcomes?entry=${encodeURIComponent(one.id)}`));
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(await res.json()).sort(), ["entryId", "hired", "max", "min", "performance", "recordedAt"]);
});

test("rate from the queue: the rated hire leaves it and the counter moves by one; a re-rating does not move it", async () => {
  // Stamped long ago so both lead the oldest-first queue whatever else this DB holds.
  const a = hireFixture(undefined, "Hired", "2000-01-01T00:00:00.000Z");
  const b = hireFixture(undefined, "Hired", "2000-01-02T00:00:00.000Z");
  assert.equal((await rate(a.id, 4)).status, 200);
  // A dev-case-lane rating on a ref no current hire carries: must not move `rated`.
  recordOutcome({ ref: "devcase-lane-only", outcome: "hired", performance: 5 });

  const before = await getCounter();
  assert.ok(before.unrated.some((r) => r.entryId === b.id), "B is queued");
  assert.ok(!before.unrated.some((r) => r.entryId === a.id), "A is rated, so not queued");

  assert.equal((await rate(b.id, 3)).status, 200);
  const after1 = await getCounter();
  assert.ok(!after1.unrated.some((r) => r.entryId === b.id), "B has left the queue");
  assert.equal(after1.rated, before.rated + 1);
  assert.equal(after1.hires, before.hires);

  assert.equal((await rate(a.id, 2)).status, 200);
  assert.equal((await getCounter()).rated, after1.rated, "re-rating a hire corrects it; it is not a second rating");
});

test("the queue's client-side scale is the store's scale", async () => {
  const { PERFORMANCE_MIN, PERFORMANCE_MAX } = await import("../../../_lib/dev-outcomes.ts");
  const { HIRE_RATING_LEVELS } = await import("../../../_lib/hire-rating-queue.ts");
  assert.deepEqual(
    [...HIRE_RATING_LEVELS],
    Array.from({ length: PERFORMANCE_MAX - PERFORMANCE_MIN + 1 }, (_, i) => PERFORMANCE_MIN + i)
  );
});
