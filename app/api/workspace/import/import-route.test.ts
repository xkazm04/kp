// The RESTORE handler's two 409 branches, driven through the real POST on a
// throwaway SQLite file.
//
// export-guard.test.ts (one directory up) is a SOURCE scan: it pins which guards
// are present and in what order. It cannot answer what the handler actually DOES
// with a file — and the two most instructive things it does were untested and, until
// this change, uncoded: a backup from a DIFFERENT organization is refused outright
// (the ids in a dump are the deployment's own, which is what makes an in-place
// restore safe), and an apply that would DELETE live rows is refused unless the
// caller confirms `replace`. Both now answer with a machine code the console renders
// in the reader's language, so the codes are part of the contract.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import type { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpImportTestCookie?: () => string | null }).__kpImportTestCookie = () => cookieValue;
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
            const value = globalThis.__kpImportTestCookie();
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

// Without an operator password every caller folds to owner (open dev mode) and the
// org:manage half of the gate proves nothing.
process.env.KP_SECRET = "import-route-test-secret";
process.env.KP_OPERATOR_PASSWORD = "import-route-test-password";

const { POST: restore } = await import("./route.ts");
const { dumpOrg } = await import("../../../_lib/db-portability.ts");
const { createWorkspace } = await import("../../../_lib/db/workspaces.ts");
const { createUser } = await import("../../../_lib/db/users.ts");
const { upsertMembership } = await import("../../../_lib/db/memberships.ts");
const { signSession } = await import("../../../_lib/auth/session.ts");

after(() => cleanupUnitDb());

const ORG = "org-default";
const team = createWorkspace("Import test team", ORG);
const owner = createUser({ orgId: ORG, email: "import.owner@csas.cz", name: "Import Owner", status: "active", password: "owner-pw-1234" });
const plain = createUser({ orgId: ORG, email: "import.plain@csas.cz", name: "Import Plain", status: "active", password: "plain-pw-1234" });
upsertMembership(owner.id, team.id, "owner");
upsertMembership(plain.id, team.id, "recruiter");

function signedInAs(user: { id: string; orgId: string } | null): void {
  cookieValue = user === null ? null : signSession(team.id, Date.now(), { sub: user.id, org: user.orgId });
}

const post = (body: unknown): NextRequest =>
  new Request("http://localhost/api/workspace/import", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest;

type Answer = { code?: string; error?: string; existingRows?: number; populated?: string[]; plan?: { totalExisting: number } };
const answer = async (r: Response): Promise<Answer> => (await r.json()) as Answer;

// The org as it stands — the users and memberships created above make it populated,
// which is exactly the precondition the replace refusal is about.
const ownDump = dumpOrg(ORG);

test("a recruiter cannot restore the organization", async () => {
  signedInAs(plain);
  assert.equal((await restore(post({ dump: ownDump }))).status, 403, "restoring is org:manage, not 'any signed-in member'");
});

test("a file from ANOTHER organization is refused with its own code", async () => {
  signedInAs(owner);
  const foreign = { ...ownDump, orgId: "org-somebody-else" };
  const r = await restore(post({ dump: foreign }));
  assert.equal(r.status, 409);
  assert.equal((await answer(r)).code, "RESTORE_FOREIGN_ORG", "the remedy is 'pick the right file', not 'try again'");
});

test("the wrong-org refusal fires on the DRY RUN too, before any plan is computed", async () => {
  signedInAs(owner);
  // No `apply`, so this is the planning call the file picker makes. Planning a
  // foreign file would report counts for a scope this caller has no authority over.
  const r = await restore(post({ dump: { ...ownDump, orgId: "org-somebody-else" } }));
  assert.equal(r.status, 409);
  assert.equal((await answer(r)).plan, undefined, "no plan is handed back for a file that will never be applied");
});

test("the dry run plans without writing, and reports what a restore would replace", async () => {
  signedInAs(owner);
  const r = await restore(post({ dump: ownDump }));
  assert.equal(r.status, 200);
  const plan = (await answer(r)).plan;
  assert.ok(plan && plan.totalExisting > 0, "the org holds rows, so a restore has something to clear");
});

test("apply without replace is refused, and says HOW MUCH is about to go", async () => {
  signedInAs(owner);
  const r = await restore(post({ dump: ownDump, apply: true }));
  assert.equal(r.status, 409, "'12 tables' must never stand in for 'and 4,000 rows'");
  const body = await answer(r);
  assert.equal(body.code, "RESTORE_REPLACE_REQUIRED");
  assert.ok((body.existingRows ?? 0) > 0, "the count rides alongside the code so the dialog can name it");
  assert.ok((body.populated ?? []).length > 0, "…and so can the table list");
});

test("apply WITH replace goes through", async () => {
  signedInAs(owner);
  const r = await restore(post({ dump: ownDump, apply: true, replace: true }));
  assert.equal(r.status, 200);
  const restored = ((await r.json()) as { restored?: { tables: unknown[] } }).restored;
  assert.ok(restored && restored.tables.length > 0, "the receipt is per-table accounting, not a boolean");
});
