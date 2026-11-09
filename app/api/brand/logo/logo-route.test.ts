// The logo upload door: who may write, what is refused (with a CODE), and that a PNG
// round-trips through the PUBLIC GET with the security headers. Real handlers on a
// throwaway SQLite file; open mode unless a case sets KP_OPERATOR_PASSWORD.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const VIRTUAL_HEADERS = "kp-test:next-headers-brand-logo";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpLogoCookie?: () => string | null }).__kpLogoCookie = () => cookieValue;
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
            const value = globalThis.__kpLogoCookie();
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

after(() => {
  delete process.env.KP_TRUSTED_PROXY;
  cleanupUnitDb();
});

type Route = typeof import("./route.ts");
let route: Route | null = null;
async function handlers(): Promise<Route> {
  route ??= (await import("./route.ts")) as Route;
  return route;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#0057b8"/></svg>`;

let ip = 0;
function upload(body: BodyInit, method = "POST"): Request {
  return new Request("http://localhost/api/brand/logo", {
    method,
    headers: { "x-forwarded-for": `10.8.0.${++ip}` },
    body: method === "DELETE" ? undefined : body,
  });
}

beforeEach(() => {
  delete process.env.KP_OPERATOR_PASSWORD;
  process.env.KP_TRUSTED_PROXY = "1";
});

test("a PNG round-trips through the public GET with the security headers", async () => {
  const { POST, GET } = await handlers();
  const res = await POST(upload(PNG) as never);
  assert.equal(res.status, 200);
  const brand = (await res.json()) as { logoUrl: string };
  assert.match(brand.logoUrl, /^\/api\/brand\/logo\?v=[0-9a-f]{16}$/);

  const got = await GET(new Request("http://localhost" + brand.logoUrl) as never);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("content-type"), "image/png");
  assert.equal(got.headers.get("x-content-type-options"), "nosniff");
  assert.equal(got.headers.get("content-security-policy"), "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  assert.deepEqual(new Uint8Array(await got.arrayBuffer()), PNG);

  const etag = got.headers.get("etag");
  assert.ok(etag);
  const cached = await GET(new Request("http://localhost/api/brand/logo", { headers: { "if-none-match": etag } }) as never);
  assert.equal(cached.status, 304);
});

test("a clean SVG is stored and served as image/svg+xml", async () => {
  const { POST, GET } = await handlers();
  assert.equal((await POST(upload(SVG) as never)).status, 200);
  const got = await GET(new Request("http://localhost/api/brand/logo") as never);
  assert.equal(got.headers.get("content-type"), "image/svg+xml");
});

test("refuses an oversize file, measured on the bytes read, with a code", async () => {
  const { POST } = await handlers();
  const res = await POST(upload(new Uint8Array(512 * 1024 + 1)) as never);
  assert.equal(res.status, 413);
  const body = (await res.json()) as { code: string; maxBytes: number };
  assert.equal(body.code, "BRAND_LOGO_TOO_LARGE");
  assert.equal(body.maxBytes, 512 * 1024);
});

test("refuses the wrong type and an empty body with codes", async () => {
  const { POST } = await handlers();
  const wrong = await POST(upload("GIF89a not a logo") as never);
  assert.equal(wrong.status, 400);
  assert.equal(((await wrong.json()) as { code: string }).code, "BRAND_LOGO_TYPE");
  const empty = await POST(upload(new Uint8Array(0)) as never);
  assert.equal(((await empty.json()) as { code: string }).code, "BRAND_LOGO_EMPTY");
});

test("refuses a hostile SVG and stores nothing", async () => {
  const { POST, DELETE, GET } = await handlers();
  await DELETE(upload("", "DELETE") as never);
  const res = await POST(upload(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`) as never);
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { code: string }).code, "BRAND_LOGO_UNSAFE");
  assert.equal((await GET(new Request("http://localhost/api/brand/logo") as never)).status, 404);
});

test("DELETE clears the logo and the brand's logoUrl", async () => {
  const { POST, DELETE, GET } = await handlers();
  await POST(upload(PNG) as never);
  const res = await DELETE(upload("", "DELETE") as never);
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { logoUrl: string | null }).logoUrl, null);
  assert.equal((await GET(new Request("http://localhost/api/brand/logo") as never)).status, 404);
});

test("saving a different logo URL through PUT /api/brand drops the uploaded bytes", async () => {
  const { POST, GET } = await handlers();
  const { PUT } = await import("../route.ts");
  await POST(upload(PNG) as never);
  const put = await PUT(
    new Request("http://localhost/api/brand", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.8.1.${++ip}` },
      body: JSON.stringify({ logoUrl: "https://cdn.acme/l.png" }),
    }) as never
  );
  assert.equal(put.status, 200);
  assert.equal((await GET(new Request("http://localhost/api/brand/logo") as never)).status, 404);
});

test("no session is 401; a member without org:manage is a coded 403; an owner uploads", async () => {
  const { POST, DELETE } = await handlers();
  const { signSession, DEFAULT_WORKSPACE } = await import("../../../_lib/auth/session.ts");
  const { createUser } = await import("../../../_lib/db/users.ts");
  const { upsertMembership } = await import("../../../_lib/db/memberships.ts");
  process.env.KP_SECRET = "brand-logo-test-secret";
  process.env.KP_OPERATOR_PASSWORD = "brand-logo-test-password";
  try {
    cookieValue = null;
    assert.equal((await POST(upload(PNG) as never)).status, 401);
    assert.equal((await DELETE(upload("", "DELETE") as never)).status, 401);

    const rec = createUser({ orgId: "org-default", email: "rec-logo@example.com", name: "Rec", status: "active", password: "correct horse battery" });
    upsertMembership(rec.id, DEFAULT_WORKSPACE, "recruiter");
    cookieValue = signSession(DEFAULT_WORKSPACE, Date.now(), { sub: rec.id, org: "org-default", role: "recruiter" });
    const refused = await POST(upload(PNG) as never);
    assert.equal(refused.status, 403);
    assert.equal(((await refused.json()) as { code?: string }).code, "FORBIDDEN_CAPABILITY");
    assert.equal((await DELETE(upload("", "DELETE") as never)).status, 403);

    const own = createUser({ orgId: "org-default", email: "own-logo@example.com", name: "Own", status: "active", password: "another secret pass" });
    upsertMembership(own.id, DEFAULT_WORKSPACE, "owner");
    cookieValue = signSession(DEFAULT_WORKSPACE, Date.now(), { sub: own.id, org: "org-default", role: "owner" });
    assert.equal((await POST(upload(PNG) as never)).status, 200);
  } finally {
    delete process.env.KP_OPERATOR_PASSWORD;
    cookieValue = null;
  }
});
