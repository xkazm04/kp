// authz-parity — pins that EVERY pipeline mutation/PII surface shares the SAME gate:
// the operator gate on every handler, and the seat (pipeline:write) on every write.
// The workspace-wide bulk surfaces (/api/pipeline/batch, /api/pipeline/command), the
// per-card single-entry surface (/api/pipeline/[id] and its /timeline, /consent,
// /offer-letter reads), the hire-rating door (/api/pipeline/outcomes) and the
// board-configuration doors are one family: none may reach a gated action ungated.
//
// DERIVED, not hand-listed (challenge-r07 pipeline-api/A). This file used to pin five
// routes by name; seven more in the same directory were gated but pinned by nothing,
// and a new route could ship with no gate at all without this file noticing. It now
// WALKS app/api/pipeline/**/route.ts and fails for any exported handler that neither
// carries the gate nor appears in ALLOWLIST with its reason.
//
// Source-guard style (mirrors rate-limit-contract.test.ts): the route modules import
// via the "@/..." alias and pull in next/server, so this asserts against the route
// SOURCE rather than driving the handler. write-capability-gate.test.ts drives the
// real handlers for the viewer 403.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PIPELINE_DIR = resolve(HERE, "..");
function read(rel: string): string {
  return readFileSync(resolve(HERE, rel), "utf8");
}

const GATE_IMPORT = /import\s*\{\s*requireOperator\s*\}\s*from\s*"@\/app\/_lib\/auth\/require-operator"/;
// The canonical call shape every gated route uses: return the gate's own refusal
// response verbatim so the client renders the same envelope. Whitespace-tolerant.
const GATE_CALL = /const\s+denied\s*=\s*await\s+requireOperator\(\)\s*;?\s*if\s*\(\s*denied\s*\)\s*return\s+denied\s*;?/;
// The seat: every write asks pipeline:write through the coded wrapper, so a viewer is
// answered FORBIDDEN_CAPABILITY with the capability as data.
const SEAT_CALL = /requireCapabilityCoded\(\s*(?:"pipeline:write"|[A-Za-z_.[\]]+\.capability)/;

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Handlers that are knowingly NOT on the shared gate, each with its reason. A key is
 *  `<route path relative to app/api/pipeline> <METHOD>`. */
const ALLOWLIST = new Map<string, string>([
  [
    "events/route.ts GET",
    "the public Activity feed — unauthenticated BY DESIGN, and it answers only the anonymized projection (pipeline-events-public.ts); events/recent is the gated full-detail read",
  ],
  [
    "route.ts GET",
    "debt — the board list; the proxy gates the session, but the handler asks nothing itself. Owned this wave by r06 db-pipeline-store/A (the re-add door); route-capability-coverage.test.ts still lists it",
  ],
  [
    "route.ts POST",
    "debt — add-to-pipeline / the human re-add reopen door, owned this wave by r06 db-pipeline-store/A; route-capability-coverage.test.ts still lists it",
  ],
]);

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (name === "route.ts") out.push(full);
  }
  return out;
}

/** Each exported handler's own source slice: from its `export` to the next handler. */
function handlers(src: string): Array<{ method: string; body: string }> {
  const re = /export\s+(?:async\s+function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
  const found = [...src.matchAll(re)].map((m) => ({ method: m[1], at: m.index ?? 0 }));
  return found.map((h, i) => ({ method: h.method, body: src.slice(h.at, found[i + 1]?.at ?? src.length) }));
}

const FILES = routeFiles(PIPELINE_DIR).map((full) => ({
  rel: relative(PIPELINE_DIR, full).split("\\").join("/"),
  src: readFileSync(full, "utf8"),
}));

test("the walk sees the family (a walk that finds nothing would pass vacuously)", () => {
  const rels = FILES.map((f) => f.rel);
  for (const known of ["route.ts", "[id]/route.ts", "batch/route.ts", "command/route.ts", "outcomes/route.ts", "stage-sla/route.ts"]) {
    assert.ok(rels.includes(known), `expected to walk ${known}`);
  }
  assert.ok(FILES.length >= 14, `walked only ${FILES.length} route files`);
});

for (const { rel, src } of FILES) {
  for (const { method, body } of handlers(src)) {
    const key = `${rel} ${method}`;
    if (ALLOWLIST.has(key)) continue;
    test(`${key} takes the operator gate${WRITE_METHODS.has(method) ? " and asks the pipeline:write seat" : ""}`, () => {
      assert.match(src, GATE_IMPORT, `${rel} must import the shared requireOperator gate`);
      assert.match(body, GATE_CALL, `${key} must apply the gate and return its refusal verbatim`);
      if (WRITE_METHODS.has(method)) {
        assert.match(body, SEAT_CALL, `${key} is a write: it must ask requireCapabilityCoded("pipeline:write")`);
        assert.ok(body.search(GATE_CALL) < body.search(SEAT_CALL), `${key}: the session gate precedes the seat`);
      }
    });
  }
}

test("every ALLOWLIST row names a handler that still exists (a stale excuse is a hole)", () => {
  const live = new Set(FILES.flatMap(({ rel, src }) => handlers(src).map((h) => `${rel} ${h.method}`)));
  for (const key of ALLOWLIST.keys()) assert.ok(live.has(key), `ALLOWLIST row "${key}" matches no handler — delete it`);
});

// In POST, the gate must precede reading params and the request body — a refused
// caller never reaches the mutation path.
test("/api/pipeline/[id] POST gates before it resolves params or reads the body; the seat comes from the declared table", () => {
  const src = read("../[id]/route.ts");
  const postBody = src.slice(src.indexOf("export async function POST"));
  const postGateAt = postBody.search(GATE_CALL);
  const paramsAt = postBody.indexOf("context.params");
  const bodyAt = postBody.indexOf("request.json()");
  assert.ok(postGateAt >= 0, "POST must carry the gate");
  assert.ok(paramsAt < 0 || postGateAt < paramsAt, "the gate must precede resolving params");
  assert.ok(bodyAt < 0 || postGateAt < bodyAt, "the gate must precede reading the request body");
  // The seat is read from ENTRY_ACTIONS, not typed per branch — and it is asked before
  // any action's work (the first store write).
  const seatAt = postBody.search(/requireCapabilityCoded\(\s*ENTRY_ACTIONS\[/);
  assert.ok(seatAt > 0, "the seat must be read from the declared action table");
  for (const work of ["setEntryGithubEvidence(", "setEntryNotes(", "reinstatePipelineEntry(", "clearIntakeDegraded(", "runPipelineEntryAction("]) {
    const at = postBody.indexOf(work);
    assert.ok(at > seatAt, `${work} must run after the seat is asked`);
  }
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
