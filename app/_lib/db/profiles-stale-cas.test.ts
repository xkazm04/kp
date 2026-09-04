// updateProfile's `expectedUpdatedAt` precondition — "a profile save either locks or
// re-checks".
//
// A profile save is a read→compute→write that spans a Python spawn (profile_cli
// re-routes and re-scores the intake), so the editor's form is minutes older than the
// row by the time the UPDATE runs. Until this precondition existed the write was
// unconditional: two tabs, or a recruiter editing while a rebuild-from-latest
// re-hydrated the same row, and one set of changes vanished with nothing on screen to
// say so. The route turns a zero-row result into 409 PROFILE_STALE.
//
// This is the compensating-precondition half of the repo rule (the other being
// `.immediate()`), the same shape as actOnPipelineEntry's expectedStage.
//
// testing/unit-db.ts MUST be the first project import — it points KP_DB_PATH at a
// throwaway file before core.ts opens the store.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { saveProfile, updateProfile, getProfileRecord, profileDivergence } from "./profiles.ts";

after(() => cleanupUnitDb());

const WS = "ws-stale-cas";
const input = {
  label: "P",
  archetype: "bau",
  roleFamily: "software_engineering",
  completeness: 0.8,
  payload: { displayName: "P" },
};

/** The row's current content-write stamp — what the editor reads as `updatedAt`. */
function versionOf(id: string): string {
  const stamp = profileDivergence(id, WS)?.editedAt;
  assert.ok(stamp, "a saved profile always carries an updated_at");
  return stamp;
}

test("a save that names the CURRENT version is applied", () => {
  const { id } = saveProfile({ ...input, label: "Fresh" }, WS);
  const applied = updateProfile(id, { ...input, label: "Renamed" }, WS, versionOf(id));
  assert.equal(applied, true);
  assert.equal(getProfileRecord(id, WS)?.row.label, "Renamed");
});

test("a save computed against a SUPERSEDED version is refused, and changes nothing", async () => {
  const { id } = saveProfile({ ...input, label: "Contended" }, WS);
  // What the slow editor read when it opened.
  const stale = versionOf(id);
  // Someone else saves in the meantime. (updated_at is an ISO string at ms
  // resolution, so give the second write a distinct instant.)
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(updateProfile(id, { ...input, label: "Theirs" }, WS, stale), true, "the first writer wins on the version it read");

  await new Promise((r) => setTimeout(r, 5));
  const refused = updateProfile(id, { ...input, label: "Mine (computed earlier)" }, WS, stale);
  assert.equal(refused, false, "the second writer's precondition no longer matches ⇒ zero rows ⇒ 409, not a silent overwrite");
  assert.equal(getProfileRecord(id, WS)?.row.label, "Theirs", "the other writer's work survives intact");
});

test("re-reading the version lets the refused writer retry successfully", async () => {
  const { id } = saveProfile({ ...input, label: "Retry" }, WS);
  const stale = versionOf(id);
  await new Promise((r) => setTimeout(r, 5));
  updateProfile(id, { ...input, label: "Theirs" }, WS, stale);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(updateProfile(id, { ...input, label: "Mine" }, WS, versionOf(id)), true);
  assert.equal(getProfileRecord(id, WS)?.row.label, "Mine");
});

test("omitting the precondition keeps the previous unconditional write", () => {
  // The GDPR anonymize pass and every legacy/scripted caller go through this arm —
  // adding the guard must not have made them conditional by stealth.
  const { id } = saveProfile({ ...input, label: "Legacy" }, WS);
  assert.equal(updateProfile(id, { ...input, label: "Overwritten" }, WS), true);
  assert.equal(getProfileRecord(id, WS)?.row.label, "Overwritten");
});

test("the precondition never resurrects a row from another workspace, or an unknown id", () => {
  const { id } = saveProfile({ ...input, label: "Scoped" }, WS);
  const version = versionOf(id);
  assert.equal(updateProfile(id, { ...input, label: "X" }, "ws-other", version), false, "workspace scoping still binds");
  assert.equal(updateProfile("no-such-profile", { ...input }, WS, version), false);
});
