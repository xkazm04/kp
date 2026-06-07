import { NextResponse } from "next/server";
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

  const params: AnalyzeParams = {
    baseDir,
    grounding,
    variants,
    jobDescriptionPath,
    jobDescriptionText: typeof jobDescriptionText === "string" ? jobDescriptionText : null,
    companyPath,
    companyText: typeof companyText === "string" ? companyText : null,
    jdSlug,
    requestId: newRequestId(),
  };

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
