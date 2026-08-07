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
//
// Everything else (bare packages, node: builtins, exact-path imports) goes through
// the default resolver untouched. Uses the synchronous `registerHooks` API so the
// hook runs in-thread — no worker, no impact on test parallelism. `node --test`
// child processes inherit the --import flag via execArgv, so every test file gets it.
import { registerHooks } from "node:module";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs"];

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
