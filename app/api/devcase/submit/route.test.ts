// TENANCY pin for the INTERNAL submission door, driven through the REAL route handler.
//
// The defect: the route took `postingId` straight off the request body and handed it to
// `intakeSubmission` with no ownership check. Posting ids are internal, non-crypto keys
// (random-id.ts: "Never a security boundary") — which is exactly why the PUBLIC sibling
// `/api/devcase/inbound` refuses a raw `postingId` and insists on the apply token. Being
// operator-gated is not the same as being tenant-scoped: `createSubmission` inherits the
// POSTING's workspace, so a foreign id planted an invented candidate on ANOTHER team's
// submissions board and fired the acknowledgement out of THEIR outbox to a caller-supplied
// address — and, if a lifecycle was collecting there, resumed it (a real evaluation pass).
// `/publish`, `/source`, `/promote` and `/feedback` already make this exact one-line check.
//
// The handler takes its tenant from currentWorkspace(), which reads cookies() — that throws
// outside a request and falls back to the DEFAULT workspace, so the caller here IS the
// default team and a posting owned by anyone else must be refused.
//
// unit-db.ts MUST be the first project import (sets KP_DB_PATH before any store resolves).
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// Point next/server at the test shim BEFORE the route loads (hooks only affect LATER
// resolutions — hence the dynamic imports below).
register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const { saveDevCase, createPosting, listSubmissions, listOutbox } = await import("../../../_lib/db/devcase.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../../../_lib/db/workspaces.ts");
const { POST } = await import("./route.ts");

after(() => cleanupUnitDb());

const WS_THEIRS = "ws-submit-beta";

let seedN = 0;
/** A case → open posting chain owned by `ws`; the posting inherits nothing from the
 *  default tenant, so anything filed against it is visible only to `ws`. */
function seedPosting(ws: string): { postingId: string; token: string } {
  const dc = saveDevCase(
    { need: {}, analysis: {}, role: { title: "Backend Engineer" }, case: { title: "API case" } },
    ws
  );
  const token = `tok-submit-${++seedN}`;
  const posting = createPosting({
    caseId: dc.id,
    channel: "link",
    token,
    roleTitle: "Backend Engineer",
    caseTitle: "API case",
  });
  return { postingId: posting.id, token };
}

function submitReq(body: unknown) {
  return new Request("http://localhost/api/devcase/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

test("submitting into ANOTHER team's posting by id is refused — no row, no acknowledgement", async () => {
  const { postingId } = seedPosting(WS_THEIRS);

  const res = await POST(
    submitReq({ postingId, candidateRef: "mallory", repoRef: "https://example.test/mallory", contact: "mallory@evil.test" })
  );

  // Pre-fix this was 200: the row landed in ws-submit-beta and their outbox mailed the ack.
  assert.equal(res.status, 404, "a known posting id from another team must not be submittable");
  assert.equal(listSubmissions(postingId, WS_THEIRS).length, 0, "nothing was planted on their board");
  assert.equal(
    listOutbox(20, WS_THEIRS).some((m) => m.kind === "acknowledgement"),
    false,
    "no acknowledgement may be sent out of their outbox to a caller-supplied address"
  );
});

test("the apply TOKEN is no back door around the same wall", async () => {
  // The token is the credential for the PUBLIC door (/api/devcase/inbound). Presenting it
  // at this authenticated door must not let a session from another team act inside theirs.
  const { postingId, token } = seedPosting(WS_THEIRS);

  const res = await POST(submitReq({ token, candidateRef: "mallory", repoRef: "https://example.test/mallory" }));

  assert.equal(res.status, 404);
  assert.equal(listSubmissions(postingId, WS_THEIRS).length, 0);
});

test("submitting into your OWN team's posting still works (the guard is not over-broad)", async () => {
  const { postingId } = seedPosting(DEFAULT_WORKSPACE_ID);

  const res = await POST(submitReq({ postingId, candidateRef: "ada", repoRef: "https://example.test/ada" }));

  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok?: boolean; submission?: { candidateRef?: string } };
  assert.equal(body.ok, true);
  assert.equal(body.submission?.candidateRef, "ada");
  assert.equal(listSubmissions(postingId, DEFAULT_WORKSPACE_ID).length, 1, "the owning team gets the submission");
});

test("an unknown posting id answers the same 404 — never an existence oracle", async () => {
  const res = await POST(
    submitReq({ postingId: "posting-does-not-exist", candidateRef: "ada", repoRef: "https://example.test/ada" })
  );
  assert.equal(res.status, 404);
});
