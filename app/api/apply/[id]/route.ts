import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createPipelineEntry, getJob, recordAutomationEvent, saveProfile } from "@/app/_lib/db";
import { buildApplyProfileDraft, buildApplyScript, KO_STEP_IDS } from "@/app/_lib/apply";
import { cleanupWorkdir, createWorkdir, spawnPython } from "@/app/_lib/python-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Normalize the captured answers into a saved CandidateProfileV2 (the same
// profile_cli path the Profile form uses). Returns the saved profile's id +
// archetype, or null if the build fails (the caller falls back to a label-only
// entry so applying never hard-errors).
async function buildApplicantProfile(
  job: ReturnType<typeof getJob>,
  answers: { name: string; experience: string; skills: string }
): Promise<{ id: string; archetype: string | null } | null> {
  if (!job) return null;
  let workdir: string | null = null;
  try {
    const { profile, signals } = buildApplyProfileDraft(job, answers);
    workdir = await createWorkdir();
    const inputPath = path.join(workdir, "intake.json");
    await writeFile(inputPath, JSON.stringify({ profile, signals }), "utf-8");
    const { result } = spawnPython(["-m", "pipeline.jobfit.profile_cli", "--input-json", inputPath]);
    const { stdout, exitCode } = await result;
    if (exitCode !== 0) return null;
    const data = JSON.parse(stdout) as {
      profile: Record<string, unknown>;
      archetype: string;
      completeness: number;
    };
    const saved = saveProfile({
      label: answers.name,
      archetype: data.archetype ?? null,
      roleFamily: (data.profile.roleFamily as string) ?? job.roleFamily ?? null,
      completeness: data.completeness ?? null,
      payload: data.profile,
    });
    return { id: saved.id, archetype: data.archetype ?? null };
  } catch {
    return null;
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}

// GET → the conversational apply script for a job (capture + KO questions).
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "Role not found." }, { status: 404 });
  return NextResponse.json({
    job: { id: job.id, title: job.title, company: job.company ?? null },
    steps: buildApplyScript(job),
  });
}

// POST → evaluate KO answers. Pass → create a Sourced pipeline entry; fail → a
// polite decline (no entry created).
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const job = getJob(id);
    if (!job) return NextResponse.json({ error: "Role not found." }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as { answers?: Record<string, unknown> };
    const answers = body.answers ?? {};

    // A "no" on any KO question declines the application.
    const failedKo = KO_STEP_IDS.some((k) => k in answers && answers[k] === false);
    if (failedKo) {
      return NextResponse.json({
        result: "declined",
        message:
          "Thanks for your interest! Based on your answers this role isn't the right fit right now, but we'd welcome a future application as our openings evolve.",
      });
    }

    const name = String(answers.name ?? "").trim() || "Applicant";
    const experience = String(answers.experience ?? "").trim();
    const skills = String(answers.skills ?? "").trim();

    // Build a real, matchable V2 candidate from the answers; fall back to a
    // label-only id if profile normalization isn't available.
    const built = await buildApplicantProfile(job, { name, experience, skills });
    const candidateId = built?.id ?? `apply-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const { entry } = createPipelineEntry({
      candidateId,
      candidateLabel: name,
      archetype: built?.archetype ?? "bau",
      roleFamily: job.roleFamily ?? null,
      jobId: job.id,
      jobTitle: job.title,
      stage: "Sourced",
    });
    recordAutomationEvent(entry.id, "applied", experience ? experience.slice(0, 160) : "via conversational apply");

    return NextResponse.json({
      result: "accepted",
      message:
        "You're in! Thanks for applying — a recruiter will review your profile and reach out about next steps shortly.",
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "apply failed" }, { status: 500 });
  }
}
