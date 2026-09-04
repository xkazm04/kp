// A minimal `next/server` stand-in for HANDLER-LEVEL unit tests.
//
// WHY THIS EXISTS: in a junction-linked git worktree, `next/server` resolves through two
// module identities under the test loader and every named export comes back `undefined` —
// `new NextRequest(...)` throws "NextRequest is not a constructor" and `NextResponse.json`
// blows up inside `jsonOk`. That is an environment artifact of the worktree, not a product
// bug (the same tests pass in a normal checkout), but it makes route handlers untestable
// exactly where the interesting server logic lives.
//
// The surface below is the whole of what kp's route handlers use, implemented on the
// platform primitives the handlers already treat them as. Never import it from app code.
//
// TWO WAYS IN, and you usually need neither:
//   * scripts/test-alias-loader.mjs redirects `next/server` here for the WHOLE
//     `npm run test:unit` run — but only when `node_modules` is a junction/symlink, i.e.
//     only in the linked worktree where the real module is already broken. A normal
//     checkout and CI keep loading the real `next/server`, so a plain
//     `import { POST } from "./route.ts"` now works in both. That is the default path.
//   * next-server-hooks.mjs registers the same redirect from inside a single test, for
//     tests that want the shim unconditionally (including in a normal checkout). Those
//     must load the route with `await import(...)`, because hooks only affect later
//     resolutions.
// Keep this surface in step with what app code actually imports from `next/server`
// (today: NextRequest, NextResponse, after, connection) — an ESM import of a name this
// file does not export is a link-time SyntaxError, not a failed assertion.
// `NextRequest` is NOT a bare `Request`: handlers read `request.nextUrl` (26 sites,
// e.g. app/api/comms/route.ts and app/api/decisions/group-eval/route.ts) and proxy.ts
// reads `req.cookies` and calls `nextUrl.clone()`. A shim that stopped at `extends
// Request` left `nextUrl` undefined, so every one of those handlers threw inside its own
// try/catch and answered 500 — which reads in a test like a product bug and is exactly
// why decisions-auth.test.ts and pipeline-routes.test.ts were written off as
// "known worktree-only failures" for thirty waves. The export-name coverage test could
// not see it: a missing PROPERTY is a runtime undefined, not a link-time SyntaxError.
// next-server-shim.test.ts now scans the request PROPERTY surface too.

/** `nextUrl` is a URL with `.clone()` (proxy.ts rewrites it). */
class ShimNextURL extends URL {
  clone() {
    return new ShimNextURL(this.href);
  }
}

/** Reader/writer over the request's own `cookie` header, matching the members
 *  proxy.ts uses: `.get(name)?.value` and `.set(name, value)` (which rewrites the
 *  header, so a downstream clone of the request carries the new value). */
function requestCookies(headers) {
  const parse = () => {
    const raw = headers.get("cookie") ?? "";
    const out = new Map();
    for (const part of raw.split(";")) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      const name = part.slice(0, eq).trim();
      if (name) out.set(name, part.slice(eq + 1).trim());
    }
    return out;
  };
  const write = (jar) => {
    const serialized = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
    if (serialized) headers.set("cookie", serialized);
    else headers.delete("cookie");
  };
  return {
    get(name) {
      const key = typeof name === "object" && name !== null ? name.name : name;
      const jar = parse();
      return jar.has(key) ? { name: key, value: jar.get(key) } : undefined;
    },
    getAll() {
      return [...parse()].map(([name, value]) => ({ name, value }));
    },
    has(name) {
      return parse().has(name);
    },
    set(name, value) {
      const jar = parse();
      if (typeof name === "object" && name !== null) jar.set(name.name, name.value);
      else jar.set(name, value);
      write(jar);
      return this;
    },
    delete(name) {
      const jar = parse();
      const existed = jar.delete(typeof name === "object" && name !== null ? name.name : name);
      write(jar);
      return existed;
    },
  };
}

export class NextRequest extends Request {
  #nextUrl;
  #cookies;

  get nextUrl() {
    this.#nextUrl ??= new ShimNextURL(this.url);
    return this.#nextUrl;
  }

  get cookies() {
    this.#cookies ??= requestCookies(this.headers);
    return this.#cookies;
  }
}

// `NextResponse` carries a `cookies` writer that plain `Response` does not, and
// handlers that re-mint the session (auth/switch-workspace, login, logout) call it
// straight after `NextResponse.json(...)`. Without it those handlers throw inside
// their own try/catch and answer 500, which reads in a test like a product failure.
// Minimal, header-level implementation: enough to assert that a cookie was set and
// with what value.
function withCookies(response) {
  const serialize = (name, value, opts = {}) => {
    const parts = [`${name}=${value}`];
    if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
    if (opts.path) parts.push(`Path=${opts.path}`);
    if (opts.expires) parts.push(`Expires=${new Date(opts.expires).toUTCString()}`);
    if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
    if (opts.httpOnly) parts.push("HttpOnly");
    if (opts.secure) parts.push("Secure");
    return parts.join("; ");
  };
  response.cookies = {
    set(name, value, opts) {
      // Object form: cookies.set({ name, value, ...opts })
      if (typeof name === "object" && name !== null) {
        const { name: n, value: v, ...rest } = name;
        response.headers.append("set-cookie", serialize(n, v, rest));
      } else {
        response.headers.append("set-cookie", serialize(name, value, opts));
      }
      return response.cookies;
    },
    delete(name) {
      response.headers.append("set-cookie", serialize(typeof name === "object" ? name.name : name, "", { maxAge: 0, path: "/" }));
      return response.cookies;
    },
    get(name) {
      const raw = response.headers.get("set-cookie") ?? "";
      const hit = raw.split(/,\s*(?=[^;=]+=)/).find((c) => c.startsWith(`${name}=`));
      return hit ? { name, value: hit.slice(name.length + 1).split(";")[0] } : undefined;
    },
  };
  return response;
}

export const NextResponse = {
  json(body, init = {}) {
    return withCookies(
      new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      })
    );
  },
  redirect(url, status = 307) {
    return withCookies(new Response(null, { status, headers: { location: String(url) } }));
  },
  next() {
    return withCookies(new Response(null, { status: 200 }));
  },
};

export const after = (fn) => {
  if (typeof fn === "function") fn();
};

// The request-time marker the session readers call before reading the wall clock
// (see currentSession in app/_lib/auth/current-user.ts). Outside a Next render
// there is no prerender to opt out of, so it is a no-op — but it MUST exist as a
// named export: an ESM import of a missing name is a link-time SyntaxError, so a
// handler that transitively imports requireOperator/currentWorkspace would fail to
// load at all rather than fail an assertion.
export const connection = async () => {};

export const userAgent = () => ({});
export const userAgentFromString = () => ({});
