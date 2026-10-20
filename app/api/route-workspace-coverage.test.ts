// RATCHET: every non-public route enters through the request-scoped chain.
// (ADR 0026-route-chain-refusal-order; app/_lib/auth/workspace-context.ts)
//
// A route used to open with `const ws = await currentWorkspace()` and decide for itself
// when to refuse, so a new route could skip the tenant, or the session check, in silence.
// Now every exported HTTP handler of a non-public `route.ts` must be
//
//     export const GET = withWorkspace(...)        // the handler receives `ws`
//     export const GET = withSession(...)          // a handler that needs no tenant
//     export const POST = route(guard, ...)(...)   // with rate-limit / meter guards
//
// and no route body may call `currentWorkspace()` itself. Public token routes (the 37 in
// public-api-surface-contract.test.ts) must NOT be wrapped: their authority is the
// capability link, and a session-first 401 would refuse the candidate.
//
// The exceptions are an ALLOWLIST, each with the reason it is acceptable, and the list is
// two-sided: an entry that has since been wrapped (or deleted) fails as stale, so the list
// can only shrink. A new route that is neither wrapped nor justified here fails CI.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import { isPublicPath } from "../_lib/auth/public-routes.ts";

const API_DIR = fileURLToPath(new URL(".", import.meta.url));
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const WRAPPERS = new Set(["withWorkspace", "withSession", "route"]);

/** Non-public routes that are NOT behind the chain, keyed by api-relative path. */
const ALLOWLIST = new Map<string, string>([
  [
    "agents/hire-from-need/route.ts",
    "machine door: authenticates by an automation token OR an operator session (checkAutomationToken). A session-first 401 would refuse every machine caller; its own tests pin the 503/401 split.",
  ],
  [
    "gigs/lessons/route.ts",
    "machine door: reuses hire-from-need's automation-token OR operator-session auth, same reason.",
  ],
  [
    "me/capabilities/route.ts",
    "answers a SIGNED-OUT caller with the empty capability set by contract (the shell must always render); a session-first 401 would break the locked-nav render.",
  ],
]);

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) routeFiles(p, out);
    else if (name === "route.ts") out.push(p);
  }
  return out;
}
const relOf = (f: string) => path.relative(API_DIR, f).split(path.sep).join("/");
const urlOf = (rel: string) => "/api/" + rel.replace(/\/?route\.ts$/, "");

export type RouteFinding = { unwrapped: string[]; resolverCalls: number; usesWrapper: boolean };

/** What one route source does about the chain. Comments never count (AST, not text). */
export function inspectRoute(src: string): RouteFinding {
  const sf = ts.createSourceFile("route.ts", src, ts.ScriptTarget.Latest, true);
  const unwrapped: string[] = [];
  let usesWrapper = false;
  for (const st of sf.statements) {
    // `export async function GET` / `export function GET`: the unwrapped shape.
    if (ts.isFunctionDeclaration(st) && st.name && METHODS.includes(st.name.text) && st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      unwrapped.push(st.name.text);
      continue;
    }
    if (!ts.isVariableStatement(st) || !st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !METHODS.includes(d.name.text)) continue;
      // The callee of the outermost call: `withWorkspace(...)` or `route(...)(...)`.
      let callee: ts.Expression | undefined = d.initializer && ts.isCallExpression(d.initializer) ? d.initializer.expression : undefined;
      if (callee && ts.isCallExpression(callee)) callee = callee.expression;
      if (callee && ts.isIdentifier(callee) && WRAPPERS.has(callee.text)) usesWrapper = true;
      else unwrapped.push(d.name.text);
    }
  }
  let resolverCalls = 0;
  (function walk(n: ts.Node) {
    if (ts.isImportDeclaration(n)) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "currentWorkspace") resolverCalls++;
    ts.forEachChild(n, walk);
  })(sf);
  return { unwrapped, resolverCalls, usesWrapper };
}

const FILES = routeFiles(API_DIR).map((f) => ({ rel: relOf(f), src: readFileSync(f, "utf8") }));
const NON_PUBLIC = FILES.filter((f) => !isPublicPath(urlOf(f.rel)));
const PUBLIC = FILES.filter((f) => isPublicPath(urlOf(f.rel)));

test("the walk sees the tree (a walk that finds nothing would pass vacuously)", () => {
  assert.ok(FILES.length >= 280, `walked only ${FILES.length} route files`);
  assert.equal(PUBLIC.length, 37, "the public surface is pinned by public-api-surface-contract.test.ts");
  assert.ok(NON_PUBLIC.filter((f) => inspectRoute(f.src).usesWrapper).length >= 250, "the migration put most routes behind the chain");
});

test("every non-public route handler is behind withWorkspace / withSession / route(...)", () => {
  const offenders: string[] = [];
  for (const { rel, src } of NON_PUBLIC) {
    if (ALLOWLIST.has(rel)) continue;
    const r = inspectRoute(src);
    if (r.unwrapped.length) offenders.push(`${rel}  [${r.unwrapped.join(", ")}] not wrapped`);
    if (r.resolverCalls) offenders.push(`${rel}  calls currentWorkspace() itself (${r.resolverCalls}x)`);
  }
  assert.deepEqual(
    offenders.sort(),
    [],
    `These routes bypass the request-scoped chain:\n  ${offenders.join("\n  ")}\n\n` +
      `Wrap each handler: export const GET = withWorkspace(async (ws: string, request: Request) => { ... }).\n` +
      `A handler that needs no tenant takes withSession. If a door genuinely cannot take the session-first 401\n` +
      `(a token-authenticated machine door), add it to ALLOWLIST WITH THE REASON.`,
  );
});

test("the allowlist only shrinks: every entry exists and is still an exception", () => {
  const byRel = new Map(NON_PUBLIC.map((f) => [f.rel, f]));
  for (const [rel, reason] of ALLOWLIST) {
    const f = byRel.get(rel);
    assert.ok(f, `ALLOWLIST row "${rel}" matches no non-public route - delete it`);
    assert.ok(reason.length > 40, `ALLOWLIST row "${rel}" needs a real reason`);
    const r = inspectRoute(f.src);
    assert.ok(r.unwrapped.length > 0 || r.resolverCalls > 0, `ALLOWLIST row "${rel}" is now behind the chain - delete it`);
  }
});

test("public routes are NOT wrapped (a capability link is not a session)", () => {
  const wrapped = PUBLIC.filter((f) => inspectRoute(f.src).usesWrapper || /workspace-context/.test(f.src.replace(/\/\/.*$/gm, ""))).map((f) => f.rel);
  assert.deepEqual(wrapped, [], "a session-first 401 would refuse the candidate / webhook caller on these");
});

test("inspectRoute recognises each shape (the ratchet's own detector is not vacuous)", () => {
  assert.deepEqual(inspectRoute("export async function GET() { return null; }").unwrapped, ["GET"]);
  assert.deepEqual(inspectRoute("export function POST() { return null; }").unwrapped, ["POST"]);
  assert.deepEqual(inspectRoute("export const PUT = async () => null;").unwrapped, ["PUT"]);
  const wrapped = inspectRoute('export const GET = withWorkspace(async (ws: string) => null);\nexport const POST = route(withRateLimit({}))(async (ws: string) => null);\nexport const DELETE = withSession(async () => null);');
  assert.deepEqual(wrapped.unwrapped, []);
  assert.equal(wrapped.usesWrapper, true);
  // A mention in a comment or a string is not a call; an import is not a call.
  assert.equal(inspectRoute('import { currentWorkspace } from "x";\n// currentWorkspace() in prose\nconst s = "currentWorkspace()";').resolverCalls, 0);
  assert.equal(inspectRoute("export const GET = withWorkspace(async () => { const ws = await currentWorkspace(); });").resolverCalls, 1);
  // Not a wrapper: a handler that merely calls some other function.
  assert.deepEqual(inspectRoute("export const GET = somethingElse(async () => null);").unwrapped, ["GET"]);
});
