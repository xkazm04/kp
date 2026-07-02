// Handler-level coverage for the onboarding route family against an ISOLATED
// throwaway DB (testing/unit-db.ts must stay the first project import):
//   /api/onboarding                    — recruiter hand-off list + start-run/create-template
//   /api/onboarding/[id]               — run detail + checklist PATCH
//   /api/onboarding/candidate/[token]  — the PUBLIC token-gated candidate bridge
// Pins the gates a regression would silently break: only Hired candidates can be
// onboarded, only an ACCEPTED offer token resolves, and candidate answers are
// filtered to the template's own questionnaire keys.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { GET as recruiterGet, POST as recruiterPost } from "./route.ts";
import { GET as runGet, PATCH as runPatch } from "./[id]/route.ts";
import { GET as candidateGet, POST as candidatePost } from "./candidate/[token]/route.ts";
import { createPipelineEntry } from "../../_lib/db/pipeline.ts";
import { createOffer } from "../../_lib/offers-store.ts";
import { respondToOffer } from "../../_lib/offer-finalize.ts";
import { getRunDetail, runForEntry } from "../../_lib/onboarding-store.ts";

after(() => cleanupUnitDb());

function jsonRequest(url: string, method: "POST" | "PATCH", body: unknown): NextRequest {
  return new NextRequest(url, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}
const tokenParams = (token: string) => ({ params: Promise.resolve({ token }) });
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

// Shared fixture: a candidate hired through the REAL accept flow, so the
// accepted offer token doubles as the onboarding credential (offers #5).
let seq = 0;
async function hiredFixture() {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `onb-c${seq}`,
    candidateLabel: `Onboarding Candidate ${seq}`,
    jobId: `onb-job-${seq}`,
    jobTitle: "Onboarding Role",
    stage: "Offer",
    contact: `onb-c${seq}@example.com`,
  });
  const offer = createOffer({
    entryId: entry.id,
    candidateLabel: entry.candidateLabel,
    jobId: null,
    jobTitle: entry.jobTitle,
    currency: null,
    salary: null,
    payload: {},
  });
  const accepted = await respondToOffer(offer.token, "accept");
  assert.ok(accepted.ok);
  return { entry, token: offer.token };
}

test("recruiter GET lists the Hired candidate with its auto-started run + templates", async () => {
  const { entry } = await hiredFixture();
  const res = await recruiterGet();
  assert.equal(res.status, 200);
  const body = await res.json();
  const hired = (body.hired as Array<{ entryId: string; runId: string | null }>).find((h) => h.entryId === entry.id);
  assert.ok(hired, "the hire appears in the hand-off list");
  assert.equal(hired!.runId, runForEntry(entry.id)!.id, "the accept-started run is linked");
  assert.ok(Array.isArray(body.templates) && body.templates.length >= 1);
});

test("recruiter POST guards: missing entryId → 400; non-Hired entry → 409; nameless template → 400", async () => {
  const { entry: screened } = createPipelineEntry({
    candidateId: "onb-screened",
    candidateLabel: "Still Screening",
    jobId: "onb-job-screened",
    jobTitle: "Onboarding Role",
  });

  const missing = await recruiterPost(jsonRequest("http://localhost/api/onboarding", "POST", {}));
  assert.equal(missing.status, 400);

  const notHired = await recruiterPost(
    jsonRequest("http://localhost/api/onboarding", "POST", { entryId: screened.id })
  );
  assert.equal(notHired.status, 409);
  assert.match((await notHired.json()).error, /Hired/);

  const badTemplate = await recruiterPost(
    jsonRequest("http://localhost/api/onboarding", "POST", { action: "create_template", name: "  " })
  );
  assert.equal(badTemplate.status, 400);
});

test("recruiter POST create_template coerces tasks and returns the stored template", async () => {
  const res = await recruiterPost(
    jsonRequest("http://localhost/api/onboarding", "POST", {
      action: "create_template",
      name: "  Engineering onboarding  ",
      tasks: [{ id: "laptop", label: " Order laptop " }, { label: "" }, "junk"],
    })
  );
  assert.equal(res.status, 200);
  const { template } = await res.json();
  assert.equal(template.name, "Engineering onboarding");
  assert.deepEqual(template.tasks, [{ id: "laptop", label: "Order laptop" }]);
});

test("run detail GET/PATCH: checklist toggling flows through the route; unknown run → 404", async () => {
  const { entry } = await hiredFixture();
  const runId = runForEntry(entry.id)!.id;

  const detailRes = await runGet(new NextRequest(`http://localhost/api/onboarding/${runId}`), idParams(runId));
  assert.equal(detailRes.status, 200);
  const detail = await detailRes.json();
  assert.ok(detail.tasks.length > 0);

  const taskId = detail.tasks[0].id as string;
  const patched = await runPatch(
    jsonRequest(`http://localhost/api/onboarding/${runId}`, "PATCH", { action: "task", taskId, done: true }),
    idParams(runId)
  );
  assert.equal(patched.status, 200);
  const after_ = await patched.json();
  assert.ok(after_.states.some((s: { taskId: string; done: boolean }) => s.taskId === taskId && s.done));

  const badAction = await runPatch(
    jsonRequest(`http://localhost/api/onboarding/${runId}`, "PATCH", { action: "nonsense" }),
    idParams(runId)
  );
  assert.equal(badAction.status, 400);

  const missing = await runGet(new NextRequest("http://localhost/api/onboarding/obr-nope"), idParams("obr-nope"));
  assert.equal(missing.status, 404);
});

test("candidate GET: an accepted offer token resolves the questionnaire; unknown or still-open tokens → 404", async () => {
  const { entry, token } = await hiredFixture();
  const res = await candidateGet(new NextRequest(`http://localhost/api/onboarding/candidate/${token}`), tokenParams(token));
  assert.equal(res.status, 200);
  const { onboarding } = await res.json();
  assert.equal(onboarding.candidateLabel, entry.candidateLabel);
  assert.ok(onboarding.fields.length > 0, "the template questionnaire is presented");
  assert.equal(onboarding.submitted, false);

  const unknown = await candidateGet(new NextRequest("http://localhost/api/onboarding/candidate/tk-nope"), tokenParams("tk-nope"));
  assert.equal(unknown.status, 404);

  // A NOT-yet-accepted offer token must not open the onboarding bridge.
  const { entry: pending } = createPipelineEntry({
    candidateId: "onb-pending",
    candidateLabel: "Pending Candidate",
    jobId: "onb-job-pending",
    jobTitle: "Onboarding Role",
    stage: "Offer",
  });
  const openOffer = createOffer({
    entryId: pending.id,
    candidateLabel: pending.candidateLabel,
    jobId: null,
    jobTitle: pending.jobTitle,
    currency: null,
    salary: null,
    payload: {},
  });
  const gated = await candidateGet(
    new NextRequest(`http://localhost/api/onboarding/candidate/${openOffer.token}`),
    tokenParams(openOffer.token)
  );
  assert.equal(gated.status, 404);
});

test("candidate POST keeps only the template's own questionnaire keys and marks the intake submitted", async () => {
  const { entry, token } = await hiredFixture();
  const res = await candidatePost(
    jsonRequest(`http://localhost/api/onboarding/candidate/${token}`, "POST", {
      answers: { preferredName: "Alex", notAQuestionnaireKey: "injected", tshirtSize: "M" },
    }),
    tokenParams(token)
  );
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);

  const intake = getRunDetail(runForEntry(entry.id)!.id)!.intake!;
  assert.equal(intake.preferredName, "Alex");
  assert.equal(intake.tshirtSize, "M");
  assert.equal("notAQuestionnaireKey" in intake, false, "unknown keys are filtered at the trust boundary");

  // A non-accepted token can't write either.
  const blocked = await candidatePost(
    jsonRequest("http://localhost/api/onboarding/candidate/tk-nope", "POST", { answers: { preferredName: "Mallory" } }),
    tokenParams("tk-nope")
  );
  assert.equal(blocked.status, 404);
});
