// The brief-edit draft: what survives a reload mid-edit, and — just as
// important — what must NOT be restored. Pure; the component only supplies a
// storage object.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   node scripts/run-unit-tests.mjs app/features/library/jds/intake/intakeBriefDraft.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { RoleBrief } from "@/app/_lib/rolespec";
import {
  briefDraftKey,
  clearBriefDraft,
  decodeBriefDraft,
  encodeBriefDraft,
  loadBriefDraft,
  saveBriefDraft,
  type DraftStorage,
} from "./intakeBriefDraft.ts";

const brief = { title: "Platform engineer", seniority: "senior" } as RoleBrief;

function memoryStorage(seed: Record<string, string> = {}): DraftStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

test("the key is per intake, so two sessions never see each other's draft", () => {
  assert.notEqual(briefDraftKey("intake-a"), briefDraftKey("intake-b"));
  assert.match(briefDraftKey("intake-a"), /intake-a$/);
});

test("a draft round-trips while the row has not moved", () => {
  const raw = encodeBriefDraft("2026-09-03T10:00:00.000Z", brief);
  assert.deepEqual(decodeBriefDraft(raw, "2026-09-03T10:00:00.000Z"), brief);
});

test("a draft is DISCARDED when the intake moved under it", () => {
  // The voice sweep, a /message turn or another tab wrote the brief while the
  // edit form sat open in a closed tab — restoring the stale copy would silently
  // revert whatever landed meanwhile.
  const raw = encodeBriefDraft("2026-09-03T10:00:00.000Z", brief);
  assert.equal(decodeBriefDraft(raw, "2026-09-03T10:05:00.000Z"), null);
  assert.equal(decodeBriefDraft(raw, null), null);
});

test("nothing stored, or nonsense stored, restores nothing", () => {
  assert.equal(decodeBriefDraft(null, "x"), null);
  assert.equal(decodeBriefDraft("", "x"), null);
  assert.equal(decodeBriefDraft("{not json", "x"), null);
  assert.equal(decodeBriefDraft(JSON.stringify({ updatedAt: "x" }), "x"), null);
  assert.equal(decodeBriefDraft(JSON.stringify({ updatedAt: "x", brief: "nope" }), "x"), null);
});

test("save → load → clear over a storage object", () => {
  const storage = memoryStorage();
  saveBriefDraft(storage, "intake-a", "t1", brief);
  assert.equal(storage.map.size, 1);
  assert.deepEqual(loadBriefDraft(storage, "intake-a", "t1"), brief);
  assert.equal(loadBriefDraft(storage, "intake-b", "t1"), null);
  clearBriefDraft(storage, "intake-a");
  assert.equal(loadBriefDraft(storage, "intake-a", "t1"), null);
});

test("a storage that throws (private mode, quota, blocked site data) is survivable", () => {
  const hostile: DraftStorage = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {
      throw new Error("SecurityError");
    },
  };
  assert.equal(loadBriefDraft(hostile, "intake-a", "t1"), null);
  saveBriefDraft(hostile, "intake-a", "t1", brief);
  clearBriefDraft(hostile, "intake-a");
  // …and no storage at all is the same non-event.
  assert.equal(loadBriefDraft(null, "intake-a", "t1"), null);
  saveBriefDraft(null, "intake-a", "t1", brief);
  clearBriefDraft(null, "intake-a");
});
