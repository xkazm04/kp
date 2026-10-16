// withWorkspace / route(...) — the request-scoped workspace entry and its guard chain
// (ADR draft-route-chain-refusal-order). TENANT ISOLATION: review any change here.
//
// What is pinned:
//   1. a session is required in password mode, and the refusal is the FIRST one (401
//      before any guard or handler runs);
//   2. the workspace the handler gets is the session's own — a header, a query string
//      or a body field naming another team never steers it (cross-workspace refusal);
//   3. open mode resolves the default workspace; a demo cookie resolves "demo";
//   4. guards run in the order written, and a refusing guard stops the chain;
//   5. through a REAL migrated route, workspace A's cookie cannot read workspace B's rows.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
//   node scripts/run-unit-tests.mjs "app/_lib/auth/workspace-context.test.ts"
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import type { NextRequest } from "next/server";
import { cleanupUnitDb } from "../testing/unit-db.ts";

register(new URL("../testing/next-server-hooks.mjs", import.meta.url));

const VIRTUAL_HEADERS = "kp-test:next-headers-workspace-context";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpWsCtxCookie?: () => string | null }).__kpWsCtxCookie = () => cookieValue;
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
            const value = globalThis.__kpWsCtxCookie();
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

process.env.KP_SECRET = "workspace-context-test-secret";
process.env.KP_TRUSTED_PROXY = "1";

const { NextResponse } = await import("next/server");
const { route, withWorkspace, withSession } = await import("./workspace-context.ts");
const { withRateLimit, withMeterGate } = await import("./route-guards.ts");
const { signSession, DEFAULT_WORKSPACE, DEMO_WORKSPACE } = await import("./session.ts");
const { saveAnalysis } = await import("../db/analyses.ts");
const { createUser } = await import("../db/users.ts");
const { upsertMembership } = await import("../db/memberships.ts");

after(() => cleanupUnitDb());
beforeEach(() => {
  cookieValue = null;
  delete process.env.KP_OPERATOR_PASSWORD;
});

const WS_A = DEFAULT_WORKSPACE;
const WS_B = "team-wsctx-b";
const req = (url = "http://localhost/api/x", init?: RequestInit) => new Request(url, init);

test("password mode, no cookie: 401 and the handler never runs", async () => {
  process.env.KP_OPERATOR_PASSWORD = "pw";
  let ran = false;
  const GET = withWorkspace(async (ws: string) => {
    ran = true;
    return NextResponse.json({ ws });
  });
  const res = await GET();
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "Unauthorized" });
  assert.equal(ran, false);
});

test("password mode, forged cookie: 401", async () => {
  process.env.KP_OPERATOR_PASSWORD = "pw";
  cookieValue = "not.a-signed-session";
  const GET = withWorkspace(async (ws: string) => NextResponse.json({ ws }));
  assert.equal((await GET()).status, 401);
});

test("the handler gets the SESSION's workspace, never one named by the request", async () => {
  process.env.KP_OPERATOR_PASSWORD = "pw";
  const GET = withWorkspace(async (ws: string, request: Request) => NextResponse.json({ ws, url: request.url }));
  cookieValue = signSession(WS_B);
  // Every channel a caller controls names workspace A; the cookie says B.
  const res = await GET(
    req(`http://localhost/api/x?ws=${WS_A}&workspace=${WS_A}&workspaceId=${WS_A}`, {
      method: "POST",
      headers: { "x-workspace": WS_A, "x-workspace-id": WS_A },
      body: JSON.stringify({ ws: WS_A, workspaceId: WS_A }),
    }),
  );
  assert.equal(((await res.json()) as { ws: string }).ws, WS_B);
  cookieValue = signSession(WS_A);
  assert.equal(((await (await GET(req())).json()) as { ws: string }).ws, WS_A);
});

test("open mode resolves the default workspace; a demo cookie resolves the demo workspace", async () => {
  const GET = withWorkspace(async (ws: string) => NextResponse.json({ ws }));
  assert.deepEqual(await (await GET()).json(), { ws: DEFAULT_WORKSPACE });
  process.env.KP_OPERATOR_PASSWORD = "pw";
  cookieValue = signSession(DEMO_WORKSPACE);
  assert.deepEqual(await (await GET()).json(), { ws: DEMO_WORKSPACE });
});

test("withSession: the same 401, and the handler's own arguments with no workspace in front", async () => {
  process.env.KP_OPERATOR_PASSWORD = "pw";
  const GET = withSession(async (request: Request) => NextResponse.json({ url: request.url }));
  assert.equal((await GET(req())).status, 401);
  cookieValue = signSession(WS_A);
  assert.deepEqual(await (await GET(req("http://localhost/api/s"))).json(), { url: "http://localhost/api/s" });
});

test("handler arguments pass through untouched: (request, { params })", async () => {
  const GET = withWorkspace(async (ws: string, request: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    return NextResponse.json({ ws, id, url: request.url });
  });
  const res = await GET(req("http://localhost/api/x/7"), { params: Promise.resolve({ id: "7" }) });
  assert.deepEqual(await res.json(), { ws: DEFAULT_WORKSPACE, id: "7", url: "http://localhost/api/x/7" });
});

test("refusal order: session (401) -> guards in written order (429) -> handler", async () => {
  process.env.KP_OPERATOR_PASSWORD = "pw";
  const order: string[] = [];
  const probe = (name: string, refuse: boolean) => (<A extends unknown[]>(next: (ws: string, ...a: A) => Response | Promise<Response>) =>
    async (ws: string, ...args: A) => {
      order.push(name);
      return refuse ? NextResponse.json({ refused: name }, { status: 418 }) : next(ws, ...args);
    }) as never;
  const POST = route(probe("first", false), probe("second", true), probe("third", false))(async (ws: string, request: Request) => {
    order.push("handler");
    return NextResponse.json({ ws, url: request.url });
  });

  // No session: not even the first guard is consulted.
  const unauth = await POST(req());
  assert.equal(unauth.status, 401);
  assert.deepEqual(order, []);

  cookieValue = signSession(WS_A);
  const refused = await POST(req());
  assert.equal(refused.status, 418);
  assert.deepEqual(order, ["first", "second"]); // third and the handler never ran
});

test("withRateLimit refuses with the coded 429 after N hits, per key, before the handler", async () => {
  let calls = 0;
  const POST = route(
    withRateLimit({ key: ({ ws, request }) => `wsctx-test:${ws}:${request.headers.get("x-forwarded-for")}`, limit: 2, windowMs: 60_000 }),
  )(async (ws: string, request: Request) => {
    calls++;
    return NextResponse.json({ ws, ip: request.headers.get("x-forwarded-for") });
  });
  const from = (ip: string) => req("http://localhost/api/x", { method: "POST", headers: { "x-forwarded-for": ip } });
  assert.equal((await POST(from("1.1.1.1"))).status, 200);
  assert.equal((await POST(from("1.1.1.1"))).status, 200);
  const third = await POST(from("1.1.1.1"));
  assert.equal(third.status, 429);
  assert.equal(((await third.json()) as { code: string }).code, "TOO_MANY_REQUESTS");
  assert.equal(calls, 2);
  assert.equal((await POST(from("2.2.2.2"))).status, 200); // another client has its own window
});

test("withRateLimit({ retryAfter }) says when to come back", async () => {
  const POST = route(withRateLimit({ key: () => "wsctx-retry:k", limit: 1, windowMs: 60_000, retryAfter: true }))(async (ws: string, request: Request) =>
    NextResponse.json({ ws, url: request.url }),
  );
  assert.equal((await POST(req())).status, 200);
  const res = await POST(req());
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get("Retry-After")) >= 1);
});

test("withMeterGate: an allowance-free meter passes on a self-hosted install (no billing state)", async () => {
  const POST = route(withMeterGate("ai_candidates"))(async (ws: string, request: Request) =>
    NextResponse.json({ ws, url: request.url }),
  );
  const res = await POST(req());
  // Either the plan funds the action (200) or the registered 402 comes back with the
  // meter as data; it is never a thrown error and never a different status.
  assert.ok(res.status === 200 || res.status === 402);
  if (res.status === 402) {
    const body = (await res.json()) as { code: string; meter: string };
    assert.equal(body.code, "BILLING_QUOTA_EXCEEDED");
    assert.equal(body.meter, "ai_candidates");
  }
});

// ---- the cross-workspace proof through a real, migrated route --------------------------

test("a REAL route behind the wrapper: workspace A's cookie cannot read workspace B's rows", async () => {
  process.env.KP_OPERATOR_PASSWORD = "pw";
  const ORG = "org-wsctx";
  const u = createUser({ orgId: ORG, email: "ws.ctx@csas.cz", name: "Ws Ctx", status: "active", password: "wsctx-pw-123456" });
  upsertMembership(u.id, WS_A, "recruiter");
  upsertMembership(u.id, WS_B, "recruiter");

  const { GET: getPrior } = await import("../../api/analyze/prior/route.ts");
  const cvA = "a".repeat(64);
  const cvB = "b".repeat(64);
  const seed = (cv: string, label: string, ws: string) =>
    saveAnalysis({ candidateLabel: label, jdSlug: "backend-dev", score: 70, roleFamily: "engineering", seniority: "mid", payload: {}, cvHash: cv }, ws);
  const sA = seed(cvA, "Only in A", WS_A);
  const sB = seed(cvB, "Only in B", WS_B);
  const get = () => getPrior(new Request(`http://localhost/api/analyze/prior?cv=${cvA}&cv=${cvB}&jd=backend-dev`) as unknown as NextRequest);
  const slugs = async () => ((await (await get()).json()) as { rows: { slug: string }[] }).rows.map((r) => r.slug);

  cookieValue = signSession(WS_A, Date.now(), { sub: u.id, org: ORG });
  assert.deepEqual(await slugs(), [sA.slug]);
  cookieValue = signSession(WS_B, Date.now(), { sub: u.id, org: ORG });
  assert.deepEqual(await slugs(), [sB.slug]);
  cookieValue = null;
  assert.equal((await get()).status, 401);
});
