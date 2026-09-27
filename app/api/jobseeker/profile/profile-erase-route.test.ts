// The seeker's "delete everything about me" door (DELETE /api/jobseeker/profile) on an
// isolated DB, open auth mode: a DELETE without the exact `{"confirm":"erase"}` body is
// a coded 400 that erases nothing; with it the seeker's record is gone (the profile GET
// then answers the coded 404) and the answer carries the per-table counts; and the door
// is throttled at 5 per 10 minutes per IP, refused attempts included. (Idempotence —
// a repeat erases zeros — is the store's contract, pinned in db/jobseeker-erase.test.ts.)
//
// unit-db.ts must be the first project import (it sets KP_DB_PATH before any store opens).
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { getJobseekerProfile, upsertJobseekerProfile } from "../../../_lib/db/jobseeker-profiles.ts";
import { listJobseekerCvs, recordJobseekerCv } from "../../../_lib/db/jobseeker-cvs.ts";
import { DEFAULT_WORKSPACE_ID } from "../../../_lib/db/workspaces.ts";
import { EMPTY_PREFERENCES } from "../../../_lib/jobseeker/types.ts";
import type { ProfilePayload } from "../../../features/shared/profileTypes.ts";
import { DELETE, GET } from "./route.ts";

after(() => cleanupUnitDb());

const erase = (body: string | null) =>
  DELETE(
    new Request("http://localhost/api/jobseeker/profile", {
      method: "DELETE",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
      body,
    })
  );
const codeOf = async (res: Response) => ((await res.json()) as { code: string }).code;

test("no confirmation, a wrong one, or no body: a coded 400 that erases nothing", async () => {
  upsertJobseekerProfile({ userId: null, profile: { displayName: "Ada" } as unknown as ProfilePayload, preferences: EMPTY_PREFERENCES }, DEFAULT_WORKSPACE_ID);
  for (const body of [null, "{}", JSON.stringify({ confirm: "yes" }), "not json"]) {
    const res = await erase(body);
    assert.equal(res.status, 400, `body ${body}`);
    assert.equal(await codeOf(res), "JOBSEEKER_REQUEST_INVALID");
  }
  assert.ok(getJobseekerProfile(null, DEFAULT_WORKSPACE_ID), "a refused erasure left the record in place");
});

test("confirmed: the record goes, the counts come back, and the sixth attempt is throttled", async () => {
  recordJobseekerCv({ userId: null, sourceText: "Ada's CV", draft: {} as ProfilePayload, draftSource: null }, DEFAULT_WORKSPACE_ID);

  const res = await erase(JSON.stringify({ confirm: "erase" }));
  assert.equal(res.status, 200);
  const { erased } = (await res.json()) as { erased: Record<string, number> };
  assert.equal(erased.profiles, 1);
  assert.equal(erased.cvs, 1);
  assert.equal(getJobseekerProfile(null, DEFAULT_WORKSPACE_ID), null);
  assert.equal(listJobseekerCvs(null, DEFAULT_WORKSPACE_ID).length, 0);

  const gone = await GET();
  assert.equal(gone.status, 404);
  assert.equal(await codeOf(gone), "JOBSEEKER_PROFILE_MISSING");

  // The budget is 5 per 10 minutes per IP and this file has spent all 5 (4 refused
  // shapes + 1 erasure): the limiter runs BEFORE the body is read, so a client cannot
  // probe the door for free.
  const again = await erase(JSON.stringify({ confirm: "erase" }));
  assert.equal(again.status, 429);
  assert.equal(await codeOf(again), "TOO_MANY_REQUESTS");
});
