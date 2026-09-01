// Lockstep: the client's ModelsTestCode union must match the server's TestErrorCode
// union plus the codes the keys-test route emits before spawning anything.
//
// WHY THIS FILE. modelsTestReason.ts declares ModelsTestCode as a hand copy of
// TestErrorCode (verdict.ts) "plus the two the keys route adds" — and the keys
// route emits three. Nothing pinned the pair, while llm-capabilities-lockstep.test.ts
// pins the provider / use-case catalogs to the Python source they mirror. A hand
// mirror rots in a direction the type system cannot see: both unions are string
// literal types in different modules, so a code the server gains and the client
// does not compiles cleanly — and then `t.has("errors." + code)` misses, the
// client renders its generic fallback, and the specific reason the server went to
// the trouble of classifying is lost in all four locales.
//
// Both unions are TYPES, erased at runtime, so — exactly as the capabilities
// lockstep reads Python — this reads the members out of the source text. The
// anti-vacuity floor below guards the parse.
//
//   ModelsTestCode  ==  TestErrorCode  ∪  { codes minted in app/api/llm/keys/test/route.ts }
//
// Runner: npm run test:unit (node:test, no extra deps).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, "..", "..", "..", "..");
const VERDICT = path.join(HERE, "verdict.ts");
const KEYS_ROUTE = path.join(HERE, "..", "keys", "test", "route.ts");
const CLIENT = path.join(REPO_ROOT, "app", "features", "settings", "models", "modelsTestReason.ts");

/** The string-literal members of `export type <name> = | "a" | "b" …;`, in source order. */
function unionMembers(file: string, typeName: string): string[] {
  const source = readFileSync(file, "utf-8");
  const decl = `export type ${typeName} =`;
  const start = source.indexOf(decl);
  assert.notEqual(start, -1, `${decl} not found in ${path.basename(file)} — did the declaration change shape?`);
  const end = source.indexOf(";", start);
  assert.ok(end > start, `${typeName} is not a semicolon-terminated type alias any more`);
  return [...source.slice(start + decl.length, end).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

/** Every `code: "<literal>"` the keys-test route writes into a response. */
function mintedCodes(file: string): string[] {
  const source = readFileSync(file, "utf-8");
  return [...new Set([...source.matchAll(/\bcode:\s*"([a-z_]+)"/g)].map((m) => m[1]))];
}

test("the declarations still have the shape this test reads", () => {
  const server = unionMembers(VERDICT, "TestErrorCode");
  const client = unionMembers(CLIENT, "ModelsTestCode");
  const keys = mintedCodes(KEYS_ROUTE);
  assert.ok(server.length >= 8, `parsed only ${server.length} members from TestErrorCode`);
  assert.ok(client.length >= 10, `parsed only ${client.length} members from ModelsTestCode`);
  assert.ok(keys.length >= 3, `parsed only ${keys.length} minted codes from the keys-test route`);
  assert.ok(server.includes("provider_error"), "the catch-all must stay a declared member");
});

test("ModelsTestCode is exactly TestErrorCode plus the keys-route codes", () => {
  const expected = [...new Set([...unionMembers(VERDICT, "TestErrorCode"), ...mintedCodes(KEYS_ROUTE)])].sort();
  const actual = [...unionMembers(CLIENT, "ModelsTestCode")].sort();
  assert.deepEqual(
    actual,
    expected,
    "a code the server emits and the client does not know renders the generic fallback in every locale; " +
      "a code the client lists and no route emits is a dead branch. Add or remove it on BOTH sides " +
      "(and in messages/*.json if the Models tab resolves it there)."
  );
});
