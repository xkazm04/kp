// The two ORGANIZATION settings writes — the only pair of server actions in the app
// that change company-wide state, and the only writes on the Organization tab.
//
// Neither asked who was calling. Every route beside them resolves a capability first
// (export/route.ts, import/route.ts, /api/org/*), but a server action is reachable by
// any signed-in recruiter with a POST, and `setOrgLanguage` writes
// `workspaces.default_locale`: the SHARED row that decides the language of background
// automation passes and of every candidate email sent without a request cookie. A
// recruiter could re-language the whole company's outbound comms.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import { cleanupUnitDb } from "./testing/unit-db.ts";

// `next/headers` needs a Next request scope. Resolve it to a virtual module whose
// cookie jar this file drives — and whose `set` RECORDS instead of writing, so the
// assertions can tell "refused before touching the jar" from "wrote".
// `currentSession()` awaits next/server's `connection()`, which throws outside a Next
// request scope and silently degrades every caller to "no session". Point next/server
// at the shared shim BEFORE the dynamic imports below - without it these tests pass
// only where a module-resolution accident makes `connection()` a no-op (the wave
// worktree) and fail on a plain checkout.
register(new URL("./testing/next-server-hooks.mjs", import.meta.url));

const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
const written: { name: string; value: string }[] = [];
(globalThis as { __kpOrgActionCookie?: () => string | null }).__kpOrgActionCookie = () => cookieValue;
(globalThis as { __kpOrgActionSet?: (n: string, v: string) => void }).__kpOrgActionSet = (name, value) => {
  written.push({ name, value });
};
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
            const value = globalThis.__kpOrgActionCookie();
            return {
              get: (name) => (name === ${JSON.stringify(SESSION_COOKIE)} && value ? { name, value } : undefined),
              set: (name, v) => globalThis.__kpOrgActionSet(name, v),
            };
          }
          export async function headers() { return new Headers(); }
          export async function draftMode() { return { isEnabled: false }; }
        `,
      };
    }
    return nextLoad(url, context);
  },
});

// Without an operator password every caller folds to owner (open dev mode) and there
// is no authority decision left to prove.
process.env.KP_SECRET = "org-actions-test-secret";
process.env.KP_OPERATOR_PASSWORD = "org-actions-test-password";

const { setOrgLanguage, setOrgName } = await import("./org-actions.ts");
const { createWorkspace, getWorkspaceDefaultLocale } = await import("./db/workspaces.ts");
const { createUser } = await import("./db/users.ts");
const { upsertMembership } = await import("./db/memberships.ts");
const { signSession } = await import("./auth/session.ts");

after(() => cleanupUnitDb());

const ORG = "org-default";
const team = createWorkspace("Org actions team", ORG);
const owner = createUser({ orgId: ORG, email: "act.owner@csas.cz", name: "Act Owner", status: "active", password: "owner-pw-1234" });
const admin = createUser({ orgId: ORG, email: "act.admin@csas.cz", name: "Act Admin", status: "active", password: "admin-pw-1234" });
const plain = createUser({ orgId: ORG, email: "act.plain@csas.cz", name: "Act Plain", status: "active", password: "plain-pw-1234" });
upsertMembership(owner.id, team.id, "owner");
upsertMembership(admin.id, team.id, "admin");
upsertMembership(plain.id, team.id, "recruiter");

function signedInAs(user: { id: string; orgId: string } | null): void {
  cookieValue = user === null ? null : signSession(team.id, Date.now(), { sub: user.id, org: user.orgId });
  written.length = 0;
}

test("a recruiter cannot re-language the organization", async () => {
  signedInAs(plain);
  const before = getWorkspaceDefaultLocale(team.id);
  const res = await setOrgLanguage("de");
  assert.deepEqual(res, { ok: false, code: "ORG_SETTINGS_FORBIDDEN" });
  assert.equal(getWorkspaceDefaultLocale(team.id), before, "the shared workspace row is untouched");
  assert.equal(written.length, 0, "and no locale cookie was minted either");
});

test("an ADMIN cannot either — this is an org:manage setting, not members:manage", async () => {
  signedInAs(admin);
  assert.deepEqual(await setOrgLanguage("fr"), { ok: false, code: "ORG_SETTINGS_FORBIDDEN" });
});

test("a session-less caller is refused", async () => {
  signedInAs(null);
  assert.deepEqual(await setOrgName("Hijacked s.r.o."), { ok: false, code: "ORG_SETTINGS_FORBIDDEN" });
  assert.equal(written.length, 0);
});

test("an owner sets the language, and BOTH authorities follow", async () => {
  signedInAs(owner);
  assert.deepEqual(await setOrgLanguage("cs"), { ok: true });
  assert.equal(getWorkspaceDefaultLocale(team.id), "cs", "background automation + candidate comms read this one");
  assert.ok(
    written.some((c) => c.value === "cs"),
    "…and the request-scoped half is the locale cookie"
  );
});

test("a recruiter cannot rebrand the organization either", async () => {
  signedInAs(plain);
  assert.deepEqual(await setOrgName("Not My Company"), { ok: false, code: "ORG_SETTINGS_FORBIDDEN" });
  assert.equal(written.length, 0, "the name lives in a cookie, but writing it is still an administrator's act");
});

test("an owner rebrands, sanitized", async () => {
  signedInAs(owner);
  assert.deepEqual(await setOrgName("   Acme Hiring   "), { ok: true });
  assert.equal(written.at(-1)?.value, "Acme Hiring", "trimmed on the way in");
});

test("a language that is not one of the app's four answers its OWN code", async () => {
  signedInAs(owner);
  // Not a permission problem: telling an owner they lack a capability because they
  // sent nonsense is the kind of wrong answer that costs a support round.
  assert.deepEqual(await setOrgLanguage("kl" as "en"), { ok: false, code: "ORG_LANGUAGE_INVALID" });
});
