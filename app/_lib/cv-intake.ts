import { buildApplicantProfile } from "@/app/_lib/applicant-profile";
import { applyDedupeKey, FALLBACK_ARCHETYPE } from "@/app/_lib/apply";
import type { ApplyAnswers } from "@/app/_lib/apply-intake";
import { createPipelineEntry, getJob, recordEntryConsent } from "@/app/_lib/db";
import { dispatchApplicationReceived } from "@/app/_lib/comms-dispatch";
import { randomId } from "@/app/_lib/random-id";
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
// Accepted stub flagged intake-degraded, so an inbound never hard-errors. Best-effort
// GDPR consent + acknowledgement mirror the apply path.
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
}): Promise<CvIntakeResult> {
  const name = input.name.trim() || "Applicant";
  // A CV-only application: the extracted text is the high-weight `kind: "cv"`
  // evidence buildIntakeProfile folds in; skills stay empty (the résumé carries them).
  const answers: ApplyAnswers = { name, skills: "", cvText: input.cvText };
  const built = await buildApplicantProfile(input.job, answers);
  const candidateId = built.ok ? built.id : randomId("inbound");

  const { entry, created } = createPipelineEntry({
    candidateId,
    candidateLabel: name,
    // A degraded intake (or a build with no archetype) takes the neutral baseline —
    // never a guessed fairness-shielded archetype. See FALLBACK_ARCHETYPE.
    archetype: (built.ok ? built.archetype : null) ?? FALLBACK_ARCHETYPE,
    roleFamily: input.job.roleFamily ?? null,
    jobId: input.job.id,
    jobTitle: input.job.title,
    stage: "Accepted",
    // Stable per-applicant key so re-sends of the same person collapse onto one
    // entry even though candidateId is a fresh profile id each build.
    dedupeKey: applyDedupeKey(name, input.email ?? ""),
    intakeDegraded: !built.ok,
    intakeDegradedReason: built.ok ? null : built.reason,
    contact: input.email || null,
    locale: input.locale,
    sourceChannel: input.sourceChannel,
  });

  // GDPR: stamp data-processing consent + retention on the inbound entry (best-effort
  // — a consent-record failure must never block a successful intake).
  try {
    recordEntryConsent(entry.id, input.sourceChannel);
  } catch (err) {
    console.error(`[cv-intake] consent record failed for entry ${entry.id}:`, err instanceof Error ? err.message : err);
  }

  // Acknowledge a genuinely NEW candidate (best-effort). Skipped for a duplicate
  // re-send (created=false) so a provider retry doesn't re-email the candidate.
  if (input.sendAck !== false && created) {
    try {
      await dispatchApplicationReceived(entry);
    } catch (err) {
      console.error(`[cv-intake] acknowledgement failed for entry ${entry.id}:`, err instanceof Error ? err.message : err);
    }
  }

  return {
    entryId: entry.id,
    created,
    candidateId,
    degraded: !built.ok,
    degradedReason: built.ok ? null : built.reason,
    archetype: built.ok ? built.archetype : null,
    candidateLabel: name,
  };
}
