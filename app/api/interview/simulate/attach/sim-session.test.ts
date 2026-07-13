// Pins isAttachableSimSession — the /api/interview/simulate/attach guard for
// bug-ui-scan-2026-07-09 (interview-simulation-comparison #3). The old guard
// (`session && !session.entryId`) accepted an interview-lab mode:"test" session
// OR a never-run `created` session as a "practice run", stamping a sim_attached
// event referencing an interview that never happened. The three cases marked
// "pre-fix accepted" are the non-vacuity: the pre-fix condition returns true for
// them, this predicate returns false.
// Runner: node --test with the repo's test:alias loader (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isAttachableSimSession } from "./sim-session.ts";

const S = (o: Partial<{ entryId: string | null; mode: "test" | "candidate"; endedAt: string | null }>) => ({
  entryId: null as string | null,
  mode: "candidate" as "test" | "candidate",
  endedAt: "2026-07-09T00:00:00.000Z" as string | null,
  ...o,
});

test("a completed, entry-less, candidate-mode sim is attachable", () => {
  assert.equal(isAttachableSimSession(S({})), true);
});

test("a real entry-linked candidate session is rejected (already on a record)", () => {
  assert.equal(isAttachableSimSession(S({ entryId: "entry_1" })), false);
});

test("an interview-lab mode:'test' session is rejected (never a candidate-facing sim) — pre-fix accepted it", () => {
  assert.equal(isAttachableSimSession(S({ mode: "test" })), false);
});

test("a sim created but never run (endedAt null) is rejected — pre-fix accepted it", () => {
  assert.equal(isAttachableSimSession(S({ endedAt: null })), false);
});

test("null session is rejected", () => {
  assert.equal(isAttachableSimSession(null), false);
});
