// The CV-memory doors on an isolated DB, in open auth mode (unit-db.ts scrubs the
// password, so the seeker is the workspace's null user): an import is recorded and made
// active, the same text dropped again is REUSED without a draft, the list carries no
// text, "Use this one" switches the profile, and another seeker's id is 404.
//
// unit-db.ts must be the first project import (it sets KP_DB_PATH before any store opens).
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { recordJobseekerCv } from "../../../_lib/db/jobseeker-cvs.ts";
import { getJobseekerProfile } from "../../../_lib/db/jobseeker-profiles.ts";
import { DEFAULT_WORKSPACE_ID } from "../../../_lib/db/workspaces.ts";
import type { JobseekerCvListItem, JobseekerProfile } from "../../../_lib/jobseeker/types.ts";
import type { ProfilePayload } from "../../../features/shared/profileTypes.ts";
import { GET, POST } from "./route.ts";
import { POST as REUSE } from "./reuse/route.ts";
import { POST as USE } from "./[id]/use/route.ts";

after(() => cleanupUnitDb());

const here = path.dirname(fileURLToPath(import.meta.url));
const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const record = (body: unknown) => POST(new Request("http://localhost/api/jobseeker/cvs", json(body)));
const reuse = (text: string) => REUSE(new Request("http://localhost/api/jobseeker/cvs/reuse", json({ text })));
const use = (id: string) => USE(new Request(`http://localhost/api/jobseeker/cvs/${id}/use`, { method: "POST" }), { params: Promise.resolve({ id }) });
const list = async () => ((await (await GET(new Request("http://localhost/api/jobseeker/cvs"))).json()) as { cvs: JobseekerCvListItem[] }).cvs;
/** Timestamps are ISO milliseconds: a tick apart keeps "newest use first" unambiguous. */
const tick = () => new Promise((r) => setTimeout(r, 5));
const nameOf = (p: JobseekerProfile) => (p.profile as unknown as { displayName?: string }).displayName;

type Recorded = { profile: JobseekerProfile; cv: JobseekerCvListItem };

let firstId = "";
let secondId = "";

test("POST records an import, makes it the profile, and answers the list row", async () => {
  const res = await record({ text: "Ada Lovelace\nAnalyst", profile: { displayName: "Ada" }, draftSource: "llm", fileName: "ada.pdf", byteSize: 2048 });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Recorded;
  firstId = body.cv.id;
  assert.equal(nameOf(body.profile), "Ada");
  assert.equal(body.profile.cvSourceText, "Ada Lovelace\nAnalyst");
  assert.deepEqual(Object.keys(body.cv).sort(), ["active", "byteSize", "createdAt", "draftSource", "fileName", "id", "lastUsedAt"]);
  assert.equal(body.cv.active, true);
  assert.equal(body.cv.fileName, "ada.pdf");
  assert.equal(body.cv.draftSource, "llm");
  assert.equal(nameOf(getJobseekerProfile(null, DEFAULT_WORKSPACE_ID)!), "Ada");
});

test("POST refuses a body with no text or no draft, by code", async () => {
  const noText = await record({ text: "  ", profile: { displayName: "x" } });
  assert.equal(noText.status, 400);
  assert.equal(((await noText.json()) as { code: string }).code, "INTAKE_TEXT_REQUIRED");
  const noDraft = await record({ text: "Some CV" });
  assert.equal(noDraft.status, 400);
  assert.equal(((await noDraft.json()) as { code: string }).code, "JOBSEEKER_REQUEST_INVALID");
});

test("reuse: a text never read answers reused:false and writes nothing", async () => {
  const before = getJobseekerProfile(null, DEFAULT_WORKSPACE_ID)!;
  const res = await reuse("A CV nobody dropped before");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { reused: false });
  assert.equal(getJobseekerProfile(null, DEFAULT_WORKSPACE_ID)!.updatedAt, before.updatedAt);
});

test("a second CV, then the first dropped again (whitespace moved) is reused with its stored draft", async () => {
  const second = (await (await record({ text: "Grace Hopper\nAdmiral", profile: { displayName: "Grace" }, draftSource: "deterministic", fileName: "grace.docx" })).json()) as Recorded;
  secondId = second.cv.id;
  assert.equal(nameOf(second.profile), "Grace");

  await tick();
  const res = await reuse("  Ada   Lovelace Analyst \n");
  assert.equal(res.status, 200);
  const body = (await res.json()) as Recorded & { reused: boolean };
  assert.equal(body.reused, true);
  assert.equal(body.cv.id, firstId);
  assert.equal(body.cv.draftSource, "llm", "the stored reader is reported, so the page claims what really read it");
  assert.equal(nameOf(body.profile), "Ada", "the stored draft is applied");
  assert.equal(body.profile.cvSourceText, "Ada Lovelace\nAnalyst", "the stored text, not a second copy");
  assert.equal(nameOf(getJobseekerProfile(null, DEFAULT_WORKSPACE_ID)!), "Ada");
});

test("the reuse door has no path to a draft: its source reaches neither the model run nor the engine", () => {
  const code = readFileSync(path.join(here, "reuse", "route.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const banned of ["profile-draft-run", "runProfileDraft", "python-runner", "spawnPython", "jobseeker-run", "profile/draft"]) {
    assert.ok(!code.includes(banned), `reuse/route.ts must not reach ${banned}`);
  }
  // Non-vacuity: the draft door itself does reach it, so the probe can see an import.
  const draftDoor = readFileSync(path.join(here, "..", "..", "profile", "draft", "route.ts"), "utf8");
  assert.ok(draftDoor.includes("profile-draft-run"));
});

test("GET lists newest use first, metadata only, with the active one marked", async () => {
  const cvs = await list();
  assert.deepEqual(cvs.map((c) => c.id), [firstId, secondId]);
  assert.deepEqual(cvs.map((c) => c.active), [true, false]);
  for (const cv of cvs) {
    for (const heavy of ["sourceText", "draft", "contentHash", "source_text", "draft_json"]) assert.ok(!(heavy in cv), `${heavy} never ships on the list`);
  }
});

test("use: an earlier CV becomes the profile, and it moves to the top of the list", async () => {
  await tick();
  const res = await use(secondId);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Recorded;
  assert.equal(nameOf(body.profile), "Grace");
  assert.equal(body.cv.active, true);
  const cvs = await list();
  assert.deepEqual(cvs.map((c) => c.id), [secondId, firstId]);
  assert.deepEqual(cvs.map((c) => c.active), [true, false]);
});

test("use: another seeker's id and another workspace's id are 404, and change nothing", async () => {
  const seat = recordJobseekerCv({ userId: "u-other", sourceText: "Someone else", draft: { displayName: "Other" } as unknown as ProfilePayload, draftSource: "llm" }, DEFAULT_WORKSPACE_ID);
  const elsewhere = recordJobseekerCv({ userId: null, sourceText: "Other team", draft: { displayName: "Team" } as unknown as ProfilePayload, draftSource: "llm" }, "ws-elsewhere");
  for (const id of [seat.id, elsewhere.id, "jscv-nope"]) {
    const res = await use(id);
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as { code: string }).code, "JOBSEEKER_CV_NOT_FOUND");
  }
  assert.equal(nameOf(getJobseekerProfile(null, DEFAULT_WORKSPACE_ID)!), "Grace");
  assert.ok(!(await list()).some((c) => c.id === seat.id || c.id === elsewhere.id), "nor are they listed");
});
