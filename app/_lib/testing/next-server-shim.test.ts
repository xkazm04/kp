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
