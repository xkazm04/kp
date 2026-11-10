// The two faces of '/': proxy.ts rewrites an anonymous '/' to the landing's own route
// (root-surface.ts), and app/page.tsx re-asks hasEnteredWorkspace() (home-gate-server.ts).
// The two predicates must agree, or the page's not-entered redirect back to '/' would
// loop. These cases pin the edge twin to the node gate it mirrors.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

process.env.KP_SECRET ??= "root-surface-test-secret-0123456789";

const { LANDING_HOME_PATH, ROOT_ENTERED_COOKIE, rootServesLanding } = await import("./root-surface.ts");
const session = await import("./session.ts");
const { proxy } = await import("../../../proxy.ts");
// "next/server.js" with the extension, as app/shell-headers.test.ts explains.
const { NextRequest } = await import("next/server.js");

const base = {
  sim: null,
  passwordSet: false,
  sessionCookie: undefined,
  enteredCookie: undefined,
  secret: process.env.KP_SECRET,
  epoch: 0,
  now: Date.now(),
};

test("the edge twin's literals are session.ts's", () => {
  assert.equal(ROOT_ENTERED_COOKIE, session.ENTERED_COOKIE);
  const src = readFileSync(join(import.meta.dirname, "root-surface.ts"), "utf8");
  assert.match(src, new RegExp(`DEMO_WORKSPACE = "${session.DEMO_WORKSPACE}"`));
});

test("home-gate-server.ts still asks what the twin asks", () => {
  const src = readFileSync(join(import.meta.dirname, "home-gate-server.ts"), "utf8");
  assert.match(src, /process\.env\.KP_OPERATOR_PASSWORD/);
  assert.match(src, /verifySession\(jar\.get\(SESSION_COOKIE\)\?\.value\)/);
  assert.match(src, /currentWorkspaceId\(session\) !== DEMO_WORKSPACE/);
  assert.match(src, /jar\.get\(ENTERED_COOKIE\)\?\.value === "1"/);
});

test("open mode: the entry marker is the whole gate", async () => {
  assert.equal(await rootServesLanding(base), true);
  assert.equal(await rootServesLanding({ ...base, enteredCookie: "0" }), true);
  assert.equal(await rootServesLanding({ ...base, enteredCookie: "1" }), false);
});

test("?sim=auto always serves the workspace", async () => {
  assert.equal(await rootServesLanding({ ...base, sim: "auto" }), false);
  assert.equal(await rootServesLanding({ ...base, passwordSet: true, sim: "auto" }), false);
});

test("password mode agrees with session.ts verifySession on every session shape", async () => {
  const now = Date.now();
  const shapes: Array<[string, string | undefined, number]> = [
    ["none", undefined, now],
    ["forged", "abc.def", now],
    ["signed", session.signSession(session.DEFAULT_WORKSPACE, now), now],
    ["demo", session.signSession(session.DEMO_WORKSPACE, now), now],
    ["expired", session.signSession(session.DEFAULT_WORKSPACE, now - 30 * 24 * 3600 * 1000), now],
  ];
  for (const [name, cookie, at] of shapes) {
    const node = session.verifySession(cookie, at);
    const nodeEntered = node !== null && session.currentWorkspaceId(node) !== session.DEMO_WORKSPACE;
    const landing = await rootServesLanding({ ...base, passwordSet: true, sessionCookie: cookie, now: at });
    assert.equal(landing, !nodeEntered, `${name}: proxy and page agree`);
  }
  // The marker alone never opens the workspace in password mode (it is spoofable).
  assert.equal(await rootServesLanding({ ...base, passwordSet: true, enteredCookie: "1" }), true);
});

// ── through the real proxy (open dev mode) ──────────────────────────────────────
const call = (path: string, cookie?: string) =>
  proxy(new NextRequest(`https://kp.test${path}`, cookie ? { headers: { cookie } } : undefined));
const rewrittenTo = (res: Response) => {
  const to = res.headers.get("x-middleware-rewrite");
  return to ? new URL(to) : null;
};

test("an anonymous '/' is rewritten to the landing route, query intact, with the CSP", async () => {
  const saved = process.env.KP_OPERATOR_PASSWORD;
  delete process.env.KP_OPERATOR_PASSWORD;
  try {
    const res = await call("/?lang=cs&demo=unavailable");
    const to = rewrittenTo(res);
    assert.equal(to?.pathname, LANDING_HOME_PATH);
    assert.equal(to?.searchParams.get("demo"), "unavailable");
    assert.ok(res.headers.get("Content-Security-Policy-Report-Only"));
    // An entered operator, and the guided demo, reach app/page.tsx untouched.
    assert.equal(rewrittenTo(await call("/?tab=pipeline", "kp_entered=1")), null);
    assert.equal(rewrittenTo(await call("/?sim=auto")), null);
    // Only '/' is split: another page is never sent to the landing.
    assert.equal(rewrittenTo(await call("/about")), null);
  } finally {
    if (saved !== undefined) process.env.KP_OPERATOR_PASSWORD = saved;
  }
});

test("a direct hit on the landing route is redirected back to '/'", async () => {
  const res = await call(`${LANDING_HOME_PATH}?lang=de`);
  assert.equal(res.status, 307);
  const to = new URL(res.headers.get("location")!);
  assert.equal(to.pathname, "/");
  assert.equal(to.searchParams.get("lang"), "de");
});
