import { NextResponse } from "next/server";
import { getServerLocale } from "@/i18n/server";
import { isLocale } from "@/i18n/locales";
import { meterGate, recordMeterUsage } from "@/app/_lib/billing";
import type { AnalyzeParams } from "@/app/_lib/analyze-run";
import { dedupeCvVariants } from "@/app/_lib/cv-variant";
import { newRequestId } from "@/app/_lib/logger";
import { createWorkdir, persistFile } from "@/app/_lib/python-runner";
import { startTask } from "@/app/_lib/tasks";
import {
  MAX_CV_VARIANTS,
  validateOptionalUploadServer,
  validateUploadServer,
} from "@/app/_lib/upload-constraints";

export const runtime = "nodejs";
export const maxDuration = 60;

// Persists the upload to a stable dir and starts a background `analyze` task,
// returning { task }. The client polls /api/tasks/[id] (and the global Tasks
// indicator tracks it) — so the analysis survives navigation + page refresh.
export async function POST(request: Request) {
  // Billing hard gate: a CV analysis is the unit behind the "AI candidates"
  // meter (one person fully worked — variants of the same person count once).
  // Debited below at task start; a failed run burns the unit (v1 — refunds are
  // a later nicety, not a contract).
  const quota = meterGate("ai_candidates");
  if (quota) return NextResponse.json(quota, { status: 402 });

  const form = await request.formData();
  const grounding = form.get("grounding") === "true";
  const jobDescriptionFile = form.get("jobDescription");
  const jobDescriptionText = form.get("jobDescriptionText");
  const companyFile = form.get("company");
  const companyText = form.get("companyText");
  const jdSlug = typeof form.get("jdSlug") === "string" ? (form.get("jdSlug") as string) : null;

  const cvFiles = await collectCvFiles(form);
  if (cvFiles.length === 0) {
    return NextResponse.json({ error: "Upload a CV or profile file under the field name cv." }, { status: 400 });
  }
  if (cvFiles.length > MAX_CV_VARIANTS) {
    return NextResponse.json({ error: `Compare at most ${MAX_CV_VARIANTS} CV variants in one run.` }, { status: 400 });
  }

  const fileValidation = cvFiles
    .map(({ file }, index) => validateUploadServer(file, cvFiles.length > 1 ? `CV variant ${index + 1}` : "profile"))
    .find(Boolean);
  const validationError =
    fileValidation ||
    validateOptionalUploadServer(jobDescriptionFile, "job description") ||
    validateOptionalUploadServer(companyFile, "company overview");
  if (validationError) {
    return NextResponse.json({ error: validationError.error }, { status: validationError.status });
  }

  const jobDescFile = jobDescriptionFile instanceof File && jobDescriptionFile.size > 0 ? jobDescriptionFile : null;
  const compFile = companyFile instanceof File && companyFile.size > 0 ? companyFile : null;

  // Persist everything to a stable dir; the task (not this request) cleans it up.
  const baseDir = await createWorkdir();
  const variants: { label: string; cvPath: string }[] = [];
  for (let i = 0; i < cvFiles.length; i += 1) {
    const cvPath = await persistFile(baseDir, cvFiles[i].file, `cv-${i}`);
    variants.push({ label: cvFiles[i].label, cvPath });
  }
  const jobDescriptionPath = jobDescFile ? await persistFile(baseDir, jobDescFile, "job-description") : null;
  const companyPath = compFile ? await persistFile(baseDir, compFile, "company") : null;

  // Spill a large pasted JD/company blob to a workdir file and pass it as a PATH, not as one
  // inline argv element: a multi-MB paste in a single argv string trips the OS command-line
  // limit (E2BIG, ~32KB total on Windows) before Python runs — a cryptic spawn failure on
  // otherwise-valid input. Normal JDs (well under the threshold) still go inline; the path
  // route is the same one an uploaded JD file already uses, so the content is preserved.
  const ARGV_TEXT_LIMIT = 8 * 1024;
  let jdPath = jobDescriptionPath;
  let jdText = typeof jobDescriptionText === "string" ? jobDescriptionText : null;
  if (!jdPath && jdText && Buffer.byteLength(jdText, "utf8") > ARGV_TEXT_LIMIT) {
    jdPath = await persistFile(baseDir, new File([jdText], "job-description-text.txt"), "job-description-text");
    jdText = null;
  }
  let coPath = companyPath;
  let coText = typeof companyText === "string" ? companyText : null;
  if (!coPath && coText && Buffer.byteLength(coText, "utf8") > ARGV_TEXT_LIMIT) {
    coPath = await persistFile(baseDir, new File([coText], "company-text.txt"), "company-text");
    coText = null;
  }

  // Capture the locale HERE (request scope): the background task runs detached
  // from the request, so it can't read the NEXT_LOCALE cookie itself — the
  // resolved locale rides along in the task params and becomes the Python CLI's
  // --lang, so the LLM narrative comes back in the user's language.
  // CV3 — a per-run report-language override (the form's "Report language"
  // select) wins over the cookie locale when present and valid, so a recruiter
  // can produce an English report for an international panel without flipping
  // the whole app. The analyze cache is already lang-keyed, so re-running the
  // same CV in the other language is cache-correct.
  const reportLang = form.get("reportLang");
  const lang = isLocale(reportLang) ? reportLang : await getServerLocale();
  // Blind screening (idea-b8d711c4): redact identity from the CV before scoring.
  const blind = form.get("blind") === "true";

  const params: AnalyzeParams = {
    baseDir,
    grounding,
    variants,
    jobDescriptionPath: jdPath,
    jobDescriptionText: jdText,
    companyPath: coPath,
    companyText: coText,
    jdSlug,
    requestId: newRequestId(),
    lang,
    blind,
  };

  recordMeterUsage("ai_candidates");
  const task = startTask("analyze", params as unknown as Record<string, unknown>);
  return NextResponse.json({ task });
}

// Collect the uploaded CV file(s), drop content-duplicate uploads, then label
// what's left. Dedupe is by CONTENT via the one cvVariantHash helper the client
// intake (addCvFile) also uses (app/_lib/cv-variant.ts), so the same file added
// twice no longer runs twice, hits the same analyze cache key, and ranks an
// identical clone against itself. The (n) suffix still disambiguates genuinely
// different files that happen to share a display name.
async function collectCvFiles(form: FormData): Promise<Array<{ file: File; label: string }>> {
  const uploaded: File[] = [];
  for (const value of form.getAll("cvs")) {
    if (value instanceof File && value.size > 0) uploaded.push(value);
  }
  if (uploaded.length === 0) {
    const single = form.get("cv");
    if (single instanceof File && single.size > 0) uploaded.push(single);
  }

  const unique = await dedupeCvVariants(uploaded);

  const out: Array<{ file: File; label: string }> = [];
  const seenLabels = new Set<string>();
  for (const file of unique) {
    let label = file.name || `CV ${out.length + 1}`;
    if (seenLabels.has(label)) label = `${label} (${out.length + 1})`;
    seenLabels.add(label);
    out.push({ file, label });
  }
  return out;
}
