// winnability-apply — pins the one-shot URL grammar (?coachEdit=<kind~slug~delta~
// value>) shared by CoachPanel (builds it) and the Library ledger (consumes it).
// The invariants that matter:
//   - only the three stageable kinds round-trip; salary is never encoded,
//   - a bad kind/slug or an empty requirement value stages NOTHING (fail-closed),
//   - the delta is clamped and junk deltas degrade to 0, never trusted,
//   - a `~` inside a requirement name survives (value is serialized last).
//
// Runner: Node's built-in test runner with type stripping. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCoachEditParam, parseCoachEditParam, type CoachEdit } from "./coach-apply.ts";

const base: CoachEdit = { kind: "language", slug: "senior-backend-engineer", delta: 4, value: "German" };

test("build → parse round-trips a valid gate handoff", () => {
  assert.deepEqual(parseCoachEditParam(buildCoachEditParam(base)), base);
});

test("round-trips each stageable kind", () => {
  for (const kind of ["language", "education", "mustHave"] as const) {
    const edit: CoachEdit = { ...base, kind, value: "Kubernetes" };
    assert.deepEqual(parseCoachEditParam(buildCoachEditParam(edit)), edit);
  }
});

test("buildCoachEditParam refuses an unstageable or malformed edit", () => {
  // A kind outside the allowlist (e.g. salary) never encodes.
  assert.equal(buildCoachEditParam({ ...base, kind: "salary" as unknown as CoachEdit["kind"] }), null);
  // A slug with URL-hostile characters is rejected at the boundary.
  assert.equal(buildCoachEditParam({ ...base, slug: "bad slug/../etc" }), null);
  // An empty (or whitespace-only) requirement value has nothing to stage.
  assert.equal(buildCoachEditParam({ ...base, value: "   " }), null);
});

test("buildCoachEditParam clamps a wild delta and trims/caps the value", () => {
  assert.equal(buildCoachEditParam({ ...base, delta: -5 }), "language~senior-backend-engineer~0~German");
  assert.equal(buildCoachEditParam({ ...base, delta: 99999 }), "language~senior-backend-engineer~9999~German");
  const long = "x".repeat(200);
  const parsed = parseCoachEditParam(buildCoachEditParam({ ...base, value: `  ${long}  ` }));
  assert.equal(parsed!.value.length, 80);
});

test("parseCoachEditParam rejects absence and out-of-shape values", () => {
  assert.equal(parseCoachEditParam(null), null);
  assert.equal(parseCoachEditParam(undefined), null);
  assert.equal(parseCoachEditParam(""), null);
  assert.equal(parseCoachEditParam("language~slug~4"), null); // too few fields
  assert.equal(parseCoachEditParam("nope~slug~4~German"), null); // bad kind
  assert.equal(parseCoachEditParam("language~bad slug~4~German"), null); // bad slug
  assert.equal(parseCoachEditParam("language~slug~4~   "), null); // empty value
});

test("a non-numeric delta degrades to 0 rather than being trusted", () => {
  const parsed = parseCoachEditParam("language~slug~abc~German");
  assert.deepEqual(parsed, { kind: "language", slug: "slug", delta: 0, value: "German" });
});

test("a ~ inside the requirement value survives (value is serialized last)", () => {
  const edit: CoachEdit = { ...base, kind: "mustHave", value: "C~C++" };
  assert.deepEqual(parseCoachEditParam(buildCoachEditParam(edit)), edit);
});
