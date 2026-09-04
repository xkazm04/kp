import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/app/_lib/db/jobs";
import { getJobStatus, isJobOpenForApplications } from "@/app/_lib/job-ingest";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { extractUploadedText, ingestCvApplication, simCvIntakeTarget } from "@/app/_lib/cv-intake";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/locales";

export const maxDuration = 60;

const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 254;

// Simulate a real application ARRIVING WITH A CV — the piece the scalar inbound
// simulator (sim/inbound) can't exercise. A CV file (PDF/DOCX/TXT/MD) is parsed
// server-side by the REAL extractor, normalized into a matchable V2 candidate, and
// landed at "Accepted" on the chosen role — the exact path a forwarded email or an
// ad-form attachment takes through ingestCvApplication. Keyless: no LLM key needed.
export async function POST(request: NextRequest) {
  // Spawns a Python subprocess per call; self-limit like /api/extract-text.
  if (!rateLimit(`sim-apply-cv:${clientIpFrom(request.headers)}`, { limit: 20, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }

  try {
    // Every refusal below answers a CODE, like the four sibling sim routes: the
    // Channels card that drives this door already resolves `code` through
    // useErrorMessage(), so an English literal here shipped English to cs/de/fr
    // readers (its `errMsg` fell through to the generic "failed" line). `role_closed`
    // was a code, but a lowercase ad-hoc one with no catalog entry, so it resolved to
    // nothing — the one refusal a demo run actually hits.
    const form = await request.formData().catch(() => null);
    if (!form) return jsonRefusal("SIM_CV_FORM_REQUIRED", 400);

    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return jsonRefusal("SIM_CV_FILE_REQUIRED", 400);

    const jobId = String(form.get("jobId") ?? "");
    if (!jobId) return jsonRefusal("SIM_JOB_REQUIRED", 400);

    const job = getJob(jobId);
    if (!job) return jsonRefusal("SIM_JOB_NOT_FOUND", 404);
    if (!isJobOpenForApplications(getJobStatus(job.id))) return jsonRefusal("SIM_ROLE_CLOSED", 410);

    // Parse the CV with the same extractor the CV pipeline uses (PDF/DOCX/TXT/MD).
    const extracted = await extractUploadedText(file, request.signal);
    if (!extracted.ok) {
      // extractUploadedText folds THREE different failures into one string: the
      // client-safe upload validation, the extractor's parsed stderr, and a raw
      // thrown `.message` from the spawn path (cv-intake.ts:53-64). The last two
      // carry Python traceback text and the workdir path, so the reader gets one
      // coded sentence at the same status and the detail goes to the server log.
      console.error("[api:sim/apply-cv] SIM_CV_UNREADABLE", extracted.status, extracted.error);
      return jsonRefusal("SIM_CV_UNREADABLE", extracted.status);
    }

    const rawLang = String(form.get("lang") ?? "");
    const locale = isLocale(rawLang) ? rawLang : DEFAULT_LOCALE;
    const name = String(form.get("name") ?? "").slice(0, MAX_NAME_LENGTH).trim();
    const email = String(form.get("email") ?? "").slice(0, MAX_EMAIL_LENGTH).trim();
    // Attribution: which channel the demo is exercising (email inbox vs. ad form).
    const channel = String(form.get("channel") ?? "email");

    // Tenant: scope the sim write to the CALLER'S OWN team with a `(SIM)`-marked
    // title — not the job owner's team (the ingestCvApplication getJobWorkspace
    // default), and not the default team the helper used to hardcode. A recruiter
    // testing a CV against a shared-corpus role got no row on their own board and no
    // way to purge the one they did create. The marker keeps the demo CV purgeable by
    // resetSim and excluded from the real analytics funnel/hire-rate; the match is
    // still built against the real job.
    const target = simCvIntakeTarget(job, await currentWorkspace());
    const result = await ingestCvApplication({
      job,
      name: name || deriveNameFromFile(file.name),
      email: email || null,
      cvText: extracted.text,
      sourceChannel: channel,
      locale,
      // Keep repeated sim runs from generating acknowledgement dead-letters.
      sendAck: false,
      workspaceId: target.workspaceId,
      jobTitle: target.jobTitle,
    });

    return NextResponse.json({
      ok: true,
      entryId: result.entryId,
      created: result.created,
      candidateId: result.candidateId,
      candidateLabel: result.candidateLabel,
      archetype: result.archetype,
      degraded: result.degraded,
      degradedReason: result.degradedReason,
      // The marked title actually stored on the entry (visibly a sim row).
      jobTitle: target.jobTitle,
      stage: "Accepted",
    });
  } catch (error) {
    // ingestCvApplication sits on better-sqlite3 AND the spawned matcher, so the
    // thrown message can be SQLITE_* constraint text, the absolute db path or a
    // Python traceback. Same treatment as the sibling /api/sim/inbound.
    return safeJsonError(error, "api:sim/apply-cv", "SIM_CV_INTAKE_FAILED");
  }
}

// Best-effort display name from a résumé filename ("jane_doe_cv.pdf" → "Jane Doe")
// when the sim form leaves the name blank — purely cosmetic for the demo. The real
// inbound receiver takes the name from the payload/email header instead.
function deriveNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[_.-]+/g, " ");
  const cleaned = base.replace(/\b(cv|resume|résumé|curriculum vitae|lebenslauf)\b/gi, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "CV Applicant";
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 80);
}
