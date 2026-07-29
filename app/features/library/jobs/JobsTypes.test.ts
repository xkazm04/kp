// Pins splitRequirements (idea-805403ce): the must/nice partition used to be
// implemented two opposite ways — jobMarkdown split on `kind === "must_have"`
// (anything else → nice) while publish split on `kind !== "nice_to_have"`
// (anything else → must) — so an off-taxonomy `kind` silently landed in
// different buckets in the published posting vs. the sourcing must-haves. These
// tests lock the single canonical rule against the REAL exported helper (not a
// copy), so a future tweak that re-splits the wrong way fails CI.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// JobsTypes re-exports "@/app/_lib/archetypes", which imports a .json without an
// import attribute — neither the "@/*" alias, extensionless .ts, nor bare JSON
// import works under the plain `node --test` runner. Install minimal module hooks
// so we load the REAL module rather than reimplementing its logic. Scoped to this
// file's process (node --test isolates files).
const ROOT = new URL("../../../../", import.meta.url).href; // app/features/library/jobs/ -> repo root
registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier;
    if (spec.startsWith("@/")) spec = new URL(spec.slice(2), ROOT).href; // tsconfig "@/*"
    if (spec.startsWith("file:") && !/\.[a-z0-9]+$/i.test(spec) && existsSync(fileURLToPath(spec + ".ts"))) {
      spec += ".ts"; // extensionless local import
    }
    return nextResolve(spec, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".json")) {
      const source = "export default " + readFileSync(fileURLToPath(url), "utf8") + ";";
      return { format: "module", source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { splitRequirements } = await import("./JobsTypes.ts");

test("splits canonical must_have / nice_to_have into the right buckets", () => {
  const { mustHaves, niceToHaves } = splitRequirements([
    { skill: "React", kind: "must_have" },
    { skill: "Go", kind: "nice_to_have" },
    { skill: "SQL", kind: "must_have" },
  ]);
  assert.deepEqual(mustHaves, ["React", "SQL"]);
  assert.deepEqual(niceToHaves, ["Go"]);
});

test("off-taxonomy / missing kind falls to nice-to-have (never promoted to a hard filter)", () => {
  // The bug this guards: publish used to route these into must-haves while
  // jobMarkdown routed them into nice — now both agree they are nice-to-have.
  const { mustHaves, niceToHaves } = splitRequirements([
    { skill: "Docker", kind: "preferred" }, // off-taxonomy value
    { skill: "Kafka" }, // kind omitted
    { skill: "Rust", kind: null }, // explicit null
  ]);
  assert.deepEqual(mustHaves, []);
  assert.deepEqual(niceToHaves, ["Docker", "Kafka", "Rust"]);
});

test("tolerates null/undefined/empty input", () => {
  assert.deepEqual(splitRequirements(null), { mustHaves: [], niceToHaves: [] });
  assert.deepEqual(splitRequirements(undefined), { mustHaves: [], niceToHaves: [] });
  assert.deepEqual(splitRequirements([]), { mustHaves: [], niceToHaves: [] });
});

test("preserves input order within each bucket", () => {
  const { mustHaves } = splitRequirements([
    { skill: "A", kind: "must_have" },
    { skill: "B", kind: "nice_to_have" },
    { skill: "C", kind: "must_have" },
    { skill: "D", kind: "must_have" },
  ]);
  assert.deepEqual(mustHaves, ["A", "C", "D"]);
});
