import { fileApplication, type ProfileBuilder } from "@/app/_lib/application-filing";
import type { getJob } from "@/app/_lib/db/jobs";
import { markSimTitle } from "@/app/features/shell/simulation/constants";
import {
  cleanupWorkdir,
  createWorkdir,
  parsePythonJson,
  parseStderrError,
  persistFile,
  spawnPython,
} from "@/app/_lib/python-runner";
import { validateUploadServer } from "@/app/_lib/upload-constraints";

type Job = NonNullable<ReturnType<typeof getJob>>;

// Cap on the extracted CV text folded into the profile draft — mirrors the apply
// route's MAX_CV_TEXT_LENGTH so a huge résumé can't bloat the intake.json / the heap.
const MAX_CV_TEXT_LENGTH = 64 * 1024;

// Server-side timeout for the extractor subprocess (inside a route's own budget).
const EXTRACT_TIMEOUT_MS = 55_000;

// Server-side text extraction from an uploaded CV (PDF/DOCX/TXT/MD) — the same
// pipeline.jobfit.extract_cli path /api/extract-text uses, but callable in-process
// so a HEADLESS inbound (a forwarded email or an ad-form attachment) can parse a
// file without a browser round-trip. Returns the text, or a bounded rejection.
export async function extractUploadedText(
  file: File,
  signal?: AbortSignal
): Promise<{ ok: true; text: string } | { ok: false; error: string; status: number }> {
  // Same MIME + size gate as /api/analyze and /api/extract-text, so the CV upload
  // endpoints can't drift on accepted types or the size cap.
  const rejection = validateUploadServer(file, "file");
  if (rejection) return { ok: false, error: rejection.error, status: rejection.status };

  // persistFile keeps the original extension, which the extractor uses to pick its
  // PDF/DOCX/TXT/MD path — so don't flatten the file name.
  const baseDir = await createWorkdir();
  try {
    const filePath = await persistFile(baseDir, file, "document");
    const { result } = spawnPython(["-m", "pipeline.jobfit.extract_cli", filePath], {
      timeoutMs: EXTRACT_TIMEOUT_MS,
      signal,
    });
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      return { ok: false, error: err.message, status: err.status };
    }
    const { text } = parsePythonJson<{ text: string }>(stdout, stderr);
    return { ok: true, text: (text ?? "").slice(0, MAX_CV_TEXT_LENGTH) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Text extraction failed.",
      status: 500,
    };
  } finally {
    await cleanupWorkdir(baseDir);
  }
}

export type CvIntakeResult = {
  entryId: string;
  created: boolean;
  candidateId: string;
  degraded: boolean;
  degradedReason: string | null;
  archetype: string | null;
  candidateLabel: string;
};

// Headless CV → matchable candidate → Accepted pipeline entry. The composite the
// inbound receiver and the channels simulation share: it runs the SAME deterministic
// profile_cli normalizer the conversational apply uses (buildApplicantProfile), so a
// candidate that arrives as a forwarded email / ad-form attachment becomes a real,
// MATCHABLE V2 profile bound to the role — not the analysis-less lead stub the
// scalar-only inbound path produces. On a build failure it still files a label-only
// stub flagged intake-degraded, so an inbound never hard-errors. The filing itself
// (tenant, identity, entry column, consent, ack) is application-filing.ts's.
//
// Keyless by design: the deterministic normalizer needs no LLM key. A configured
// Gemini key is the documented enrichment seam (a fuller multimodal analysis over
// the same file) — not a prerequisite for a candidate to land and be matchable.
export async function ingestCvApplication(input: {
  job: Job;
  name: string;
  email: string | null;
  cvText: string;
  sourceChannel: string;
  locale: string;
  /** Send the candidate the "application received" ack. Default true (the real
   *  inbound behavior); the simulation passes false so repeat runs stay clean. */
  sendAck?: boolean;
  /** The team the applicant is filed into — defaults to the job's owning team (a public
   *  applicant has no session); the webhook receiver overrides with its own workspace,
   *  and a sim run with the operator's own team (see simCvIntakeTarget). */
  workspaceId?: string;
  /** Stored `job_title` for the pipeline entry — defaults to the job's real title.
   *  The sim path overrides it with a `(SIM)`-marked title (see simCvIntakeTarget) so
   *  a demo CV is purgeable + analytics-excluded; the match is still built against the
   *  real job. */
  jobTitle?: string;
  /** The profile builder — buildApplicantProfile unless a test injects one. */
  buildProfile?: ProfileBuilder;
}): Promise<CvIntakeResult> {
  // Everything that makes this a FILING — tenant, name hygiene, identity before the
  // build, the tenant-carrying profile build, the entry column, consent, the ack —
  // is the shared core's. This door supplies only its answers and its proof: the CV
  // arrived through a channel we issued (a tokened webhook, or the operator's own
  // sim), so a repeat may backfill a missing contact but never rebuild the profile.
  const outcome = await fileApplication({
    job: input.job,
    workspaceId: input.workspaceId,
    name: input.name,
    email: input.email,
    locale: input.locale,
    sourceChannel: input.sourceChannel,
    channelLabel: "inbound CV",
    jobTitle: input.jobTitle,
    // A CV-only application: the extracted text is the high-weight `kind: "cv"`
    // evidence buildIntakeProfile folds in; skills stay empty (the résumé carries them).
    answers: { skills: "", cvText: input.cvText },
    proof: "channel",
    buildProfile: input.buildProfile,
    sendAck: input.sendAck,
  });

  if (outcome.kind === "duplicate") {
    const { entry } = outcome;
    return {
      entryId: entry.id,
      created: false,
      candidateId: entry.candidateId ?? "",
      degraded: entry.intakeDegraded,
      degradedReason: entry.intakeDegradedReason ?? null,
      archetype: entry.archetype ?? null,
      candidateLabel: entry.candidateLabel,
    };
  }
  const { entry, built } = outcome;
  return {
    entryId: entry.id,
    created: true,
    candidateId: entry.candidateId ?? "",
    degraded: !built?.ok,
    degradedReason: built && !built.ok ? built.reason : null,
    archetype: built?.ok ? built.archetype : null,
    candidateLabel: outcome.label,
  };
}

// The write target for a SIMULATED CV intake (the keyless "Test with a real CV"
// channels card + /api/sim/apply-cv + /api/sim/inbound). A sim run lands on the
// CALLER'S OWN board — `workspaceId` is the session's team, resolved by the route —
// with a `(SIM)`-marked stored title. That single marker is BOTH the purge key
// (resetSim deletes `job_title LIKE '%(SIM)%' AND workspace_id = ?`) and the
// analytics read-side exclusion (SIM_TITLE_LIKE), so a demo CV is fully purgeable
// and never counts as a real applicant/hire — even though it now sits on a real
// team's board. The candidate is still MATCHED against the real job
// (buildApplicantProfile reads the real title); only the stored entry's workspace +
// title are decided here.
//
// This used to hardcode DEFAULT_WORKSPACE_ID, guarding the intent "a demo CV must
// NEVER be filed into the job OWNER's real pipeline". That intent pre-dates
// multi-workspace and the `(SIM)` marker now carries it (purgeable + funnel-excluded);
// with KP_MULTI_WORKSPACE on, the hardcode was itself the defect. A team pressed
// "Receive a test application", the row landed on the DEFAULT team's board, the
// guided walk then read its own correctly-scoped /api/pipeline, found nothing, and
// halted on error.noScreened — and because /api/sim/reset purges only the caller's
// workspace, the orphan was unreachable, so every retry left one more demo row in a
// stranger's pipeline and analytics.
//
// `workspaceId` is REQUIRED, deliberately: a defaulted tenant argument here is
// exactly how the sim wrote into someone else's tenant in the first place.
export function simCvIntakeTarget(job: Job, workspaceId: string): { workspaceId: string; jobTitle: string } {
  return { workspaceId, jobTitle: markSimTitle(job.title) };
}
