// Test-only module-resolution hook for `node --test` (registered via --import in
// the package.json `test:unit` script — see that script; production builds never
// load this file).
//
// Node's ESM loader (with built-in type stripping) can run .ts test files, but it
// resolves import specifiers by the strict ESM rules: no extension guessing and no
// tsconfig path aliases. The app's source modules use both TS conveniences —
// extensionless relative imports (`from "./db-path"`) and the `@/` root alias
// (`from "@/app/_lib/api-response"`) — which is the ONLY reason store/route modules
// were "not unit-loadable". This hook fills exactly that gap, in-process, test-only:
//
//   1. `@/x`  →  <repo root>/x        (mirrors tsconfig.json `paths: {"@/*": ["./*"]}`)
//   2. a relative specifier the default resolver misses → retry with the TS
//      extension/index candidates (.ts, .tsx, …, /index.ts, …)
//   3. a bare package subpath the default resolver misses (a package without an
//      `exports` map, e.g. `next/server`) → retry inside node_modules with the
//      same extension candidates
//   4. a resolved `.json` module gets `importAttributes: { type: "json" }`, since
//      TS `resolveJsonModule` imports don't carry the attribute Node requires
//   5. `next/server` is redirected to app/_lib/testing/next-server-shim.mjs, but ONLY
//      in a LINKED checkout (see LINKED_CHECKOUT below) — never in a normal one
//
// Everything else (bare packages, node: builtins, exact-path imports) goes through
// the default resolver untouched. Uses the synchronous `registerHooks` API so the
// hook runs in-thread — no worker, no impact on test parallelism. `node --test`
// child processes inherit the --import flag via execArgv, so every test file gets it.
import { registerHooks } from "node:module";
import { lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs"];

// --- next/server in a linked checkout ------------------------------------------------
//
// A git worktree created by an agent lane gets its `node_modules` as a junction (Windows)
// or a symlink (POSIX) back to the primary checkout. `next/server` then resolves through
// two module identities under this loader and EVERY named export comes back `undefined`:
// `NextResponse.json(...)` throws "Cannot read properties of undefined (reading 'json')"
// inside the handler, so any test that imports a route module fails for a reason that has
// nothing to do with the code under test. app/_lib/testing/next-server-shim.mjs was
// written for exactly this and 15 handler tests already register it by hand via
// next-server-hooks.mjs — but only tests that remembered to, and only those that load the
// route with `await import(...)`. A test with a plain `import { POST } from "./route.ts"`
// (the majority) cannot register hooks late enough to matter, so it simply breaks.
//
// Applying the same substitution from here closes that gap for every test at once. The
// gate is deliberately the linked-checkout condition and nothing else:
//
//   * In a NORMAL checkout — every developer machine, and every CI job, which clones
//     rather than links — `node_modules` is a real directory, this is false, and the REAL
//     `next/server` is loaded exactly as before. Fidelity is unchanged where it is
//     observable, and a genuine Next break (an export removed by an upgrade) still fails
//     `npm run test:unit` loudly on the machines that would have caught it.
//   * In a LINKED checkout the real module is already unusable, so the choice is not
//     "shim vs. real" but "shim vs. a suite that cannot run".
//
// If this ever needs revisiting: the fix that would let it go away is making `next/server`
// resolve to a single module identity through a junction, at which point deleting the
// branch below should leave the suite green in a worktree too.
const LINKED_CHECKOUT = (() => {
  const nodeModules = path.join(REPO_ROOT, "node_modules");
  try {
    if (lstatSync(nodeModules).isSymbolicLink()) return true;
    // Belt: a Windows junction is a reparse point that lstat does not always report as a
    // symlink. If the real path is somewhere else, the tree is linked either way.
    return realpathSync.native(nodeModules).toLowerCase() !== nodeModules.toLowerCase();
  } catch {
    // No node_modules at all — nothing to resolve `next/server` through, so nothing to fix.
    return false;
  }
})();

const NEXT_SERVER_SHIM = pathToFileURL(
  path.join(REPO_ROOT, "app", "_lib", "testing", "next-server-shim.mjs")
).href;

/** Resolve `basePath` the way TS/bundlers do: exact file, then +ext, then /index+ext. */
function resolveWithExtensions(basePath) {
  const candidates = [
    basePath,
    ...EXTENSIONS.map((ext) => basePath + ext),
    ...EXTENSIONS.map((ext) => path.join(basePath, "index" + ext)),
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* not this candidate */
    }
  }
  return null;
}

/** Build the resolve-hook result for a filesystem hit, attaching the JSON import
 *  attribute Node requires (TS `resolveJsonModule` imports omit it). */
function resolved(hitPath) {
  const url = pathToFileURL(hitPath).href;
  return hitPath.endsWith(".json")
    ? { url, importAttributes: { type: "json" }, shortCircuit: true }
    : { url, shortCircuit: true };
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // See LINKED_CHECKOUT above: real module in a normal checkout, shim in a linked one.
    if (specifier === "next/server" && LINKED_CHECKOUT) {
      return { url: NEXT_SERVER_SHIM, shortCircuit: true };
    }
    // tsconfig `@/*` alias — resolved against the repo root, extension-tolerant.
    if (specifier.startsWith("@/")) {
      const hit = resolveWithExtensions(path.join(REPO_ROOT, specifier.slice(2)));
      if (hit) return resolved(hit);
    }
    try {
      const result = nextResolve(specifier, context);
      // TS (resolveJsonModule) imports .json without the attribute Node requires
      // — attach it on the way through (covers explicit-extension JSON imports,
      // e.g. the dynamic `import(\`../../messages/${loc}.json\`)` in comms-dispatch).
      if (result?.url?.endsWith(".json")) {
        return { ...result, importAttributes: { type: "json" }, shortCircuit: true };
      }
      return result;
    } catch (error) {
      const code = error && typeof error === "object" ? error.code : undefined;
      if (code !== "ERR_MODULE_NOT_FOUND" && code !== "ERR_UNSUPPORTED_DIR_IMPORT") throw error;
      // Extensionless relative import (TS style): retry with extension candidates.
      if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
        const base = path.join(path.dirname(fileURLToPath(context.parentURL)), specifier);
        const hit = resolveWithExtensions(base);
        if (hit) return resolved(hit);
      }
      // Bare package subpath without an `exports` map (e.g. `next/server`, which
      // ships next/server.js but no exports entry): retry inside node_modules.
      if (/^[@a-zA-Z]/.test(specifier) && !specifier.startsWith("node:") && !specifier.startsWith("@/")) {
        const hit = resolveWithExtensions(path.join(REPO_ROOT, "node_modules", specifier));
        if (hit) return resolved(hit);
      }
      throw error;
    }
  },
});
