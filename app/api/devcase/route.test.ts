import "@/app/_lib/testing/unit-db.ts";
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

let POST: (typeof import("./route.ts"))["POST"];
let listAudit: (typeof import("@/app/_lib/dev-control"))["listAudit"];

before(async () => {
  ({ POST } = await import("./route.ts"));
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
