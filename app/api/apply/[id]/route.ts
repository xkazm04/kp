import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createPipelineEntry, getJob, recordAutomationEvent, saveProfile } from "@/app/_lib/db";
import { buildApplyProfileDraft, buildApplyScript, KO_STEP_IDS } from "@/app/_lib/apply";
import { cleanupWorkdir, createWorkdir, parsePythonJson, spawnPython } from "@/app/_lib/python-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Outcome of normalizing an application into a matchable profile. On failure we
// carry a short, bounded `reason` (not just null) so the caller can persist it
// on the pipeline entry — turning the silent demotion into a recruiter-visible
// "needs manual capture" signal instead of a server-log-only event.
type BuildOutcome =
  | { ok: true; id: string; archetype: string | null }
  | { ok: false; reason: string };

const DEGRADED_REASON_MAX = 280;

// Keep the persisted reason short and single-line: it lands in a DB column and a
// compact recruiter UI, and raw Python stderr can be huge/multiline.
function degradedReason(detail: string): string {
  const oneLine = detail.replace(/\s+/g, " ").trim() || "intake normalization failed";
  return oneLine.length > DEGRADED_REASON_MAX ? `${oneLine.slice(0, DEGRADED_REASON_MAX - 1)}…` : oneLine;
}

// Normalize the captured answers into a saved CandidateProfileV2 (the same
// profile_cli path the Profile form uses). Returns the saved profile's id +
// archetype on success, or a failure reason — the caller falls back to a
// label-only entry (flagged intake-degraded) so applying never hard-errors.
async function buildApplicantProfile(
  job: ReturnType<typeof getJob>,
  answers: { name: string; experience: string; skills: string; archetype?: string }
): Promise<BuildOutcome> {
  if (!job) return { ok: false, reason: degradedReason("role not found at intake") };
  let workdir: string | null = null;
  try {
    const { profile, signals } = buildApplyProfileDraft(job, answers);
    workdir = await createWorkdir();
    const inputPath = path.join(workdir, "intake.json");
    await writeFile(inputPath, JSON.stringify({ profile, signals }), "utf-8");
    const { result } = spawnPython(["-m", "pipeline.jobfit.profile_cli", "--input-json", inputPath]);
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      // Surface the failing exit code plus the tail of stderr (the most likely
      // line to name the cause) so the recruiter signal is diagnosable.
      const tail = stderr.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? "";
      return {
        ok: false,
        reason: degradedReason(`profile normalization exited ${exitCode}${tail ? `: ${tail}` : ""}`),
      };
    }
    // Parse the result JSON line via parsePythonJson (which scans from the end
    // for the first object/array), not the whole buffer: a stray warning/
    // deprecation/print or trailing interpreter shutdown line would otherwise
    // make JSON.parse throw and silently demote the applicant to a label-only,
    // non-matchable stub.
    const data = parsePythonJson<{
      profile: Record<string, unknown>;
      archetype: string;
      completeness: number;
    }>(stdout, stderr);
    const saved = saveProfile({
      label: answers.name,
      archetype: data.archetype ?? null,
      roleFamily: (data.profile.roleFamily as string) ?? job.roleFamily ?? null,
      completeness: data.completeness ?? null,
      payload: data.profile,
    });
    return { ok: true, id: saved.id, archetype: data.archetype ?? null };
  } catch (err) {
    // Don't swallow silently: a failed build demotes the applicant to a
    // label-only, non-matchable stub, so make that degradation visible — both in
    // the server log and (via the returned reason) on the recruiter's board.
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[apply] buildApplicantProfile failed for job ${job.id}; falling back to a non-matchable stub:`,
      message,
    );
    return { ok: false, reason: degradedReason(message) };
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

// POST → evaluate KO answers. Pass → create an Accepted pipeline entry; fail → a
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
    const archetype = String(answers.archetype ?? "").trim();

    // Build a real, matchable V2 candidate from the answers; on failure fall back
    // to a label-only id AND flag the entry intake-degraded so the recruiter sees
    // a stub that needs manual profile capture (rather than a silent demotion).
    const built = await buildApplicantProfile(job, { name, experience, skills, archetype });
    const candidateId = built.ok ? built.id : `apply-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const { entry } = createPipelineEntry({
      candidateId,
      candidateLabel: name,
      archetype: built.ok ? built.archetype ?? "bau" : "bau",
      roleFamily: job.roleFamily ?? null,
      jobId: job.id,
      jobTitle: job.title,
      stage: "Accepted",
      intakeDegraded: !built.ok,
      intakeDegradedReason: built.ok ? null : built.reason,
    });
    // createPipelineEntry already logs an `intake_degraded` event for the stub; for
    // a healthy intake record the usual `applied` provenance.
    if (built.ok) {
      recordAutomationEvent(entry.id, "applied", experience ? experience.slice(0, 160) : "via conversational apply");
    }

    return NextResponse.json({
      result: "accepted",
      message:
        "You're in! Thanks for applying — a recruiter will review your profile and reach out about next steps shortly.",
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "apply failed" }, { status: 500 });
  }
}
