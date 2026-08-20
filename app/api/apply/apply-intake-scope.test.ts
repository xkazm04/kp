// Three invariants the PUBLIC conversational apply POST has to hold that nothing
// else on the route was watching. All three were live defects:
//
//  1. TENANCY — the route stamps the opening's workspace on the pipeline entry but
//     called buildApplicantProfile WITHOUT it, so the profile row was saved into the
//     DEFAULT workspace. For any job owned by a non-default team that means: the
//     recruiter opens the applicant they just received and finds no profile behind
//     them, the Match pool never sees the candidate, and the gap follow-up POST 404s
//     (apply/[id]/followup reads getProfileRecord(profileId, getJobWorkspace(job.id))
//     — a lookup that can only find a row saved under that same tenant). The tenant is
//     a CALLER argument on purpose (see the note on buildApplicantProfile), so only a
//     check here can catch its omission.
//
//  2. AXIS — the stage was the literal string "Accepted". The axis is editable, so the
//     moment a team renamed or removed its first column every conversational applicant
//     landed off-axis (PipelineBoardOffAxisStrip) while quick-apply leads and CV intake,
//     which both resolve stageWithRole("entry", …), landed correctly.
//
//  3. KO AUDIT — the knockout decline persists the applicant's name on an entry-less
//     ko_declined event, and pipeline_events bounds the event DETAIL but not the
//     candidate_label. The route's MAX_NAME_LENGTH check sat BELOW the KO gate, so a
//     declined POST wrote a body-sized name straight into the recruiter's feed.
//
// Source-contract test (the repo pattern — see apply-error-hygiene.test.ts):
// importing the route pulls in `next/server`, which the unit runner cannot resolve.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(HERE, rel), "utf8");
const route = read("[id]/route.ts");

test("both profile builds are filed into the SAME workspace the entry is stamped with", () => {
  assert.match(
    route,
    /const built = await buildApplicantProfile\(job, intakeAnswers, null, workspaceId\)/,
    "the first-apply build must pass the opening's workspace"
  );
  assert.match(
    route,
    /const rebuilt = await buildApplicantProfile\(job, intakeAnswers, existing\.candidateId, workspaceId\)/,
    "the re-apply rebuild must pass it too"
  );
  // The buggy forms, forbidden explicitly: an omitted tenant is silent (the
  // parameter is optional), so only banning the shape keeps it from coming back.
  assert.ok(
    !/buildApplicantProfile\(job, intakeAnswers\)/.test(route),
    "a tenant-less build saves the profile into the DEFAULT workspace"
  );
  assert.ok(
    !/buildApplicantProfile\(job, intakeAnswers, existing\.candidateId\)/.test(route),
    "a tenant-less rebuild saves the profile into the DEFAULT workspace"
  );
  // The entry it belongs to is stamped with that same value.
  assert.match(route, /const workspaceId = getJobWorkspace\(id\)/);
});

test("a fresh application lands on the workspace axis's ENTRY column, not a hardcoded name", () => {
  assert.match(
    route,
    /stage: stageWithRole\("entry", getPipelineAxis\(workspaceId\)\.stages\) \?\? "Accepted"/,
    "the conversational apply must resolve its landing column from the axis"
  );
  assert.ok(!/stage: "Accepted",/.test(route), "the hardcoded landing stage strands applicants off-axis");
  // Non-vacuity: this is the shared intake idiom, not a shape invented here — the
  // other two inbound surfaces already use it.
  for (const rel of ["../../_lib/lead-intake.ts", "../../_lib/cv-intake.ts"]) {
    assert.match(read(rel), /stageWithRole\("entry", getPipelineAxis\(workspaceId\)\.stages\) \?\? "Accepted"/, rel);
  }
});

test("the name cap runs BEFORE the knockout decline persists that name", () => {
  const capAt = route.indexOf("if (name.length > MAX_NAME_LENGTH)");
  const declineAt = route.indexOf("recordKnockoutDecline({");
  assert.ok(capAt > 0, "the name cap exists");
  assert.ok(declineAt > 0, "the KO audit write exists");
  assert.ok(capAt < declineAt, "an oversized name must be rejected before it is written to the audit event");
  // …and the audit reuses the already-capped value rather than re-reading the raw body.
  assert.match(route, /candidateLabel: providedName \|\| null/);
  assert.ok(
    !/candidateLabel: String\(answers\.name/.test(route),
    "re-parsing the raw name here bypasses the cap above"
  );
  // Non-vacuity: the store bounds the event DETAIL but not the label, which is why
  // the cap has to happen on this side of the call.
  const pipelineSrc = read("../../_lib/db/pipeline.ts");
  assert.match(pipelineSrc, /KO_DECLINE_DETAIL_MAX/, "the detail is bounded…");
  assert.ok(
    /candidateLabel: \(input\.candidateLabel \?\? ""\)\.trim\(\) \|\| null/.test(pipelineSrc),
    "…while the candidate label is passed through unbounded"
  );
});
