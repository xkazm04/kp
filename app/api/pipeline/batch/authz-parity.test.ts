// batch-authz-parity — pins that /api/pipeline/batch and /api/pipeline/command
// share the SAME operator gate. Both are workspace-wide bulk mutation surfaces
// that can reject candidates AND extend candidate-facing rejection comms in one
// call (up to 200 entries for batch), so the batch route must not reach that
// gated action ungated while the command bar guards it — a select-all + bulk
// reject from the anonymous demo session the proxy waves through would otherwise
// slip past.
//
// Source-guard style (mirrors rate-limit-contract.test.ts): the route modules
// import via the "@/..." alias and pull in next/server, so this asserts against
// the route SOURCE rather than driving the handler — the gate's presence,
// wiring, and (for batch) its ordering ahead of the throttle are all pinned
// structurally, which is robust under the bare runner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

const GATE_IMPORT = /import\s*\{\s*requireOperator\s*\}\s*from\s*"@\/app\/_lib\/auth\/require-operator"/;
// The canonical call shape both routes use: return the gate's own refusal response
// verbatim so the client renders the same envelope. Whitespace-tolerant.
const GATE_CALL = /const\s+denied\s*=\s*await\s+requireOperator\(\)\s*;?\s*if\s*\(\s*denied\s*\)\s*return\s+denied\s*;?/;

for (const rel of ["./route.ts", "../command/route.ts"]) {
  test(`${rel} is operator-gated (shared requireOperator, refusal returned verbatim)`, () => {
    const src = read(rel);
    assert.match(src, GATE_IMPORT, "must import the shared requireOperator gate");
    assert.match(src, GATE_CALL, "must apply the gate and return its refusal response verbatim");
  });
}

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
