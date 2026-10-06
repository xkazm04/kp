// Source ratchet: no route under app/api/auth/ may decide authority from a cookie
// without asking whether that cookie is revoked.
//
// WHY THIS PREFIX SPECIFICALLY. `/api/auth/` is on the public allow-list
// (app/_lib/auth/public-routes.ts), so `proxy.ts` — the one seam that asks the
// revocation question for an already-minted cookie — never runs on these routes. A
// handler here is therefore the ONLY check in the path, and the record of what that
// costs is three separate findings in a row: `isHomeOrgReader()` (2026-10-05), the
// switch-workspace re-mint (2026-10-06), and its on-the-way-out decisions
// (scan f727beae). Each was the same omission at a new door. This file is so the
// next door cannot repeat it silently.
//
// It is a SOURCE scan, not a behaviour test: the behaviour tests live in
// session-revocation-enforcement.test.ts and can only cover doors that already exist.
// A ratchet covers the one nobody has written yet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const AUTH_ROUTES = path.join(ROOT, "app", "api", "auth");

/** Comments are prose, not code: a route that EXPLAINS the old defect, or names
 *  `isSessionRevoked` only in a `//` note, must not satisfy — nor trip — the scan. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

function* routeFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* routeFiles(full);
    else if (name === "route.ts" || name === "route.tsx") yield full;
  }
}

// Doors that verify a cookie WITHOUT consulting the revocation store, each with the
// reason it is sound and the token that keeps the reason true. An entry is not a
// waiver: if the named token disappears the exemption's premise is gone and the file
// is reported like any other.
//
//   logout — the only decision it makes from the cookie is WHOSE revocation to write.
//   That is a narrowing of authority, never a grant, and refusing an already-revoked
//   caller here would mean a second logout silently wrote nothing. It must still be
//   writing a revocation for that to hold.
const EXEMPT: Record<string, { why: string; mustStillDo: RegExp }> = {
  [path.join("logout", "route.ts")]: {
    why: "it only decides whose revocation to WRITE — a narrowing, never a grant",
    mustStillDo: /\brevoke(Session|AllSessions)\s*\(/,
  },
};

/** The pure half: given one file's relative path and source, what is wrong with it?
 *  Shared by the tree scan and the fixtures below, so the fixtures prove the same
 *  code that guards the tree. */
function findingFor(rel: string, source: string): string | null {
  const code = stripComments(source);
  if (!/\bverifySession\s*\(/.test(code)) return null; // not a cookie-authority door
  if (/\bisSessionRevoked\b/.test(code)) return null; // it asks
  const exempt = EXEMPT[rel];
  if (!exempt) return `${rel}: verifies a session but never consults isSessionRevoked`;
  if (!exempt.mustStillDo.test(code)) {
    return `${rel}: its exemption assumed "${exempt.why}" and that no longer shows in the source`;
  }
  return null;
}

test("every app/api/auth/ route that verifies a cookie also asks whether it is revoked", () => {
  const verifiers: string[] = [];
  const findings: string[] = [];
  for (const file of routeFiles(AUTH_ROUTES)) {
    const rel = path.relative(AUTH_ROUTES, file);
    const source = readFileSync(file, "utf8");
    if (/\bverifySession\s*\(/.test(stripComments(source))) verifiers.push(rel);
    const finding = findingFor(rel, source);
    if (finding) findings.push(finding);
  }

  // NON-VACUITY: a scan that visited nothing passes forever. Both known
  // cookie-verifying doors must be in the set, and switch-workspace must be the
  // GUARDED one — it is the route the 2026-10-06 findings were written about.
  assert.ok(verifiers.length >= 2, `the scan visited ${verifiers.length} verifying route(s) — it must see the real tree`);
  assert.ok(
    verifiers.includes(path.join("switch-workspace", "route.ts")),
    `the known guarded door must be in the set — found: ${verifiers.join(", ") || "(none)"}`,
  );
  assert.ok(verifiers.includes(path.join("logout", "route.ts")), "the known exempt door must be in the set too");

  assert.deepEqual(findings, [], "an /api/auth/ route decides authority from a cookie it never checked for revocation");
});

test("the ratchet bites on a mutated door (fixtures)", () => {
  const UNGUARDED = `
    import { SESSION_COOKIE, verifySession } from "@/app/_lib/auth/session";
    export async function POST() {
      const session = verifySession((await cookies()).get(SESSION_COOKIE)?.value);
      if (!session) return jsonError("UNAUTHENTICATED", 401);
      return NextResponse.json({ workspace: session.workspace });
    }`;
  const GUARDED = UNGUARDED.replace(
    "if (!session)",
    "if (isSessionRevoked(session)) return jsonError(\"UNAUTHENTICATED\", 401);\n      if (!session)",
  );

  const newDoor = path.join("rotate", "route.ts");
  assert.ok(findingFor(newDoor, UNGUARDED), "a NEW unguarded door must be reported");
  assert.equal(findingFor(newDoor, GUARDED), null, "…and the same door, guarded, must pass");

  // A comment is not a check: naming the helper in prose must not buy silence.
  assert.ok(
    findingFor(newDoor, `${UNGUARDED}\n    // TODO: call isSessionRevoked here`),
    "a comment mentioning isSessionRevoked must not satisfy the scan",
  );

  // A file that never verifies a cookie is not this ratchet's business (login, register).
  assert.equal(findingFor(newDoor, `export async function POST() { return NextResponse.json({ ok: true }); }`), null);

  // And the exemption is conditional: strip logout's revocation WRITE and its premise
  // is gone, so it is reported despite being listed.
  const logout = path.join("logout", "route.ts");
  assert.equal(findingFor(logout, `${UNGUARDED}\n    revokeSession(session, "logout");`), null);
  assert.ok(findingFor(logout, UNGUARDED), "a listed door that stopped writing a revocation loses its exemption");
});
