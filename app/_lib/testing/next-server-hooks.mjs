// Module-resolution hooks that point `next/server` at next-server-shim.mjs.
//
// Registered from a test with `register(new URL("...next-server-hooks.mjs", import.meta.url))`
// BEFORE the route module is dynamically imported — hooks only affect later resolutions,
// which is why the route under test must be loaded with `await import(...)`, not a static
// import. See the shim for why this is needed at all (junction-worktree module identity).
import { pathToFileURL } from "node:url";
import path from "node:path";

const SHIM = pathToFileURL(path.join(import.meta.dirname, "next-server-shim.mjs")).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/server") return { url: SHIM, shortCircuit: true };
  return nextResolve(specifier, context);
}
