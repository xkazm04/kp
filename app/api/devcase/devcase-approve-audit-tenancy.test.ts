// The MANUAL approve's audit row lands under the CALLER's tenant.
//
// `recordAudit`'s `workspaceId` is optional and an unattributed row falls back to the
// DEFAULT workspace (app/_lib/dev-control.ts) — a deliberate accommodation for the
// writers that have no tenant in hand. POST /api/devcase was not one of them: it saved
// the case under `await currentWorkspace()` and then, two lines later, recorded the
// human approval with no workspace at all. Every studio's manual approvals therefore
// listed in the DEFAULT team's audit panel, and `"approved"` is emphatically not one of
// the two deployment-wide actions (GLOBAL_AUDIT_ACTIONS = paused/resumed).
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import type { NextRequest } from "next/server";

register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `next/headers` cannot run outside a Next request scope, and `currentWorkspace()` is
// exactly a read of the session cookie — so the jar is driven from here.
const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpDevcaseAuditCookie?: () => string | null }).__kpDevcaseAuditCookie = () => cookieValue;
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
            const value = globalThis.__kpDevcaseAuditCookie();
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

// Open mode (no KP_OPERATOR_PASSWORD): the gates fold every caller to owner, so what is
// under test here is the TENANT the row is attributed to, not the authority decision.
process.env.KP_SECRET = "devcase-approve-audit-secret";

const { POST } = await import("./route.ts");
const { listAudit } = await import("../../_lib/dev-control.ts");
const { createWorkspace, DEFAULT_WORKSPACE_ID } = await import("../../_lib/db/workspaces.ts");
const { signSession } = await import("../../_lib/auth/session.ts");

after(() => cleanupUnitDb());

const team = createWorkspace("Audit tenancy team", "org-audit-tenancy");
cookieValue = signSession(team.id, Date.now());

const req = (body: unknown): NextRequest =>
  new Request("http://localhost/api/devcase", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": "10.9.0.2" },
  }) as unknown as NextRequest;

test("the manual approval's audit row lists under the caller's tenant, not the default one", async () => {
  const res = await POST(
    req({
      role: { title: "Backend Engineer", seniority: "senior" },
      case: {
        title: "Payments take-home",
        coverProbes: [
          { id: "p1", kind: "trap", where: "src/index.ts", reveals: "handles the retry edge case", decisionSpace: ["retry with backoff", "fail fast"] },
          { id: "p2", kind: "trap", where: "src/db.ts", reveals: "avoids the N+1 query", decisionSpace: ["batch load", "loop per row"] },
        ],
      },
    })
  );
  assert.equal(res.status, 200);
  const { id } = (await res.json()) as { id: string };

  const mine = listAudit(200, team.id).find((a) => a.ref === id);
  assert.ok(mine, "the approval must be visible in the approving team's audit panel");
  assert.equal(mine.action, "approved");

  // Pre-fix this row carried the DEFAULT workspace and appeared here.
  const theirs = listAudit(200, DEFAULT_WORKSPACE_ID).find((a) => a.ref === id);
  assert.equal(theirs, undefined, "another team's audit panel must not list this studio's approval");
});
