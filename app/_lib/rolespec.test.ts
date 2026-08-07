// parseRoleSpec — the trust-boundary parse for role payloads (client-sent on
// POST /api/jds/save, Python-emitted on the design chain). Pins the degrade
// contract: valid partials pass through typed, malformed input becomes {} —
// never a throw, never a blind cast reaching `.map` calls downstream.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoleSpec } from "./rolespec.ts";

test("a full generated-shape role passes through", () => {
  const role = {
    title: "Data Analyst",
    seniority: "senior",
    roleFamily: "data_analytics",
    mustHaves: ["SQL"],
    niceToHaves: ["dbt"],
    responsibilities: ["Own reporting"],
    languages: ["en"],
    promptVersion: "v1",
  };
  assert.deepEqual(parseRoleSpec(role), role);
});

test("a partial role (older stored blob) keeps its known fields", () => {
  const parsed = parseRoleSpec({ title: "Backend Dev", mustHaves: ["Go"] });
  assert.equal(parsed.title, "Backend Dev");
  assert.deepEqual(parsed.mustHaves, ["Go"]);
  assert.equal(parsed.seniority, undefined);
});

test("malformed input degrades to {} instead of throwing or leaking a cast", () => {
  for (const bad of [null, undefined, "text", 42, [], { mustHaves: "not-an-array" }]) {
    assert.deepEqual(parseRoleSpec(bad), {});
  }
});
