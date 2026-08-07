// cachedProfileRecords — the Profile-tab double-fetch memo.
//
// The Profile tab reads the profiles table twice per load: /api/profile (roster)
// and /api/profile/candidates (matrix). Both now go through cachedProfileRecords,
// a short-TTL per-workspace memo, so the SECOND read on a tab load is free. This
// pins the two invariants that make that safe:
//   - within the TTL, a repeat read returns the SAME memoized set (no re-query) —
//     the identity check proves the second read didn't rebuild from the DB;
//   - a profile write INVALIDATES the memo, so a create/edit/delete reflects on the
//     very next read (the roster's optimistic prune + the matrix's forced refetch
//     must never show a just-deleted row).
//
// testing/unit-db.ts MUST be the first project import.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  cachedProfileRecords,
  deleteProfile,
  invalidateProfileRecordsCache,
  saveProfile,
  updateProfile,
} from "./profiles.ts";

after(() => cleanupUnitDb());

const WS = "ws-profile-cache";
const input = {
  label: "Cached",
  archetype: "bau",
  roleFamily: "engineering_backend",
  completeness: 0.7,
  payload: { displayName: "Cached" },
};

test("a repeat read within the TTL is served from the memo (same set, second read is free)", () => {
  saveProfile({ ...input, label: "First" }, WS);
  const a = cachedProfileRecords(WS);
  const b = cachedProfileRecords(WS);
  assert.equal(a, b, "the second read returns the memoized array — no re-query");
});

test("the memo is workspace-scoped — one tenant's set never serves another", () => {
  saveProfile({ ...input, label: "A" }, "ws-cache-a");
  saveProfile({ ...input, label: "B1" }, "ws-cache-b");
  saveProfile({ ...input, label: "B2" }, "ws-cache-b");
  assert.equal(cachedProfileRecords("ws-cache-a").length, 1, "tenant A sees only its own profile");
  assert.equal(cachedProfileRecords("ws-cache-b").length, 2, "tenant B sees only its own profiles");
});

test("a write invalidates the memo so the next read reflects it immediately", () => {
  const ws = "ws-cache-writes";
  const p = saveProfile({ ...input, label: "Original" }, ws);
  assert.equal(cachedProfileRecords(ws).length, 1);

  // Create → visible immediately (not after the TTL).
  saveProfile({ ...input, label: "Second" }, ws);
  assert.equal(cachedProfileRecords(ws).length, 2, "a create is reflected on the next read");

  // Edit → the new label is visible immediately.
  updateProfile(p.id, { ...input, label: "Renamed" }, ws);
  const afterEdit = cachedProfileRecords(ws).find((r) => r.row.id === p.id);
  assert.equal(afterEdit?.row.label, "Renamed", "an edit is reflected on the next read");

  // Delete → the row is gone immediately (the roster prune + matrix refetch invariant).
  deleteProfile(p.id, ws);
  assert.ok(
    !cachedProfileRecords(ws).some((r) => r.row.id === p.id),
    "a delete is reflected on the next read — never a stale just-deleted row"
  );
});

test("invalidateProfileRecordsCache forces a fresh set", () => {
  const ws = "ws-cache-flush";
  saveProfile({ ...input, label: "One" }, ws);
  const before = cachedProfileRecords(ws);
  invalidateProfileRecordsCache();
  const after = cachedProfileRecords(ws);
  assert.notEqual(before, after, "after an explicit flush the set is rebuilt (different reference)");
  assert.deepEqual(
    before.map((r) => r.row.id),
    after.map((r) => r.row.id),
    "…but the rebuilt content is identical"
  );
});
