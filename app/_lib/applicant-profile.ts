import path from "node:path";
import { writeFile } from "node:fs/promises";
import { buildApplyProfileDraft } from "@/app/_lib/apply";
import type { ApplyAnswers } from "@/app/_lib/apply-intake";
import { cleanupWorkdir, createWorkdir, parsePythonJson, spawnPython } from "@/app/_lib/python-runner";
import { validateProfileCliResult, type ProfileCliResult } from "@/app/_lib/apply-profile-result";
import type { CompletenessGap } from "@/app/_lib/completeness-followup";
import { getJob } from "@/app/_lib/db/jobs";
import { saveProfile, updateProfile } from "@/app/_lib/db/profiles";

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
  | {
      ok: true;
      id: string;
      archetype: string | null;
      /** The archetype checklist's unmet items for the profile just saved
       *  (profile_cli's `missingGaps`). Carried out of the build so the caller can
       *  record them on the pipeline entry and offer the CANDIDATE the targeted
       *  follow-up questions — previously this list was parsed and thrown away. */
      missingGaps: CompletenessGap[];
    }
  | { ok: false; reason: string };

const DEGRADED_REASON_MAX = 280;

// Hard bound on the profile_cli spawn. Without an explicit value the runner
// applies its 600s hang-backstop (python-runner DEFAULT_TIMEOUT_MS) — a
// deliberate ceiling for the long multi-LLM CLIs, and completely wrong here: this
// spawn sits on the UNAUTHENTICATED accept path, so a wedged child held an
// applicant's request open for ten minutes (they see a hung form and re-submit,
// each retry spawning another child).
//
// 60s, matching the 60s-class bounds the sibling extraction spawns already use
// (/api/extract-text derives its budget from maxDuration; cv-intake.ts uses 55s).
// profile_cli is a DETERMINISTIC normalizer — no LLM call, no network — so a
// healthy run is sub-second and this is purely a wedge backstop, not a deadline
// any real application approaches.
//
// A timeout REJECTS the spawn promise (python-runner `fail(...)`), which lands in
// this module's catch and returns the ordinary degraded outcome — so the entry
// still files, flagged intakeDegraded with the timeout as its recruiter-visible
// reason. The applicant never sees a 500.
const PROFILE_BUILD_TIMEOUT_MS = 60_000;

// Keep the persisted reason short and single-line: it lands in a DB column and a
// compact recruiter UI, and raw Python stderr can be huge/multiline.
export function degradedReason(detail: string): string {
  const oneLine = detail.replace(/\s+/g, " ").trim() || "intake normalization failed";
  return oneLine.length > DEGRADED_REASON_MAX ? `${oneLine.slice(0, DEGRADED_REASON_MAX - 1)}…` : oneLine;
}

// The single profile_cli seam: spawn the deterministic normalizer over an intake
// draft and hand back the validated result (or a bounded, recruiter-visible
// reason). Extracted so the first-apply build and the candidate's gap-answer
// re-normalization share ONE subprocess contract — bound, parsed, validated and
// degraded identically — instead of the second growing its own copy.
type NormalizeOutcome = { ok: true; value: ProfileCliResult } | { ok: false; reason: string };

async function runProfileCli(draft: { profile: unknown; signals: unknown }, context: string): Promise<NormalizeOutcome> {
  let workdir: string | null = null;
  try {
    workdir = await createWorkdir();
    const inputPath = path.join(workdir, "intake.json");
    await writeFile(inputPath, JSON.stringify(draft), "utf-8");
    const { result } = spawnPython(["-m", "pipeline.jobfit.profile_cli", "--input-json", inputPath], {
      timeoutMs: PROFILE_BUILD_TIMEOUT_MS,
    });
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      // Surface the failing exit code plus the tail of stderr (the most likely line
      // to name the cause) so the recruiter signal is diagnosable.
      const tail = stderr.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? "";
      return { ok: false, reason: degradedReason(`profile normalization exited ${exitCode}${tail ? `: ${tail}` : ""}`) };
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
    if (!validation.ok) return { ok: false, reason: degradedReason(validation.reason) };
    return { ok: true, value: validation.value };
  } catch (err) {
    // Don't swallow silently: a failed build demotes the applicant to a label-only,
    // non-matchable stub, so make that degradation visible — both in the server log
    // and (via the returned reason) on the recruiter's board.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[applicant-profile] profile_cli failed (${context}):`, message);
    return { ok: false, reason: degradedReason(message) };
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}

// Normalize the captured answers into a saved CandidateProfileV2 (the same
// profile_cli path the Profile form uses). Returns the saved profile's id,
// archetype + unmet-checklist gaps on success, or a failure reason — the caller
// falls back to a label-only entry (flagged intake-degraded) so applying never
// hard-errors.
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
  const normalized = await runProfileCli(buildApplyProfileDraft(job, answers), `job ${job.id}`);
  if (!normalized.ok) return normalized;
  const { profile, archetype, completeness, missingGaps } = normalized.value;
  const profileFields = {
    label: answers.name,
    archetype,
    roleFamily: (profile.roleFamily as string) ?? job.roleFamily ?? null,
    completeness,
    payload: profile,
  };
  if (intoProfileId && updateProfile(intoProfileId, profileFields)) {
    return { ok: true, id: intoProfileId, archetype, missingGaps };
  }
  const saved = saveProfile(profileFields);
  return { ok: true, id: saved.id, archetype, missingGaps };
}

// Re-normalize an ALREADY-SAVED profile payload in place — the candidate's
// gap-answer merge (mergeGapAnswers folds their self-declared answers into the
// stored CandidateProfileV2, this re-routes + re-scores it). Deliberately mirrors
// the recruiter's "Save as profile" semantics (ArchetypeBanner → /api/profile,
// which runs the same deterministic profile_cli over the merged payload): no new
// LLM call, no schema change, and completeness/archetype/missingGaps come back
// authoritative rather than being guessed client-side.
//
// Returns the FRESH gap list so the caller can rewrite what's still recorded on
// the entry (an answer that didn't actually close its check stays recorded).
// A failure changes nothing — the saved profile keeps its previous content.
export async function renormalizeApplicantProfile(
  profileId: string,
  payload: Record<string, unknown>,
  label: string,
  workspaceId?: string
): Promise<BuildOutcome> {
  const normalized = await runProfileCli(
    // `selfDeclared` pins the archetype the profile already routed to, exactly as
    // the recruiter banner does, so a merge can't silently re-route the candidate.
    { profile: payload, signals: { selfDeclared: payload.archetype ?? undefined } },
    `profile ${profileId}`
  );
  if (!normalized.ok) return normalized;
  const { profile, archetype, completeness, missingGaps } = normalized.value;
  const ok = updateProfile(
    profileId,
    {
      label: (profile.displayName as string) || label,
      archetype,
      roleFamily: (profile.roleFamily as string) ?? null,
      completeness,
      payload: profile,
    },
    workspaceId
  );
  if (!ok) return { ok: false, reason: degradedReason(`profile ${profileId} not found for gap merge`) };
  return { ok: true, id: profileId, archetype, missingGaps };
}

