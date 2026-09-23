// GET /api/me/capability-holders?cap=<capability> — who in the caller's CURRENT
// workspace holds the capability a locked tab needs, so the locked-door panel can
// name a person to ask (challenge-r08 workspace-shell-core/B).
//
// A strict subset of GET /api/org/members (which already serves every `read`
// holder the whole roster with per-team capabilities): at most 5 rows of
// {name, email, role}, this team only, never an id, overrides or a team list.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const VIRTUAL_HEADERS = "kp-test:next-headers-capability-holders";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpHoldersCookie?: () => string | null }).__kpHoldersCookie = () => cookieValue;
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
            const value = globalThis.__kpHoldersCookie();
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

process.env.KP_SECRET = "capability-holders-route-test-secret";
process.env.KP_OPERATOR_PASSWORD = "capability-holders-route-test-password";

const { GET } = await import("./route.ts");
const { signSession } = await import("../../../_lib/auth/session.ts");
const { createUser, setUserStatus } = await import("../../../_lib/db/users.ts");
const { upsertMembership, setMembershipOverrides } = await import("../../../_lib/db/memberships.ts");
const { createWorkspace } = await import("../../../_lib/db/workspaces.ts");
const { createOrganization } = await import("../../../_lib/db/organizations.ts");

after(() => cleanupUnitDb());

const ORG = "org-default";
const PW = "correct horse battery";
const mk = (email: string, name: string | null, org = ORG) => createUser({ orgId: org, email, name, status: "active", password: PW });

// Workspace W = a fresh team (the default one carries the seeded demo roster):
// admin A joins FIRST so the owner-first order is the route's ranking, not
// insertion order.
const W = createWorkspace("Holders team", ORG).id;
const admin = mk("admin-h@example.com", "Ada Admin");
const owner = mk("owner-h@example.com", "Olga Owner");
const recruiter = mk("rec-h@example.com", "Rex Recruiter");
const viewer = mk("viewer-h@example.com", "Vic Viewer");
const gone = mk("gone-h@example.com", "Gone Owner");
upsertMembership(admin.id, W, "admin");
upsertMembership(owner.id, W, "owner");
upsertMembership(recruiter.id, W, "recruiter");
upsertMembership(viewer.id, W, "viewer");
upsertMembership(gone.id, W, "owner");
setUserStatus(gone.id, "disabled");

// Another team in the same org, and another org — neither may leak into W's answer.
const otherTeam = createWorkspace("Other team", ORG);
const otherTeamOwner = mk("team2-owner-h@example.com", "Tess OtherTeam");
upsertMembership(otherTeamOwner.id, otherTeam.id, "owner");
const otherOrg = createOrganization("Other org");
const foreigner = mk("foreign-h@example.com", "Fay Foreign", otherOrg.id);
// A membership row pointing a foreign-org user at W: the route still refuses them.
upsertMembership(foreigner.id, W, "owner");

// A read-revoked seat: authenticated, no `read` → 403.
const revoked = mk("revoked-h@example.com", "Rae Revoked");
upsertMembership(revoked.id, W, "viewer");
setMembershipOverrides(revoked.id, W, { grant: [], revoke: ["read"] });

const as = (userId: string, workspace = W) => {
  cookieValue = signSession(workspace, Date.now(), { sub: userId, org: ORG });
};
const get = (cap: string) => GET(new Request(`http://localhost/api/me/capability-holders?cap=${encodeURIComponent(cap)}`));

test("org:manage in W names the active owner only", async () => {
  as(viewer.id);
  const res = await get("org:manage");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { holders: Array<Record<string, unknown>> };
  assert.deepEqual(body.holders, [{ name: "Olga Owner", email: "owner-h@example.com", role: "owner" }]);
});

test("members:manage names owner then admin, and never another team or org", async () => {
  as(viewer.id);
  const res = await get("members:manage");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { holders: Array<{ email: string }> };
  assert.deepEqual(body.holders.map((h) => h.email), ["owner-h@example.com", "admin-h@example.com"]);
  const wire = JSON.stringify(body);
  assert.doesNotMatch(wire, /team2-owner-h|foreign-h|gone-h/);
});

test("a caller without `read` is refused by the capability gate", async () => {
  as(revoked.id);
  assert.equal((await get("org:manage")).status, 403);
  cookieValue = null;
  assert.equal((await get("org:manage")).status, 401);
});

test("an unknown capability is a coded 400", async () => {
  as(viewer.id);
  const res = await get("bogus");
  assert.equal(res.status, 400);
  const body = (await res.json()) as { code: string };
  assert.equal(body.code, "CAPABILITY_UNKNOWN");
  assert.equal((await GET(new Request("http://localhost/api/me/capability-holders"))).status, 400);
});

test("holders are capped at 5 and carry only name, email and role", async () => {
  const crowd = createWorkspace("Crowded team", ORG);
  for (let i = 0; i < 7; i++) {
    const u = mk(`crowd-${i}-h@example.com`, `Crowd ${i}`);
    upsertMembership(u.id, crowd.id, "admin");
  }
  const reader = mk("crowd-reader-h@example.com", "Crowd Reader");
  upsertMembership(reader.id, crowd.id, "viewer");
  as(reader.id, crowd.id);
  const res = await get("team:manage");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { holders: Array<Record<string, unknown>> };
  assert.equal(body.holders.length, 5);
  for (const h of body.holders) assert.deepEqual(Object.keys(h).sort(), ["email", "name", "role"]);
  assert.doesNotMatch(JSON.stringify(body), /usr-|overrides|workspaceId|teams/);
});
