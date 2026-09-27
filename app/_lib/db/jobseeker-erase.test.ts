// The seeker's own erasure door (eraseJobseekerData, db/jobseeker-profiles.ts) on an
// isolated throwaway DB — unit-db.ts must be the first project import (it sets
// KP_DB_PATH before any store opens a connection).
//
// Pinned: everything the seeker owns goes (profile, CVs, dialogs, UI state, and the
// postings when they were the workspace's last seeker); the sources config stays; a
// second WORKSPACE and a second USER in the same workspace are untouched — including
// the shared postings, which carry no author and so stay while another seeker remains;
// and a second call is a no-op that answers zeros.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_PREFERENCES, type RawPosting } from "../jobseeker/types.ts";
import type { ProfilePayload } from "../../features/shared/profileTypes.ts";
import { eraseJobseekerData, getJobseekerProfile, upsertJobseekerProfile } from "./jobseeker-profiles.ts";
import { listJobseekerCvs, recordJobseekerCv } from "./jobseeker-cvs.ts";
import { createDialog, listDialogs } from "./jobseeker-dialogs.ts";
import { countCoverNotes, getCvDesignState, setCoverNote, setCvDesignState } from "./jobseeker-ui-state.ts";
import { getJobseekerPosting, setJobseekerPostingStatus, upsertPosting } from "./jobseeker-postings.ts";
import { createJobseekerSource, listJobseekerSources } from "./jobseeker-sources.ts";

after(() => cleanupUnitDb());

const SEEN = "2026-09-20T08:00:00.000Z";

function raw(key: string): RawPosting {
  return {
    externalKey: key,
    url: `https://jobs.example/${key}`,
    title: `Posting ${key}`,
    company: "Example",
    location: "Praha",
    country: "cz",
    workMode: "hybrid",
    postedAt: null,
    salaryText: null,
    salary: null,
    bodyText: `We are hiring for ${key}.`,
    jsonld: null,
    lang: "en",
  };
}

/** One seeker's full footprint in a workspace; answers the profile id and a posting id. */
function seed(userId: string | null, ws: string, tag: string): { profileId: string; postingId: string } {
  const profile = upsertJobseekerProfile(
    { userId, profile: { displayName: `Seeker ${tag}` } as unknown as ProfilePayload, preferences: EMPTY_PREFERENCES, cvSourceText: `CV of ${tag}` },
    ws
  );
  recordJobseekerCv({ userId, sourceText: `CV of ${tag}`, draft: {} as ProfilePayload, draftSource: "deterministic" }, ws);
  recordJobseekerCv({ userId, sourceText: `Older CV of ${tag}`, draft: {} as ProfilePayload, draftSource: "deterministic" }, ws);
  createDialog({ profileId: profile.id, kind: "cv_polish", postingId: null, lang: "en", opening: [{ role: "interviewer", text: `Hi ${tag}` }] }, ws);
  setCvDesignState(profile.id, { template: "editorial" }, ws);
  const postingId = upsertPosting(`src-${tag}`, raw(`ext-${tag}`), SEEN, ws).id;
  setCoverNote(profile.id, postingId, `Dear team, ${tag}`, ws);
  setJobseekerPostingStatus(postingId, "dismissed", { reason: "salary", note: `${tag} said no` }, ws);
  return { profileId: profile.id, postingId };
}

function footprint(userId: string | null, ws: string, profileId: string) {
  return {
    profile: getJobseekerProfile(userId, ws) !== null,
    cvs: listJobseekerCvs(userId, ws).length,
    dialogs: listDialogs(profileId, ws).length,
    design: getCvDesignState(profileId, ws) !== null,
    covers: countCoverNotes(profileId, ws),
  };
}

test("the last seeker in a workspace: everything about them goes, the sources config stays, and it is idempotent", () => {
  const WS = "ws-erase-solo";
  const OTHER_WS = "ws-erase-elsewhere";
  createJobseekerSource({ kind: "feed", adapter: "eures", tier: "A", host: "eures.example", config: {} }, WS);
  const mine = seed(null, WS, "solo");
  // The same null user in ANOTHER workspace is another seeker entirely.
  const theirs = seed(null, OTHER_WS, "else");

  assert.deepEqual(footprint(null, WS, mine.profileId), { profile: true, cvs: 2, dialogs: 1, design: true, covers: 1 });

  const counts = eraseJobseekerData(null, WS);
  assert.deepEqual(counts, { profiles: 1, cvs: 2, dialogs: 1, uiState: 2, postings: 1 });
  assert.deepEqual(footprint(null, WS, mine.profileId), { profile: false, cvs: 0, dialogs: 0, design: false, covers: 0 });
  assert.equal(getJobseekerPosting(mine.postingId, WS), null, "the gathered postings went with the last seeker");
  assert.equal(listJobseekerSources(WS).length, 1, "acquisition config holds no personal data and is kept");

  // The other workspace never noticed.
  assert.deepEqual(footprint(null, OTHER_WS, theirs.profileId), { profile: true, cvs: 2, dialogs: 1, design: true, covers: 1 });
  assert.equal(getJobseekerPosting(theirs.postingId, OTHER_WS)?.status, "dismissed");

  // Idempotent: nothing left to erase answers zeros, and does not throw.
  assert.deepEqual(eraseJobseekerData(null, WS), { profiles: 0, cvs: 0, dialogs: 0, uiState: 0, postings: 0 });
});

test("a second seeker in the same workspace keeps their record AND the shared postings", () => {
  const WS = "ws-erase-shared";
  const ada = seed("user-ada", WS, "ada");
  const bob = seed("user-bob", WS, "bob");

  const counts = eraseJobseekerData("user-ada", WS);
  assert.deepEqual(counts, { profiles: 1, cvs: 2, dialogs: 1, uiState: 2, postings: 0 });
  assert.deepEqual(footprint("user-ada", WS, ada.profileId), { profile: false, cvs: 0, dialogs: 0, design: false, covers: 0 });
  assert.deepEqual(footprint("user-bob", WS, bob.profileId), { profile: true, cvs: 2, dialogs: 1, design: true, covers: 1 });

  // Postings carry no author, so while Bob remains they are his feed too.
  for (const id of [ada.postingId, bob.postingId]) {
    const row = getJobseekerPosting(id, WS);
    assert.equal(row?.status, "dismissed", "shared postings are untouched while another seeker remains");
    assert.ok(row?.dismissNote, "…triage notes included: nothing on the row says whose they are");
  }

  // Bob leaving afterwards takes the dataset with him.
  assert.equal(eraseJobseekerData("user-bob", WS).postings, 2);
});

test("CVs read before any profile was saved are still the seeker's and still go", () => {
  const WS = "ws-erase-cv-only";
  recordJobseekerCv({ userId: "user-early", sourceText: "An early CV", draft: {} as ProfilePayload, draftSource: null }, WS);
  recordJobseekerCv({ userId: "user-other", sourceText: "Someone else's CV", draft: {} as ProfilePayload, draftSource: null }, WS);
  assert.deepEqual(eraseJobseekerData("user-early", WS), { profiles: 0, cvs: 1, dialogs: 0, uiState: 0, postings: 0 });
  assert.equal(listJobseekerCvs("user-early", WS).length, 0);
  assert.equal(listJobseekerCvs("user-other", WS).length, 1, "the other user's CV is untouched");
});
