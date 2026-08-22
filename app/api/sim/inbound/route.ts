import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/app/_lib/db/jobs";
import { createPipelineEntry, listPipeline } from "@/app/_lib/db/pipeline";
import { listMatrixProfiles } from "@/app/_lib/db/profiles";
import { simCvIntakeTarget } from "@/app/_lib/cv-intake";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { getPipelineAxis } from "@/app/_lib/pipeline-axis-server";
import { stageWithRole } from "@/app/_lib/pipeline-stages";
import { inferProfileLocale } from "@/app/_lib/comms-locale";
import { jsonError } from "@/app/_lib/api-response";
import { SIM_SCREEN_POLICY } from "@/app/features/shell/simulation/constants";


// Simulate an inbound application arriving via a channel (the careers/apply page):
// a candidate lands at "Accepted" — the new pipeline front for inbound apps.
//
// TENANT ISOLATION (comms-tenancy-pair) — this was the one UN-tenanted sim write. It
// makes the SAME write-scoping decision as its sibling /api/sim/apply-cv, through the
// SAME helper — simCvIntakeTarget: the CALLER'S team plus a `(SIM)`-marked title, which
// is both the resetSim purge key and the analytics read-side exclusion. The caller's
// team comes from the session (this route is operator-side; the public guided demo
// reaches it with the isolated "demo" workspace session /api/demo mints), which is what
// makes the demo work at all — a team pressed "Receive a test application", the row went
// to the DEFAULT team's board, and the walk's own correctly-scoped /api/pipeline read
// came back empty and halted on error.noScreened. Pinned by sim-inbound-scope.test.ts
// (and, for the helper's guarantees, cv-intake-sim-scope.test.ts).
export async function POST(request: NextRequest) {
  try {
    const { jobId } = (await request.json()) as { jobId?: string };
    if (!jobId) return NextResponse.json({ error: "jobId is required." }, { status: 400 });
    const job = getJob(jobId);
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    // The sim write target — the caller's own team + the `(SIM)`-marked title.
    const target = simCvIntakeTarget(job, await currentWorkspace());

    // Pick someone not already in this job's pipeline as the "applicant". Read the pool
    // AND the dedupe set from the SAME workspace we're about to write into: an unscoped
    // pool handed the caller a stranger's candidate (their real name and archetype copied
    // onto this board), and the dedupe check would be looking at a different board than
    // the one that gains the row. This is also the pool the preceding "source into
    // pipeline" step drew from (/api/jobs/[id]/publish resolves currentWorkspace too), so
    // the two demo steps now agree on who exists.
    const inPipeline = new Set(
      listPipeline(target.workspaceId).filter((e) => e.jobId === jobId).map((e) => e.candidateId)
    );
    const applicant = listMatrixProfiles(200, target.workspaceId).find((p) => !inPipeline.has(p.id));
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
      // The board's ENTRY column, resolved from the target workspace's own axis by
      // ROLE — not the literal "Accepted", which is only that column's name on the
      // shipped board. Settings → Hiring composes the axis per workspace (stage ids
      // are free-form, and createPipelineEntry validates nothing), so a team that
      // renamed its first column got this row filed onto a stage its board does not
      // render: the Channels tab claimed "Filed at Accepted", the row was stranded
      // off-axis, and the Waiting stat — which resolves the entry stage by role —
      // never moved. Same seam as its sibling /api/sim/apply-cv (cv-intake.ts).
      stage: stageWithRole("entry", getPipelineAxis(target.workspaceId).stages) ?? "Accepted",
      // The simulated applicant is a seeded profile — infer their language from
      // the profile's CV languages so demo comms render like real inbound ones.
      locale: inferProfileLocale(applicant.id, target.workspaceId),
    });
    // `jobTitle` is the MARKED title actually stored (visibly a sim row), mirroring
    // /api/sim/apply-cv's response so the Channels note can say where it landed.
    return NextResponse.json({ ok: true, label: applicant.label, score, entryId: entry.id, jobTitle: target.jobTitle });
  } catch (error) {
    return jsonError(error, "Inbound failed.");
  }
}
