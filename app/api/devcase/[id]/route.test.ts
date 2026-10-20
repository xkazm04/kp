// GET /api/devcase/[id] - the detail reader's own read (challenge-r03
// devcase-workspace/A).
//
// The Cases table used to ship every case's full design (need / analysis / role / case
// JSON) in the LIST so the reader could open without a second fetch. The list is now a
// ledger projection; the full record is fetched by id, on open, and only for a case in
// the caller's workspace: a case id is not an authority to read another team's design.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `currentWorkspace()` reads the session cookie through next/headers, which cannot run
// outside a Next request scope - so the jar is driven from here.
const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpDevcaseDetailCookie?: () => string | null }).__kpDevcaseDetailCookie = () => cookieValue;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return { url: VIRTUAL_HEADERS, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === VIRTUAL_HEADERS) {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          export async function cookies() {
            const value = globalThis.__kpDevcaseDetailCookie();
            return { get: (name) => (name === ${JSON.stringify(SESSION_COOKIE)} && value ? { name, value } : undefined) };
          }
          export async function headers() { return new Headers(); }
          export async function draftMode() { return { isEnabled: false }; }
        `,
      };
    }
    return nextLoad(url, context);
  },
});

// Open mode (no KP_OPERATOR_PASSWORD): identity folds to owner, so what is under test is
// the TENANT the read is scoped to.
process.env.KP_SECRET = "devcase-detail-secret";

const { GET } = await import("./route.ts");
const { saveDevCase } = await import("../../../_lib/db/devcase.ts");
const { createWorkspace } = await import("../../../_lib/db/workspaces.ts");
const { signSession } = await import("../../../_lib/auth/session.ts");

after(() => cleanupUnitDb());

const mine = createWorkspace("Detail team", "org-detail-mine");
const theirs = createWorkspace("Other detail team", "org-detail-theirs");

const design = {
  need: { title: "Payments", jdSlug: "payments-engineer" },
  analysis: { confidence: 0.8 },
  role: { title: "Payments engineer", seniority: "senior" },
  case: { title: "Refund ledger", coverProbes: [{ id: "p1", where: "src/ledger.ts" }] },
};
const ownId = saveDevCase(design, mine.id).id;
const foreignId = saveDevCase({ ...design, case: { title: "Their secret case" } }, theirs.id).id;

const call = (id: string) =>
  GET(new Request(`http://localhost/api/devcase/${id}`), { params: Promise.resolve({ id }) });

test("the caller's own case comes back as the full record the detail reader renders", async () => {
  cookieValue = signSession(mine.id, Date.now());
  const res = await call(ownId);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { case: Record<string, unknown> };
  assert.equal(body.case.id, ownId);
  assert.equal(body.case.title, "Refund ledger");
  assert.deepEqual((body.case.role as { title: string }).title, "Payments engineer");
  assert.ok(Array.isArray((body.case.case as { coverProbes: unknown[] }).coverProbes));
  assert.equal(body.case.jdSlug, "payments-engineer");
});

test("another workspace's case id answers 404 with a code, not the record", async () => {
  cookieValue = signSession(mine.id, Date.now());
  const res = await call(foreignId);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { code?: string; case?: unknown };
  assert.equal(body.code, "DEVCASE_CASE_NOT_FOUND");
  assert.equal(body.case, undefined);
});

test("an unknown id answers the same 404 as a foreign one (no existence oracle)", async () => {
  cookieValue = signSession(mine.id, Date.now());
  const res = await call("dc_does_not_exist");
  assert.equal(res.status, 404);
  assert.equal(((await res.json()) as { code?: string }).code, "DEVCASE_CASE_NOT_FOUND");
});
