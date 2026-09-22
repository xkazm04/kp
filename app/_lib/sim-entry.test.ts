// resolveSimEntry is the ONE door a /api/sim/* route may read an entry by id through.
//
// The sim write doors (screen-draft, offer-draft, offer-link) are exempted from the
// capability ratchet because they "write only the demo corpus". They used to resolve
// ANY entry in the caller's team, so a viewer seat could overwrite a real candidate's
// pending approval with the sim's canned draft, or read a real candidate's live offer
// token. The (SIM) title marker is what separates the demo plane from the real one
// (the reset, the analytics filter and comms dispatch all key on it); this gate makes
// the sim doors honour it too.
//
// Real, throwaway DB: testing/unit-db.ts must stay the FIRST project import.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "@/app/_lib/testing/unit-db";
import { createPipelineEntry } from "@/app/_lib/db/pipeline";
import { markSimTitle } from "@/app/features/shell/simulation/constants";
import { resolveSimEntry } from "@/app/_lib/sim-entry";

after(() => cleanupUnitDb());

const TEAM = "team-sim-entry";
const OTHER_TEAM = "team-sim-entry-other";

function entryFor(candidateId: string, jobTitle: string, workspaceId: string): string {
  const { entry } = createPipelineEntry({
    candidateId,
    candidateLabel: `Candidate ${candidateId}`,
    jobId: `job-${candidateId}`,
    jobTitle,
    workspaceId,
    stage: "Offer",
  });
  return entry.id;
}

test("a (SIM)-marked entry in the caller's team resolves", () => {
  const id = entryFor("sim-own", markSimTitle("Backend Engineer"), TEAM);
  const entry = resolveSimEntry(id, TEAM);
  assert.ok(entry, "the demo row must resolve for its own team");
  assert.equal(entry.id, id);
  assert.equal(entry.workspaceId, TEAM);
});

test("a REAL (unmarked) active entry in the caller's own team does not resolve", () => {
  const id = entryFor("real-own", "Backend Engineer", TEAM);
  // Indistinguishable from a missing id: the route answers SIM_ENTRY_NOT_FOUND 404.
  assert.equal(resolveSimEntry(id, TEAM), null);
});

test("a (SIM) entry of ANOTHER team does not resolve (tenant scoping kept)", () => {
  const id = entryFor("sim-foreign", markSimTitle("Backend Engineer"), OTHER_TEAM);
  assert.equal(resolveSimEntry(id, TEAM), null);
  assert.ok(resolveSimEntry(id, OTHER_TEAM), "precondition: it resolves for its owner");
});

test("an unknown id does not resolve", () => {
  assert.equal(resolveSimEntry("no-such-entry", TEAM), null);
});
