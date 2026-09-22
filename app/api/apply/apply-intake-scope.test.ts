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
//     which both resolve stageWithRole("entry", …), landed correctly. All doors now file
//     through application-filing.ts, which holds the one copy of that rule.
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

test("conversational apply drops a filled honeypot before any candidate write", () => {
  const dropAt = route.indexOf("if (isHoneypotFilled(body))");
  const firstWriteAt = route.indexOf("recordKnockoutDecline({");
  assert.ok(dropAt > 0 && dropAt < firstWriteAt, "the bot gate must precede even knockout audit writes");
  assert.match(route.slice(dropAt, route.indexOf("const answers = body.answers", dropAt)), /result: "declined"/);
  assert.match(read("[id]/quick/route.ts"), /if \(isHoneypotFilled\(body\)\)/);
});

test("both profile builds are filed into the SAME workspace the entry is stamped with", () => {
  // Since challenge 2026-09-22 candidate-apply-api/A the route files through the shared
  // core (application-filing.ts), which owns BOTH builds — the first-apply build and the
  // proven merge's rebuild — for every door. The route's half of the invariant is that
  // it hands the core the opening's workspace; the core's half is that every build it
  // makes passes that workspace (and the applicant's locale) through.
  assert.match(route, /const workspaceId = getJobWorkspace\(id\)/, "the opening's team");
  assert.match(
    route,
    /const filed = await fileApplication\(\{\s*job,\s*workspaceId,/,
    "the route files through the core, carrying the opening's workspace"
  );
  const core = read("../../_lib/application-filing.ts");
  assert.match(
    core,
    /built = await build\(job, answers, null, workspaceId, locale\)/,
    "the first-apply build must pass the entry's workspace"
  );
  assert.match(
    core,
    /rebuilt = await build\(job, answers, existing\.candidateId, workspaceId, locale\)/,
    "the re-apply rebuild must pass it too"
  );
  // The buggy forms, forbidden explicitly: an omitted tenant is silent (the
  // parameter is optional), so only banning the shape keeps it from coming back —
  // in the core, and in the route, which must not build on its own at all.
  assert.ok(!/build\(job, answers\)/.test(core), "a tenant-less build saves the profile into the DEFAULT workspace");
  assert.ok(!/build\(job, answers, existing\.candidateId\)/.test(core), "a tenant-less rebuild saves the profile into the DEFAULT workspace");
  assert.ok(!/buildApplicantProfile\(/.test(route), "a route-side build bypasses the core's tenant threading");
  // The entry the profile belongs to is stamped with that same value.
  assert.match(core, /const workspaceId = input\.workspaceId \?\? getJobWorkspace\(job\.id\)/);
});

test("a fresh application lands on the workspace axis's ENTRY column, not a hardcoded name", () => {
  // The rule lives ONCE, in the filing core every door files through; no door keeps a
  // copy (the card counted three before: this route, lead-intake.ts, cv-intake.ts).
  const rule = /stage: stageWithRole\("entry", getPipelineAxis\(workspaceId\)\.stages\) \?\? "Accepted"/g;
  const core = read("../../_lib/application-filing.ts");
  assert.equal((core.match(rule) ?? []).length, 1, "the core resolves the landing column from the axis");
  assert.match(route, /await fileApplication\(\{/, "the conversational apply files through the core that owns the rule");
  for (const rel of ["[id]/route.ts", "../../_lib/lead-intake.ts", "../../_lib/cv-intake.ts", "../../_lib/application-filing.ts"]) {
    // The old defect, forbidden on every door and in the core: a hardcoded landing
    // stage strands applicants off-axis the moment a team renames its first column.
    assert.ok(!/stage: "Accepted",/.test(read(rel)), `${rel}: the hardcoded landing stage strands applicants off-axis`);
  }
  for (const rel of ["[id]/route.ts", "../../_lib/lead-intake.ts", "../../_lib/cv-intake.ts"]) {
    assert.equal((read(rel).match(rule) ?? []).length, 0, `${rel} keeps no private copy of the entry-stage rule`);
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
