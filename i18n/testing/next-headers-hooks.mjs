// Module-resolution hooks that point `next/headers` at next-headers-shim.mjs.
// Registered from a test with
// `register(new URL("./testing/next-headers-hooks.mjs", import.meta.url))` BEFORE
// the module under test is dynamically imported — hooks only affect later
// resolutions, which is why i18n/server.ts must be loaded with `await import(...)`
// rather than a static import.
import { pathToFileURL } from "node:url";
import path from "node:path";

const SHIM = pathToFileURL(path.join(import.meta.dirname, "next-headers-shim.mjs")).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/headers") return { url: SHIM, shortCircuit: true };
  return nextResolve(specifier, context);
}
