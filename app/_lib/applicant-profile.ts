import path from "node:path";
import { writeFile } from "node:fs/promises";
import { buildApplyProfileDraft } from "@/app/_lib/apply";
import type { ApplyAnswers } from "@/app/_lib/apply-intake";
import { cleanupWorkdir, createWorkdir, parsePythonJson, spawnPython } from "@/app/_lib/python-runner";
import { validateProfileCliResult } from "@/app/_lib/apply-profile-result";
import { getJob, saveProfile, updateProfile } from "@/app/_lib/db";

// Turn captured intake answers (or an extracted CV) into a saved, matchable
// CandidateProfileV2 via the deterministic profile_cli normalizer — the same path
// the conversational apply form and the Profile page use. Extracted here so BOTH
// the apply route and the headless CV-intake path (channels/sim) build candidates
// identically instead of one drifting from the other.

// Outcome of normalizing an application into a matchable profile. On failure we
// carry a short, bounded `reason` (not just null) so the caller can persist it on
// the pipeline entry — turning the silent demotion into a recruiter-visible "needs
// manual capture" signal instead of a server-log-only event.
export type BuildOutcome =
  | { ok: true; id: string; archetype: string | null }
  | { ok: false; reason: string };

const DEGRADED_REASON_MAX = 280;

// Keep the persisted reason short and single-line: it lands in a DB column and a
// compact recruiter UI, and raw Python stderr can be huge/multiline.
export function degradedReason(detail: string): string {
  const oneLine = detail.replace(/\s+/g, " ").trim() || "intake normalization failed";
  return oneLine.length > DEGRADED_REASON_MAX ? `${oneLine.slice(0, DEGRADED_REASON_MAX - 1)}…` : oneLine;
}

// Normalize the captured answers into a saved CandidateProfileV2 (the same
// profile_cli path the Profile form uses). Returns the saved profile's id +
// archetype on success, or a failure reason — the caller falls back to a
// label-only entry (flagged intake-degraded) so applying never hard-errors.
//
// W8-6 (APP1): `intoProfileId` rebuilds IN PLACE — a re-apply that upgrades an
// existing applicant overwrites their saved profile row instead of minting a fresh
// one, so the candidate pool never grows a stale duplicate of the same person. When
// the id has no profile row (the degraded-stub case: candidateId is a random
// label-only id), updateProfile misses and we fall through to a normal save — the
// caller re-points the entry at the new id.
export async function buildApplicantProfile(
  job: ReturnType<typeof getJob>,
  answers: ApplyAnswers,
  intoProfileId?: string | null
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
      // Surface the failing exit code plus the tail of stderr (the most likely line
      // to name the cause) so the recruiter signal is diagnosable.
      const tail = stderr.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? "";
      return {
        ok: false,
        reason: degradedReason(`profile normalization exited ${exitCode}${tail ? `: ${tail}` : ""}`),
      };
    }
    // Parse the result JSON line via parsePythonJson (scans from the end for the
    // first object/array), not the whole buffer: a stray warning/print or trailing
    // interpreter shutdown line would otherwise make JSON.parse throw and silently
    // demote the applicant to a label-only, non-matchable stub.
    const parsed = parsePythonJson<unknown>(stdout, stderr);
    // parsePythonJson only guarantees "some JSON object/array" — not the shape
    // profile_cli promises. Validate the trust boundary so an exit-0 CLI that drifts
    // to `{}` / `{profile:null}` / a partial object yields a clear degraded reason
    // instead of an incidental TypeError, and is never saved as junk.
    const validation = validateProfileCliResult(parsed);
    if (!validation.ok) {
      return { ok: false, reason: degradedReason(validation.reason) };
    }
    const { profile: normalized, archetype, completeness } = validation.value;
    const profileFields = {
      label: answers.name,
      archetype,
      roleFamily: (normalized.roleFamily as string) ?? job.roleFamily ?? null,
      completeness,
      payload: normalized,
    };
    if (intoProfileId && updateProfile(intoProfileId, profileFields)) {
      return { ok: true, id: intoProfileId, archetype };
    }
    const saved = saveProfile(profileFields);
    return { ok: true, id: saved.id, archetype };
  } catch (err) {
    // Don't swallow silently: a failed build demotes the applicant to a label-only,
    // non-matchable stub, so make that degradation visible — both in the server log
    // and (via the returned reason) on the recruiter's board.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[applicant-profile] build failed for job ${job.id}; falling back to a non-matchable stub:`, message);
    return { ok: false, reason: degradedReason(message) };
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}
