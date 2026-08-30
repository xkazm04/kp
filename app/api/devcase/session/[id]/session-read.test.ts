// Ownership-check pin for the recruiter-facing GET /session/[id] route.
//
// currentWorkspace() reads cookies() — that throws outside a request and falls
// back to the DEFAULT workspace. So the caller here IS the default team; a
// session owned by any other workspace must be refused.
//
// unit-db.ts MUST be the first project import (sets KP_DB_PATH before any store resolves).
import { cleanupUnitDb } from "../../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// Point next/server at the test shim BEFORE the route loads.
register(new URL("../../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const { saveDevCase, createPosting, startDevSession, getDevSessionChat, appendDevSessionChat, saveDevSessionFiles } = await import(
  "../../../../_lib/db/devcase.ts"
);
const { DEFAULT_WORKSPACE_ID } = await import("../../../../_lib/db/workspaces.ts");
const { GET } = await import("./route.ts");

after(() => cleanupUnitDb());

let seedN = 0;
function seedPosting(ws: string): { token: string; postingId: string } {
  const dc = saveDevCase({ need: {}, analysis: {}, role: { title: "Backend Engineer" }, case: { title: "API case" } }, ws);
  const posting = createPosting({ caseId: dc.id, channel: "link", token: `tok-session-read-${++seedN}`, roleTitle: "Backend Engineer", caseTitle: "API case" });
  return { token: posting.token!, postingId: posting.id };
}

function getReq(id: string): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`http://localhost/api/devcase/session/${id}`, { method: "GET" }),
    { params: Promise.resolve({ id }) }
  ];
}

test("GET /session/[id] — 404 for unknown id", async () => {
  const res = await GET(...getReq("dsess-does-not-exist"));
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, "session not found");
});

test("GET /session/[id] — 404 for a session owned by another workspace", async () => {
  const { token } = seedPosting("ws-session-beta");
  const session = startDevSession({ token });

  const res = await GET(...getReq(session.id));
  // The caller is the DEFAULT workspace; session belongs to ws-session-beta
  assert.equal(res.status, 404, "a session from another team must be refused");
  const body = await res.json();
  assert.equal(body.error, "session not found");
});

test("GET /session/[id] — returns transcript and files for the owning workspace", async () => {
  const { token } = seedPosting(DEFAULT_WORKSPACE_ID);
  const session = startDevSession({ token });

  // Append a chat message and save a file
  appendDevSessionChat(session.id, "default", "user", "hello from the candidate");
  saveDevSessionFiles(session.id, [{ path: "src/index.ts", contents: "export const x = 1;" }]);

  const res = await GET(...getReq(session.id));
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.session.id, session.id);
  assert.equal(body.session.status, "active");
  assert.ok(Array.isArray(body.transcript), "transcript must be an array");
  assert.equal(body.transcript.length, 1, "one chat message was appended");
  assert.equal(body.transcript[0].text, "hello from the candidate");
  assert.ok(Array.isArray(body.files), "files must be an array");
  assert.equal(body.files.length, 1, "one file was saved");
  assert.equal(body.files[0].path, "src/index.ts");
});
