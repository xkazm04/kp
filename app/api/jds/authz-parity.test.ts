// authz-parity — pins that EVERY JD-authoring & template WRITE shares the SAME
// operator gate that the public JD page's PATCH / revisions already carry. The
// same demo-session hole the proxy could wave through reaches these paid/abuse
// surfaces:
//   - POST /api/jds/generate        — spawns a 1–2 minute PAID AI build (cost/abuse)
//   - POST /api/jds                 — writes a JD row to the library
//   - POST /api/jds/save            — saves a draft + ingests its Job
//   - POST /api/jds/[slug]/ingest-job    — one LLM parse to make a JD matchable
//   - POST /api/jds/[slug]/retry-analysis — REPLAYS the paid AI build
//   - POST/PUT/DELETE /api/templates(/[id]) — create (incl. publishing an
//     org-shared template visible to EVERY team), edit, set-default, delete
// Reads stay OPEN: GET /api/jds, GET /api/templates, GET /api/templates/[id]
// (the JD detail page and template pickers are public/shareable). So none of the
// writes may reach their action ungated, and none of the reads may be gated.
//
// Source-guard style (mirrors ../pipeline/batch/authz-parity.test.ts): the route
// modules import via the "@/..." alias and pull in next/server, so this asserts
// against the route SOURCE rather than driving the handler — robust under the
// bare runner where next/server route tests can't execute.
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

// POST-only authoring surfaces: the whole module gates (the only exported handler
// is the write), so the gate + its import must both be present.
const POST_ONLY_GATED = [
  "./generate/route.ts",
  "./save/route.ts",
  "./[slug]/ingest-job/route.ts",
  "./[slug]/retry-analysis/route.ts",
];

for (const rel of POST_ONLY_GATED) {
  test(`${rel} POST is operator-gated (shared requireOperator, refusal returned verbatim)`, () => {
    const src = read(rel);
    assert.match(src, GATE_IMPORT, "must import the shared requireOperator gate");
    assert.match(src, GATE_CALL, "must apply the gate and return its refusal response verbatim");
    // The gate must precede the handler's work (params/body). Each of these reads
    // request.json() and/or context.params — the gate sits ahead of both.
    const postAt = src.indexOf("export async function POST");
    const gateAt = src.search(GATE_CALL);
    assert.ok(postAt >= 0 && gateAt > postAt, "the gate must be inside POST");
    const bodyAt = src.indexOf("request.json(", postAt);
    const paramsAt = src.indexOf("context.params", postAt);
    assert.ok(bodyAt < 0 || gateAt < bodyAt, "the gate must precede reading the request body");
    assert.ok(paramsAt < 0 || gateAt < paramsAt, "the gate must precede resolving params");
  });
}

// The mixed read/write routes: the WRITE export(s) must gate; the GET must NOT
// (reads stay open — the JD detail page and template pickers are public).
test("/api/jds gates POST but leaves GET open", () => {
  const src = read("./route.ts");
  assert.match(src, GATE_IMPORT, "must import the shared gate");
  const getAt = src.indexOf("export async function GET");
  const postAt = src.indexOf("export async function POST");
  assert.ok(getAt >= 0 && postAt >= 0, "must export both GET and POST");
  const getBody = src.slice(getAt, postAt);
  const postBody = src.slice(postAt);
  assert.doesNotMatch(getBody, GATE_CALL, "GET (the library list) must stay OPEN — reads aren't gated");
  assert.match(postBody, GATE_CALL, "POST (write a JD to the library) must be operator-gated");
});

test("/api/templates gates POST but leaves GET open", () => {
  const src = read("../templates/route.ts");
  assert.match(src, GATE_IMPORT, "must import the shared gate");
  const getAt = src.indexOf("export async function GET");
  const postAt = src.indexOf("export async function POST");
  assert.ok(getAt >= 0 && postAt >= 0, "must export both GET and POST");
  const getBody = src.slice(getAt, postAt);
  const postBody = src.slice(postAt);
  assert.doesNotMatch(getBody, GATE_CALL, "GET (the team's template library) must stay OPEN");
  assert.match(postBody, GATE_CALL, "POST (create — incl. publishing an org-shared template) must be operator-gated");
});

test("/api/templates/[id] gates BOTH PUT and DELETE, leaves GET open", () => {
  const src = read("../templates/[id]/route.ts");
  assert.match(src, GATE_IMPORT, "must import the shared gate");
  const getAt = src.indexOf("export async function GET");
  const putAt = src.indexOf("export async function PUT");
  const deleteAt = src.indexOf("export async function DELETE");
  assert.ok(getAt >= 0 && putAt >= 0 && deleteAt >= 0, "must export GET, PUT and DELETE");
  // Handlers appear in source order GET → PUT → DELETE.
  const getBody = src.slice(getAt, putAt);
  const putBody = src.slice(putAt, deleteAt);
  const deleteBody = src.slice(deleteAt);
  assert.doesNotMatch(getBody, GATE_CALL, "GET (load one template) must stay OPEN");
  assert.match(putBody, GATE_CALL, "PUT (edit / set-default — mutates shared library state) must be operator-gated");
  assert.match(deleteBody, GATE_CALL, "DELETE (incl. an org-shared template) must be operator-gated");
});
