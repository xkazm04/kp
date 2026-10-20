// The seeker's cross-device UI state door on an isolated DB, open auth mode: no profile
// is a coded 404, the design round-trips through the cvQuery validator (junk falls back
// to defaults, never stored raw), a cover note is kept per posting and bounded, and a
// posting this workspace does not hold is refused.
//
// unit-db.ts must be the first project import (it sets KP_DB_PATH before any store opens).
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { upsertJobseekerProfile } from "../../../_lib/db/jobseeker-profiles.ts";
import { upsertPosting } from "../../../_lib/db/jobseeker-postings.ts";
import { DEFAULT_WORKSPACE_ID } from "../../../_lib/db/workspaces.ts";
import { COVER_NOTE_MAX_CHARS, EMPTY_PREFERENCES, type RawPosting } from "../../../_lib/jobseeker/types.ts";
import type { ProfilePayload } from "../../../features/shared/profileTypes.ts";
import { CV_DESIGN_DEFAULT } from "../../../features/jobseeker/cv/cvQuery.ts";
import { GET, PUT } from "./route.ts";

after(() => cleanupUnitDb());

const get = (query = "") => GET(new Request(`http://localhost/api/jobseeker/ui-state${query}`));
const put = (body: unknown) =>
  PUT(new Request("http://localhost/api/jobseeker/ui-state", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const codeOf = async (res: Response) => ((await res.json()) as { code: string }).code;

function raw(key: string, overrides: Partial<RawPosting> = {}): RawPosting {
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
    bodyText: "We are hiring.",
    jsonld: null,
    lang: "en",
    ...overrides,
  };
}

test("no profile yet: both verbs answer JOBSEEKER_PROFILE_MISSING", async () => {
  const g = await get();
  assert.equal(g.status, 404);
  assert.equal(await codeOf(g), "JOBSEEKER_PROFILE_MISSING");
  const p = await put({ design: { template: "editorial" } });
  assert.equal(p.status, 404);
  assert.equal(await codeOf(p), "JOBSEEKER_PROFILE_MISSING");
});

test("the design round-trips, re-validated by cvQuery (junk is a default, never stored raw)", async () => {
  upsertJobseekerProfile({ userId: null, profile: { displayName: "Ada" } as unknown as ProfilePayload, preferences: EMPTY_PREFERENCES }, DEFAULT_WORKSPACE_ID);
  const empty = (await (await get()).json()) as { design: unknown; cover: unknown };
  assert.equal(empty.design, null);
  assert.equal(empty.cover, null);

  const saved = await put({ design: { template: "editorial", accent: "plum", tailor: 1, compact: true, objective: false } });
  assert.equal(saved.status, 200);
  const back = (await (await get()).json()) as { design: Record<string, unknown>; designAt: string };
  assert.deepEqual(back.design, { template: "editorial", accent: "plum", tailor: 1, compact: true, objective: false });
  assert.match(back.designAt, /^\d{4}-/);

  await put({ design: { template: "<script>", accent: 42, tailor: -3, extra: "dropped" } });
  const junk = (await (await get()).json()) as { design: Record<string, unknown> };
  // Junk reads as the designer's DEFAULT (whatever it is today), never stored raw.
  const { template, accent, tailor, compact, objective } = CV_DESIGN_DEFAULT;
  assert.deepEqual(junk.design, { template, accent, tailor, compact, objective });

  const bad = await put({ design: "nope" });
  assert.equal(bad.status, 400);
  assert.equal(await codeOf(bad), "JOBSEEKER_REQUEST_INVALID");
});

test("a cover note is kept per posting, bounded, and only for a posting this workspace holds", async () => {
  const a = upsertPosting("src-a", raw("ext-a"), "2026-09-20T08:00:00.000Z").id;
  const b = upsertPosting("src-a", raw("ext-b"), "2026-09-20T08:00:00.000Z").id;

  assert.equal((await put({ posting: a, cover: "Dear team, A" })).status, 200);
  assert.equal((await put({ posting: b, cover: "Dear team, B" })).status, 200);
  const gotA = (await (await get(`?posting=${a}`)).json()) as { cover: { text: string; updatedAt: string } };
  assert.equal(gotA.cover.text, "Dear team, A");
  const gotB = (await (await get(`?posting=${b}`)).json()) as { cover: { text: string } };
  assert.equal(gotB.cover.text, "Dear team, B");
  const none = (await (await get()).json()) as { cover: unknown };
  assert.equal(none.cover, null, "no posting named, no cover read");

  const tooLong = await put({ posting: a, cover: "x".repeat(COVER_NOTE_MAX_CHARS + 1) });
  assert.equal(tooLong.status, 400);
  assert.equal(await codeOf(tooLong), "JOBSEEKER_REQUEST_INVALID");
  assert.equal(((await (await get(`?posting=${a}`)).json()) as { cover: { text: string } }).cover.text, "Dear team, A", "a refused save changes nothing");

  const foreign = upsertPosting("src-z", raw("ext-z"), "2026-09-20T08:00:00.000Z", "ws-other").id;
  const refused = await put({ posting: foreign, cover: "hi" });
  assert.equal(refused.status, 404);
  assert.equal(await codeOf(refused), "POSTING_NOT_FOUND");

  const wrongType = await put({ posting: a, cover: 12 });
  assert.equal(wrongType.status, 400);
});
