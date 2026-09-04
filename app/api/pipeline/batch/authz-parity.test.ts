// authz-parity — pins that EVERY pipeline mutation/PII surface that can drive an
// adverse action shares the SAME operator gate: the workspace-wide bulk surfaces
// (/api/pipeline/batch, /api/pipeline/command) AND the per-card single-entry surface
// (/api/pipeline/[id] POST accept/reject/reinstate, its GET canonical entry, and the
// [id]/timeline bundle). The single-entry route was the last ungated adverse-action
// path — a demo session the proxy waves through could reject candidates (and fire
// their rejection comms) one card at a time, or read a candidate's full label + comms
// letters + scorecard, while batch/command already gated the bulk form. So none of
// these may reach a gated action ungated.
//
// Source-guard style (mirrors rate-limit-contract.test.ts): the route modules import
// via the "@/..." alias and pull in next/server, so this asserts against the route
// SOURCE rather than driving the handler — the gate's presence, wiring, and (for
// batch) its ordering ahead of the throttle are all pinned structurally, which is
// robust under the bare runner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
function read(rel: string): string {
  return readFileSync(resolve(HERE, rel), "utf8");
}

const GATE_IMPORT = /import\s*\{\s*requireOperator\s*\}\s*from\s*"@\/app\/_lib\/auth\/require-operator"/;
// The canonical call shape every gated route uses: return the gate's own refusal
// response verbatim so the client renders the same envelope. Whitespace-tolerant.
const GATE_CALL = /const\s+denied\s*=\s*await\s+requireOperator\(\)\s*;?\s*if\s*\(\s*denied\s*\)\s*return\s+denied\s*;?/;

// Every pipeline surface that mutates or exposes recruiter PII for one/many entries.
const GATED_ROUTES = [
  "./route.ts", // batch
  "../command/route.ts", // command bar
  "../[id]/route.ts", // single entry (GET + POST)
  "../[id]/timeline/route.ts", // drawer bundle (GET)
  // ADDED /perfect 2026-09-02: the consent snapshot + GDPR audit trail (GET). It
  // was the one sibling in this family still leaning on "the board is behind auth",
  // while carrying MORE about a named person than either route above.
  "../[id]/consent/route.ts",
];

for (const rel of GATED_ROUTES) {
  test(`${rel} is operator-gated (shared requireOperator, refusal returned verbatim)`, () => {
    const src = read(rel);
    assert.match(src, GATE_IMPORT, "must import the shared requireOperator gate");
    assert.match(src, GATE_CALL, "must apply the gate and return its refusal response verbatim");
  });
}

// The single-entry route exports BOTH a GET (one canonical-scored entry) and a POST
// (accept/reject/reinstate/set_*); each must gate independently — a gate on only one
// export would leave the other reachable. Assert the gate appears inside each handler
// before it does any work (params/body/db).
test("/api/pipeline/[id] gates BOTH the GET and the POST, each before the handler's work", () => {
  const src = read("../[id]/route.ts");
  const getAt = src.indexOf("export async function GET");
  const postAt = src.indexOf("export async function POST");
  assert.ok(getAt >= 0 && postAt >= 0, "the route must export both GET and POST");

  // The gate for GET sits between the GET signature and the POST signature; the gate
  // for POST sits after the POST signature. Each handler contains its own gate call.
  const getBody = src.slice(getAt, postAt);
  const postBody = src.slice(postAt);
  assert.match(getBody, GATE_CALL, "the GET (canonical entry: full label + score) must be operator-gated");
  assert.match(postBody, GATE_CALL, "the POST (accept/reject/reinstate/set_*) must be operator-gated");

  // In POST, the gate must precede reading params and the request body — a refused
  // caller never reaches the mutation path.
  const postGateAt = postBody.search(GATE_CALL);
  const paramsAt = postBody.indexOf("context.params");
  const bodyAt = postBody.indexOf("request.json()");
  assert.ok(postGateAt >= 0, "POST must carry the gate");
  assert.ok(paramsAt < 0 || postGateAt < paramsAt, "the gate must precede resolving params");
  assert.ok(bodyAt < 0 || postGateAt < bodyAt, "the gate must precede reading the request body");
});

test("the batch route gates BEFORE it spends rate-limit budget", () => {
  const src = read("./route.ts");
  const gateAt = src.search(GATE_CALL);
  const limiterAt = src.indexOf("rateLimit(`pipeline-batch:");
  assert.ok(gateAt >= 0, "the operator gate must be present");
  assert.ok(limiterAt >= 0, "the per-IP batch limiter must be present");
  assert.ok(gateAt < limiterAt, "requireOperator must run before the throttle — an unauthorized caller is refused before consuming budget");
});

test("the batch route gates inside POST, ahead of any workspace resolution or body read", () => {
  const src = read("./route.ts");
  const postAt = src.indexOf("export async function POST");
  const gateAt = src.indexOf("requireOperator()", postAt);
  const wsAt = src.indexOf("currentWorkspace()", postAt);
  const bodyAt = src.indexOf("request.json()", postAt);
  assert.ok(postAt >= 0 && gateAt > postAt, "the gate must be the first thing POST does");
  assert.ok(gateAt < wsAt, "the gate must precede workspace resolution");
  assert.ok(gateAt < bodyAt, "the gate must precede reading the request body");
});
