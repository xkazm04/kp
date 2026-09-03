// A provider key is the deployment's spending credential, and the store wrote it
// last-writer-wins: `INSERT … ON CONFLICT (provider, scope) DO UPDATE` overwrote
// whatever was there, while the Models panel rendered the `updatedAt` of the row
// it was about to replace and never sent it back. Two admins rotating the same
// (provider, scope) row in overlapping tabs left the LOSER believing their key was
// live, with no signal anywhere that it had been overwritten seconds later — and a
// provider key is encrypted at rest and unrecoverable, so the loser's key is gone.
//
// `expectedUpdatedAt` makes the panel's rendered version a precondition, re-asserted
// INSIDE `.immediate()` (write lock at BEGIN) so the read→compare→write cannot
// interleave. Omitting it keeps the old last-writer-wins behaviour for headless
// callers that never read a version.
//
// unit-db.ts must stay the FIRST project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { deleteProviderKey, listProviderKeys, upsertProviderKey } from "./llm.ts";

after(() => cleanupUnitDb());

function keyRow(provider: string, scope = "byom") {
  return listProviderKeys().find((r) => r.provider === provider && r.scope === scope);
}

test("a first write needs no precondition, and reports the version it wrote", () => {
  const first = upsertProviderKey({ provider: "openai", scope: "byom", keyCiphertext: "cipher-1" });
  assert.equal(first.ok, true);
  assert.ok(first.ok && first.updatedAt, "the write reports the row version it produced");
  assert.equal(keyRow("openai")?.keyCiphertext, "cipher-1");
  assert.equal(keyRow("openai")?.updatedAt, first.ok ? first.updatedAt : "");
});

test("every write moves the version forward, even inside the same millisecond", () => {
  const a = upsertProviderKey({ provider: "gemini", scope: "byom", keyCiphertext: "a" });
  const b = upsertProviderKey({ provider: "gemini", scope: "byom", keyCiphertext: "b" });
  assert.ok(a.ok && b.ok);
  assert.notEqual(a.ok && a.updatedAt, b.ok && b.updatedAt);
  // Strictly increasing: the version is an optimistic-concurrency token, so two
  // writes landing in one millisecond must not share it (a shared value would make
  // the SECOND writer's stale token look current).
  assert.ok(Date.parse((b as { updatedAt: string }).updatedAt) > Date.parse((a as { updatedAt: string }).updatedAt));
});

test("the loser of a two-tab rotation is refused, not silently overwritten", () => {
  // Both tabs loaded the same row and hold the same rendered version.
  const seeded = upsertProviderKey({ provider: "openrouter", scope: "byom", keyCiphertext: "original" });
  assert.ok(seeded.ok);
  const rendered = (seeded as { updatedAt: string }).updatedAt;

  const winner = upsertProviderKey({
    provider: "openrouter",
    scope: "byom",
    keyCiphertext: "tab-one",
    expectedUpdatedAt: rendered,
  });
  assert.equal(winner.ok, true);

  const loser = upsertProviderKey({
    provider: "openrouter",
    scope: "byom",
    keyCiphertext: "tab-two",
    expectedUpdatedAt: rendered,
  });
  assert.equal(loser.ok, false, "the second writer's precondition no longer holds");
  assert.equal(loser.ok === false && loser.reason, "stale");
  // …and the refusal carries the CURRENT version, so the panel can reload onto it.
  assert.equal(loser.ok === false && loser.updatedAt, keyRow("openrouter")?.updatedAt);
  // The winner's key is intact — the refusal is a real skip, not a rolled-back write.
  assert.equal(keyRow("openrouter")?.keyCiphertext, "tab-one");
});

test("a precondition on a row that has since been DELETED is stale, not a fresh create", () => {
  const seeded = upsertProviderKey({ provider: "azure_openai", scope: "platform", keyCiphertext: "gone-soon" });
  assert.ok(seeded.ok);
  const rendered = (seeded as { updatedAt: string }).updatedAt;
  // Another admin removed the row between the panel's load and this save.
  deleteProviderKey("azure_openai", "platform");
  const result = upsertProviderKey({
    provider: "azure_openai",
    scope: "platform",
    keyCiphertext: "recreated",
    expectedUpdatedAt: rendered,
  });
  assert.equal(result.ok, false, "the row the caller meant to replace is gone — that is a stale view");
  assert.equal(result.ok === false && result.updatedAt, null);
  assert.equal(keyRow("azure_openai", "platform"), undefined, "nothing was written");
});

test("a caller that sends no precondition keeps last-writer-wins", () => {
  upsertProviderKey({ provider: "mistral", scope: "byom", keyCiphertext: "one" });
  const second = upsertProviderKey({ provider: "mistral", scope: "byom", keyCiphertext: "two" });
  assert.equal(second.ok, true, "headless callers never read a version, so they cannot send one");
  assert.equal(keyRow("mistral")?.keyCiphertext, "two");
});
