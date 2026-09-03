// THE ROUTING TABLE'S LOST UPDATE. `upsertLlmConfig` was an unconditional
// `INSERT … ON CONFLICT DO UPDATE`, and the Models table renders each pinned row's
// own `updatedAt` while never sending it back. So two operators (or two tabs) could
// sit on the same use case for minutes and the second Save silently replaced the
// first's provider/model — no refusal, no note, and the "Updated <date>" line the
// second operator had been looking at was the exact evidence that would have caught
// it, travelling in one direction only.
//
// The store now takes `expectedUpdatedAt` and re-asserts it inside an IMMEDIATE
// transaction (the read→compute→write law in .claude/CLAUDE.md: the INSERT-vs-UPDATE
// decision READS the row, so the write lock must be taken at BEGIN). A mismatch
// writes nothing and returns false; the route turns that into a 409
// MODEL_ROUTING_STALE carrying the current rows.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { listLlmConfig, upsertLlmConfig, deleteLlmConfig } from "../../../_lib/db/llm.ts";

after(() => cleanupUnitDb());

const USE_CASE = "match_reasoning";

function pinnedRow() {
  return listLlmConfig().find((r) => r.useCase === USE_CASE);
}

test("a first pin with expectedUpdatedAt null succeeds — 'I saw no row here' and there was none", () => {
  deleteLlmConfig(USE_CASE);
  assert.equal(upsertLlmConfig({ useCase: USE_CASE, provider: "openai", model: "a", expectedUpdatedAt: null }), true);
  assert.equal(pinnedRow()?.provider, "openai");
});

test("a first pin claiming null LOSES when someone inserted one first", () => {
  // Alice's tab opened before any pin existed, so she echoes null. Bob pins in between.
  const bobWrote = upsertLlmConfig({ useCase: USE_CASE, provider: "gemini", model: "bob" });
  assert.equal(bobWrote, true);
  const aliceWrote = upsertLlmConfig({ useCase: USE_CASE, provider: "anthropic", model: "alice", expectedUpdatedAt: null });
  assert.equal(aliceWrote, false, "nothing was written");
  assert.equal(pinnedRow()?.model, "bob", "Bob's pin survives untouched");
});

test("THE RACE: a save composed against a superseded version is DROPPED, not applied", () => {
  deleteLlmConfig(USE_CASE);
  upsertLlmConfig({ useCase: USE_CASE, provider: "openai", model: "original" });
  // Both operators load the table and read the same version.
  const seen = pinnedRow()!.updatedAt;

  // Bob saves first. His write moves the row's version forward.
  assert.equal(upsertLlmConfig({ useCase: USE_CASE, provider: "gemini", model: "bob", expectedUpdatedAt: seen }), true);
  const afterBob = pinnedRow()!;
  assert.equal(afterBob.model, "bob");

  // Alice saves minutes later, still holding the version she read.
  const aliceWrote = upsertLlmConfig({
    useCase: USE_CASE,
    provider: "anthropic",
    model: "alice",
    expectedUpdatedAt: seen,
  });
  assert.equal(aliceWrote, false, "the precondition refuses the stale write");
  const now = pinnedRow()!;
  assert.equal(now.model, "bob", "Bob's model is intact");
  assert.equal(now.provider, "gemini", "…and so is his provider");
  assert.equal(now.updatedAt, afterBob.updatedAt, "the row was not even re-stamped");
});

test("re-reading the row lets the same operator re-apply their change", () => {
  const fresh = pinnedRow()!.updatedAt;
  assert.equal(
    upsertLlmConfig({ useCase: USE_CASE, provider: "anthropic", model: "alice", expectedUpdatedAt: fresh }),
    true,
    "the remedy the 409 tells the operator to take actually works"
  );
  assert.equal(pinnedRow()?.model, "alice");
});

test("NON-VACUITY: omitting expectedUpdatedAt keeps the old unconditional write", () => {
  // The headless / curl path has no version to echo and must not be forced to invent
  // one — this is what keeps `npm run typecheck`-clean scripts and the open-mode
  // install working exactly as before.
  const before = pinnedRow()!;
  assert.equal(upsertLlmConfig({ useCase: USE_CASE, provider: "qwen", model: "headless" }), true);
  const after2 = pinnedRow()!;
  assert.notEqual(after2.provider, before.provider, "the row really was rewritten, so this is not passing on a no-op");
  assert.equal(after2.model, "headless");
});
