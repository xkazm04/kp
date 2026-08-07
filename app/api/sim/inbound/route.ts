import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/app/_lib/db/jobs";
import { createPipelineEntry, listPipeline } from "@/app/_lib/db/pipeline";
import { listMatrixProfiles } from "@/app/_lib/db/profiles";
import { simCvIntakeTarget } from "@/app/_lib/cv-intake";
import { inferProfileLocale } from "@/app/_lib/comms-locale";
import { jsonError } from "@/app/_lib/api-response";
import { SIM_SCREEN_POLICY } from "@/app/features/shell/simulation/constants";


// Simulate an inbound application arriving via a channel (the careers/apply page):
// a candidate lands at "Accepted" — the new pipeline front for inbound apps.
//
// TENANT ISOLATION (comms-tenancy-pair) — this was the one UN-tenanted sim write. The
// route reads no session, so listPipeline/createPipelineEntry silently defaulted to
// DEFAULT_WORKSPACE_ID and stamped the REAL, unmarked job title: a demo applicant became
// a permanent, analytics-counted, un-purgeable row in a workspace the recruiter who
// pressed the button (on the Channels tab) may not even be looking at. It now makes the
// SAME write-scoping decision as its sibling /api/sim/apply-cv, through the SAME helper —
// simCvIntakeTarget: the sim/demo workspace plus a `(SIM)`-marked title, which is both
// the resetSim purge key and the analytics read-side exclusion. Pinned by
// sim-inbound-scope.test.ts (and, for the helper's guarantees, cv-intake-sim-scope.test.ts).
export async function POST(request: NextRequest) {
  try {
    const { jobId } = (await request.json()) as { jobId?: string };
    if (!jobId) return NextResponse.json({ error: "jobId is required." }, { status: 400 });
    const job = getJob(jobId);
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    // The sim write target — the demo workspace + the `(SIM)`-marked title.
    const target = simCvIntakeTarget(job);

    // Pick someone not already in this job's pipeline as the "applicant". Read from the
    // SAME workspace we're about to write into, or the dedupe check looks at a different
    // board than the one that gains the row.
    const inPipeline = new Set(
      listPipeline(target.workspaceId).filter((e) => e.jobId === jobId).map((e) => e.candidateId)
    );
    const applicant = listMatrixProfiles(200).find((p) => !inPipeline.has(p.id));
    if (!applicant) return NextResponse.json({ error: "No available applicant." }, { status: 404 });

    // Deterministic mid score so the inbound applicant survives screening (demo).
    // The floor is single-sourced + invariant-checked against the screen reject
    // ceiling in SIM_SCREEN_POLICY (simulation/constants.ts) — keep it there, not
    // as a literal here, or the two coupled numbers drift apart silently.
    const score = SIM_SCREEN_POLICY.inboundScoreFloor + (applicant.id.charCodeAt(applicant.id.length - 1) % 10);
    const { entry } = createPipelineEntry({
      candidateId: applicant.id,
      candidateLabel: applicant.label,
      archetype: applicant.archetype,
      roleFamily: job.roleFamily ?? null,
      jobId,
      jobTitle: target.jobTitle,
      workspaceId: target.workspaceId,
      matchScore: score,
      stage: "Accepted",
      // The simulated applicant is a seeded profile — infer their language from
      // the profile's CV languages so demo comms render like real inbound ones.
      locale: inferProfileLocale(applicant.id),
    });
    // `jobTitle` is the MARKED title actually stored (visibly a sim row), mirroring
    // /api/sim/apply-cv's response so the Channels note can say where it landed.
    return NextResponse.json({ ok: true, label: applicant.label, score, entryId: entry.id, jobTitle: target.jobTitle });
  } catch (error) {
    return jsonError(error, "Inbound failed.");
  }
}
