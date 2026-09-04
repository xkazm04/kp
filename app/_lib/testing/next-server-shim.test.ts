// The shim's export surface must cover everything app code imports from `next/server`.
//
// WHY THIS TEST EXISTS: in a linked checkout (a git worktree whose `node_modules` is a
// junction back to the primary clone) scripts/test-alias-loader.mjs resolves
// `next/server` to ./next-server-shim.mjs for the whole `npm run test:unit` run, because
// the real module's named exports all come back `undefined` there. A substitution like
// that is only safe while it is COMPLETE: an ESM import of a name the shim does not
// export is a link-time SyntaxError, so the first route to start using, say,
// `NextResponse.rewrite` or `ImageResponse` would not fail an assertion — it would make
// every test that transitively imports that route fail to load at all, in the worktree
// only, with an error that names the shim rather than the change that caused it.
//
// So this test reads the tree instead of trusting the comment: every value imported from
// `next/server` anywhere in app/ (plus proxy.ts) must be a live export of the shim. It
// runs in a normal checkout too, where the shim is otherwise dormant — which is the point,
// since that is where the import that would break the worktree gets written.
//
// Runner: Node's built-in test runner with type stripping. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// Loaded by URL, not by a literal specifier: tsconfig sets `allowJs: false`, so a
// `from "./next-server-shim.mjs"` would be a `tsc` error even though Node resolves it
// fine. Same reason next-server-hooks.mjs is registered by URL rather than imported.
const SHIM_URL = new URL("./next-server-shim.mjs", import.meta.url).href;
const loadShim = (): Promise<Record<string, unknown>> => import(SHIM_URL);

// Where a `from "next/server"` may legitimately appear. proxy.ts is listed explicitly
// because it is the one server entry point outside app/ that imports the module.
const SCAN_DIRS = [path.join(REPO_ROOT, "app")];
const SCAN_FILES = [path.join(REPO_ROOT, "proxy.ts")];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      yield* sourceFiles(full);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      yield full;
    }
  }
}

/** Every `{ … }` clause imported from "next/server", flattened to bare names. */
function importedNames(): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  const files = [
    ...SCAN_DIRS.flatMap((dir) => [...sourceFiles(dir)]),
    ...SCAN_FILES.filter((file) => {
      try {
        return statSync(file).isFile();
      } catch {
        return false;
      }
    }),
  ];
  // Deliberately not a full parser: the repo writes these imports on one line. A pattern
  // that stopped matching would under-report silently, so the test asserts the two names
  // it KNOWS are in the tree before trusting the result.
  const clause = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']next\/server["']/g;
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(clause)) {
      for (const raw of match[1].split(",")) {
        // `type NextRequest` (inline type import) and `X as Y` both reduce to the
        // imported name, which is what has to exist on the shim.
        const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
        if (!name) continue;
        const seen = byName.get(name) ?? [];
        seen.push(path.relative(REPO_ROOT, file));
        byName.set(name, seen);
      }
    }
  }
  return byName;
}

test("the shim exports every name app code imports from next/server", async () => {
  const shim = await loadShim();
  const names = importedNames();

  // A scan that found nothing would pass vacuously; the app has route handlers, so it
  // must find at least the two core names.
  assert.ok(names.has("NextResponse"), "scan found no NextResponse import — pattern is stale");
  assert.ok(names.has("NextRequest"), "scan found no NextRequest import — pattern is stale");

  const missing = [...names.entries()]
    .filter(([name]) => !(name in shim))
    .map(([name, files]) => `${name} (first used in ${files[0]})`);

  assert.deepEqual(
    missing,
    [],
    "app code imports names next-server-shim.mjs does not export. Add them to the shim — " +
      "in a linked checkout the shim IS next/server for the whole unit suite, and a missing " +
      "name is a load-time SyntaxError rather than a failed assertion."
  );
});

test("the shim's NextResponse.json answers like the real one", async () => {
  const NextResponse = (await loadShim()).NextResponse as {
    json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => Response & {
      cookies: {
        set: (name: string, value: string, opts?: Record<string, unknown>) => unknown;
        get: (name: string) => { name: string; value: string } | undefined;
      };
    };
  };

  const ok = NextResponse.json({ hello: "world" });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "application/json");
  assert.deepEqual(await ok.json(), { hello: "world" });

  const created = NextResponse.json({ id: 1 }, { status: 201, headers: { "x-kp": "1" } });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("x-kp"), "1");

  // Handlers that re-mint the session call .cookies straight after .json().
  const withCookie = NextResponse.json({ ok: true });
  withCookie.cookies.set("kp_session", "abc", { path: "/", httpOnly: true });
  assert.equal(withCookie.cookies.get("kp_session")?.value, "abc");
});

// ---------------------------------------------------------------------------
// The PROPERTY surface. Export names are only half the contract: `NextRequest`
// was `class NextRequest extends Request {}` for thirty waves, so `request.nextUrl`
// — read by 26 handlers — was `undefined`, every one of them threw inside its own
// try/catch and answered 500, and two route tests were written off as "known
// worktree-only failures". A missing property is a runtime undefined, not a
// link-time SyntaxError, so the export scan above cannot see it. This scan reads
// the members the tree actually touches on its request object and asserts each one
// resolves on a shim instance.

/** Comment- and string-stripped source, so a path in prose (app/api/foo/route.ts)
 *  is not mistaken for a `request.ts` member read. */
function code(source: string): string {
  const BLOCK_COMMENT = new RegExp("/\\*[\\s\\S]*?\\*/", "g");
  const LINE_COMMENT = new RegExp("(^|[^:])//[^\\n]*", "gm");
  const TEMPLATE = new RegExp("`(?:\\\\.|[^`\\\\])*`", "g");
  const SINGLE = new RegExp("'(?:\\\\.|[^'\\\\\\n])*'", "g");
  const DOUBLE = new RegExp('"(?:\\\\.|[^"\\\\\\n])*"', "g");
  return source
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1 ")
    .replace(TEMPLATE, '""')
    .replace(SINGLE, '""')
    .replace(DOUBLE, '""');
}

/** Every member read off a request-shaped parameter in a route handler or proxy.ts. */
function requestMembers(): Map<string, string[]> {
  const byMember = new Map<string, string[]>();
  const files = [
    ...SCAN_DIRS.flatMap((dir) => [...sourceFiles(dir)]).filter(
      (file) => path.basename(file) === "route.ts"
    ),
    ...SCAN_FILES.filter((file) => {
      try {
        return statSync(file).isFile();
      } catch {
        return false;
      }
    }),
  ];
  const member = new RegExp("\\b(?:request|req)\\.([A-Za-z_$][\\w$]*)", "g");
  for (const file of files) {
    for (const match of code(readFileSync(file, "utf8")).matchAll(member)) {
      const seen = byMember.get(match[1]) ?? [];
      seen.push(path.relative(REPO_ROOT, file));
      byMember.set(match[1], seen);
    }
  }
  return byMember;
}

test("the shim's NextRequest carries every member route handlers read off the request", async () => {
  const { NextRequest } = (await loadShim()) as unknown as {
    NextRequest: new (url: string) => object;
  };
  const probe = new NextRequest("http://localhost/api/probe?entry=e1");
  const members = requestMembers();

  // A scan that found nothing would pass vacuously. `nextUrl` is the member whose
  // absence caused the 500s, so it is the canary: if this assertion ever fails the
  // pattern went stale, not the tree.
  assert.ok(members.has("nextUrl"), "scan found no request.nextUrl read — pattern is stale");
  assert.ok(members.has("json"), "scan found no request.json read — pattern is stale");

  const missing = [...members.entries()]
    .filter(([name]) => !(name in probe))
    .map(([name, files]) => `${name} (first read in ${files[0]})`);

  assert.deepEqual(
    missing,
    [],
    "route handlers read members next-server-shim.mjs's NextRequest does not carry. " +
      "In a linked checkout the shim IS next/server for the whole unit suite, so a missing " +
      "member is an `undefined` that surfaces as a 500 from the handler's own catch — a " +
      "product bug that is not one."
  );
});

test("the shim's nextUrl and cookies behave the way handlers and proxy.ts use them", async () => {
  const { NextRequest } = (await loadShim()) as unknown as {
    NextRequest: new (
      url: string,
      init?: { headers?: Record<string, string> }
    ) => {
      url: string;
      headers: Headers;
      nextUrl: URL & { clone: () => URL };
      cookies: {
        get: (name: string) => { name: string; value: string } | undefined;
        set: (name: string, value: string) => unknown;
      };
    };
  };

  // Handlers: request.nextUrl.searchParams.get(...) — app/api/comms/route.ts:19.
  const req = new NextRequest("http://localhost/api/comms?entry=e1&status=queued", {
    headers: { cookie: "kp_session=abc; kp_locale=en" },
  });
  assert.equal(req.nextUrl.searchParams.get("entry"), "e1");
  assert.equal(req.nextUrl.pathname, "/api/comms");

  // proxy.ts:144 — nextUrl.clone() must give an independently mutable URL.
  const cloned = req.nextUrl.clone();
  cloned.pathname = "/landing";
  assert.equal(cloned.pathname, "/landing");
  assert.equal(req.nextUrl.pathname, "/api/comms", "clone() must not alias the original");

  // proxy.ts:150,172,176 — read the session/locale cookie, then rewrite one.
  assert.equal(req.cookies.get("kp_session")?.value, "abc");
  assert.equal(req.cookies.get("nope"), undefined);
  req.cookies.set("kp_locale", "cs");
  assert.equal(req.cookies.get("kp_locale")?.value, "cs");
  assert.match(req.headers.get("cookie") ?? "", /kp_locale=cs/);

  // A NextRequest is still a Request: the members handlers use most must survive.
  for (const name of ["json", "headers", "url", "signal", "text", "formData", "method"]) {
    assert.ok(name in req, `NextRequest lost the plain-Request member ${name}`);
  }
});
