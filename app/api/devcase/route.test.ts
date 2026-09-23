import { test, before } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtempSync } from "node:fs";

// bug-ui-scan-2026-07-09 (dev-case-authoring-publishing #2): the manual approve path
// (POST /api/devcase) bypassed the probe-strength gate the lifecycle approve route
// enforces — no 422 on a "none" verdict, no override contract, and no audit row. These
// tests pin the manual path to the SAME shared guard.
//
// Isolate onto a throwaway DB BEFORE the route (and its db layer) loads. DB_PATH is
// resolved at module-load from KP_DB_PATH, and static imports evaluate before any
// top-level statement, so the route + dev-control are pulled in via dynamic import in
// `before()` — after this assignment — so `npm run test:unit` never touches the real DB.
process.env.KP_DB_PATH = path.join(mkdtempSync(path.join(os.tmpdir(), "kp-devcase-")), "kp.sqlite");
delete process.env.DATABASE_URL;

let POST: (typeof import("./route.ts"))["POST"];
let GET: (typeof import("./route.ts"))["GET"];
let listAudit: (typeof import("@/app/_lib/dev-control"))["listAudit"];

before(async () => {
  ({ POST, GET } = await import("./route.ts"));
  ({ listAudit } = await import("@/app/_lib/dev-control"));
});

function post(body: unknown): Request {
  return new Request("http://localhost/api/devcase", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const role = { title: "Backend Engineer", seniority: "senior" };

// A case with load-bearing probes: each forces a real choice, plants it at a concrete
// seam, and defines the good-vs-naive tell — so auditProbeStrength → "strong".
const strongProbes = [
  { id: "p1", kind: "trap", where: "src/index.ts", reveals: "handles the retry edge case", decisionSpace: ["retry with backoff", "fail fast"] },
  { id: "p2", kind: "trap", where: "src/db.ts", reveals: "avoids the N+1 query", decisionSpace: ["batch load", "loop per row"] },
];

test("manual approve of a case with no load-bearing probes (verdict 'none') is blocked 422", async () => {
  const res = await POST(post({ role, case: { title: "Payments take-home", coverProbes: [] } }) as never);
  assert.equal(res.status, 422);
  const body = (await res.json()) as { code?: string; verdict?: string };
  assert.equal(body.code, "probe_audit_failed");
  assert.equal(body.verdict, "none");
});

test("with an explicit override, the manual approve succeeds 200 AND records an audited override", async () => {
  const res = await POST(post({ role, case: { title: "Payments take-home", coverProbes: [] }, overrideProbeAudit: true }) as never);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok?: boolean; id?: string };
  assert.equal(body.ok, true);
  assert.ok(body.id, "expected a saved case id in the response");
  const row = listAudit(200).find((a) => a.ref === body.id);
  assert.ok(row, "manual approve must write an audit row (the lifecycle route always does)");
  assert.equal(row.action, "approved");
  assert.match(row.reason ?? "", /OVERRIDDEN/i);
});

test("a case with load-bearing probes approves 200 with a clean (non-override) audit row", async () => {
  const res = await POST(post({ role, case: { title: "Strong case", coverProbes: strongProbes } }) as never);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { id?: string };
  const row = listAudit(200).find((a) => a.ref === body.id);
  assert.ok(row, "approve must write an audit row");
  assert.doesNotMatch(row.reason ?? "", /OVERRIDDEN/i);
});


// ---- the two doors answer CODES, never the thrown message ----------------------
//
// The case route was the last devcase file on the response-envelope ratchet: both of
// its catches shaped `error.message` into the body (SQLITE_* detail, the absolute db
// path), and its only 400 was bare English on a door whose banner
// (useDevTabActions.runAction) resolves `errors.<CODE>` in the reader's language.
test("approving without a role and a case answers DEVCASE_CASE_FIELDS_REQUIRED", async () => {
  const res = await POST(post({ role, case: undefined }) as never);
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { code?: string }).code, "DEVCASE_CASE_FIELDS_REQUIRED");
});


// ---- the library read stops SILENTLY truncating ---------------------------------
//
// `listDevCases(undefined, ws)` took the store default of 50 and the payload said
// nothing about it, so a studio with more than fifty approved cases showed fifty and
// every older case simply did not exist as far as the Cases table was concerned.
function get(query = ""): Request {
  return new Request(`http://localhost/api/devcase${query}`, { method: "GET" });
}

test("the case list says when it was cut, and ?limit sets the page size", async () => {
  // The three approves above (plus this file's own 400 case) left cases in the store.
  const page = await GET(get("?limit=1") as never);
  assert.equal(page.status, 200);
  const body = (await page.json()) as { cases: unknown[]; limit: number; truncated: boolean };
  assert.equal(body.limit, 1);
  assert.equal(body.cases.length, 1, "?limit is the page size, not a suggestion");
  assert.equal(body.truncated, true, "the answer must SAY a page was cut");

  // …and a page that fits is not claimed as truncated.
  const all = (await (await GET(get("?limit=500") as never)).json()) as { cases: unknown[]; truncated: boolean };
  assert.equal(all.truncated, false);
  assert.ok(all.cases.length >= 2, "the whole library comes back when it fits");
});

test("a malformed ?limit falls back to the default rather than refusing a read", async () => {
  for (const q of ["", "?limit=", "?limit=0", "?limit=-4", "?limit=abc", "?limit=2.5"]) {
    const body = (await (await GET(get(q) as never)).json()) as { limit: number };
    assert.equal(body.limit, 50, `${q || "(none)"} must fall back to the default page size`);
  }
  // …and an absurd one is clamped, never handed to the store.
  const huge = (await (await GET(get("?limit=1000000") as never)).json()) as { limit: number };
  assert.equal(huge.limit, 500);
});


// ---- the ledger is filtered BEFORE the limit, and it is a projection ---------------
//
// challenge-r03 devcase-workspace/A. The stage / title / seniority filter used to run in
// the browser over whatever page the client held, so "collecting" over a 50-row page
// answered for fifty rows, not the library - and the rows it filtered carried the whole
// design (need / analysis / role / case JSON, cover probes included) to draw a title.
test("?stage= filters before ?limit=: 50 collecting rows out of 70, and the page says it was cut", async () => {
  const { saveDevCase, createLifecycle, updateLifecycle } = await import("@/app/_lib/db/devcase");
  for (let i = 0; i < 120; i += 1) {
    const { id } = saveDevCase({ need: null, analysis: null, role: { title: `Role ${i}`, seniority: "medior" }, case: { title: `Ledger case ${i}` } });
    // Every other case of the first 100 is still collecting; the last 20 too.
    if (i % 2 === 0 || i >= 100) {
      const lc = createLifecycle({ title: `run ${i}` }, true, "en");
      updateLifecycle(lc.id, { caseId: id, stage: "collecting" });
    }
  }
  const res = await GET(get("?limit=50&stage=collecting") as never);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { cases: Array<{ stage: string }>; truncated: boolean };
  assert.equal(body.cases.length, 50);
  assert.ok(body.cases.every((c) => c.stage === "collecting"));
  assert.equal(body.truncated, true, "70 match; a page of 50 is cut");
  const all = (await (await GET(get("?limit=500&stage=collecting") as never)).json()) as { cases: unknown[]; truncated: boolean };
  assert.equal(all.cases.length, 70);
  assert.equal(all.truncated, false);
});

test("the list carries ledger rows, never the design JSON, plus the workspace's facets", async () => {
  const body = (await (await GET(get("?limit=500") as never)).json()) as {
    cases: Array<Record<string, unknown>>;
    facets: { stages: string[]; seniorities: string[] };
  };
  assert.ok(body.cases.length > 0);
  for (const row of body.cases) {
    for (const key of ["need", "analysis", "role", "case", "scenario", "seed"]) {
      assert.ok(!(key in row), `${key} must not ride GET /api/devcase`);
    }
    assert.equal(typeof row.stage, "string");
    assert.equal(typeof row.submissionCount, "number");
  }
  assert.ok(body.facets.stages.includes("collecting"));
  assert.ok(body.facets.seniorities.includes("medior"));
  const filtered = (await (await GET(get("?limit=500&q=ledger%20case%2011") as never)).json()) as { cases: Array<{ title: string }> };
  assert.deepEqual(filtered.cases.map((c) => c.title).sort(), ["Ledger case 11", "Ledger case 110", "Ledger case 111", "Ledger case 112", "Ledger case 113", "Ledger case 114", "Ledger case 115", "Ledger case 116", "Ledger case 117", "Ledger case 118", "Ledger case 119"]);
});
