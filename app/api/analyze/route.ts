import { NextResponse } from "next/server";
import { getServerLocale } from "@/i18n/server";
import { isLocale } from "@/i18n/locales";
import { meterGate } from "@/app/_lib/billing";
import { listRecentTasks } from "@/app/_lib/db/tasks";
import type { AnalyzeParams } from "@/app/_lib/analyze-run";
import { cvVariantHash, dedupeCvVariants } from "@/app/_lib/cv-variant";
import { newRequestId } from "@/app/_lib/logger";
import { createWorkdir, persistFile } from "@/app/_lib/python-runner";
import { startTask } from "@/app/_lib/tasks";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { jsonRefusal } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import {
  MAX_CV_VARIANTS,
  validateOptionalUploadServer,
  validateUploadServer,
} from "@/app/_lib/upload-constraints";

export const maxDuration = 60;

// Persists the upload to a stable dir and starts a background `analyze` task,
// returning { task }. The client polls /api/tasks/[id] (and the global Tasks
// indicator tracks it) — so the analysis survives navigation + page refresh.
export async function POST(request: Request) {
  // Per-IP abuse containment (backlog #7): in open mode (no KP_OPERATOR_PASSWORD)
  // this route is unauthenticated, and each submit ends in a paid Gemini
  // multimodal call inside the background task. Throttle BEFORE the billing read
  // and the multi-MB formData parse so a flood is rejected cheaply. 30/10min/IP
  // is far above any real operator cadence — the UI submits ONE request per run
  // (multi-CV variants ride together inside it, see collectCvFiles), so even a
  // rapid-fire screening session stays well under the ceiling, while a scripted
  // burst can't fan out unmetered model calls. Cached re-runs share the budget,
  // but they are part of the same human cadence the ceiling already covers.
  if (!rateLimit(`analyze:${clientIpFrom(request.headers)}`, { limit: 30, windowMs: 10 * 60_000 })) {
    // Through the chokepoint, so the throttle carries TOO_MANY_REQUESTS and the
    // form renders it in the reader's language instead of painting our English.
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }

  // Tenant (P2): resolve the requesting workspace up front (a cheap cookie read) so
  // EVERY meter/gate read below scopes to this tenant — the pre-check, the in-flight
  // reservation count, and the authoritative reservation. Captured here (request
  // scope) and also stamped on the task so the detached background job targets the
  // same tenant. Single-tenant path resolves to the default workspace (byte-identical).
  const workspace = await currentWorkspace();

  // Billing hard GATE only: a CV analysis is the unit behind the "AI candidates"
  // meter (one person fully worked — variants of the same person count once). The
  // unit is DEBITED later, inside runAnalyze, only when a non-cached analysis is
  // actually delivered — so a failed, canceled, or duplicate/cached run never charges
  // for work that wasn't done. This is a CHEAP PRE-CHECK (refuse a fully-empty meter
  // before the multi-MB formData parse); the AUTHORITATIVE, in-flight-aware reservation
  // that closes the concurrent-burst window runs just before startTask below.
  const quota = meterGate("ai_candidates", { workspace });
  if (quota) return jsonRefusal("BILLING_QUOTA_EXCEEDED", 402, { meter: quota.meter, plan: quota.plan });

  const form = await request.formData();
  const grounding = form.get("grounding") === "true";
  const jobDescriptionFile = form.get("jobDescription");
  const jobDescriptionText = form.get("jobDescriptionText");
  const companyFile = form.get("company");
  const companyText = form.get("companyText");
  const jdSlug = typeof form.get("jdSlug") === "string" ? (form.get("jdSlug") as string) : null;

  const cvFiles = await collectCvFiles(form);
  if (cvFiles.length === 0) {
    return jsonRefusal("ANALYZE_CV_REQUIRED", 400);
  }
  if (cvFiles.length > MAX_CV_VARIANTS) {
    return jsonRefusal("ANALYZE_TOO_MANY_VARIANTS", 400, { max: MAX_CV_VARIANTS });
  }

  const fileValidation = cvFiles
    .map(({ file }, index) => validateUploadServer(file, cvFiles.length > 1 ? `CV variant ${index + 1}` : "profile"))
    .find(Boolean);
  const validationError =
    fileValidation ||
    validateOptionalUploadServer(jobDescriptionFile, "job description") ||
    validateOptionalUploadServer(companyFile, "company overview");
  if (validationError) {
    // The gate's `error` names WHICH file in English for the log and for API
    // consumers; `code` is the half the form renders, localized. Both halves
    // travel — the client never paints the sentence (api-contracts.md §1.1).
    return NextResponse.json(
      { error: validationError.error, code: validationError.code },
      { status: validationError.status }
    );
  }

  const jobDescFile = jobDescriptionFile instanceof File && jobDescriptionFile.size > 0 ? jobDescriptionFile : null;
  const compFile = companyFile instanceof File && companyFile.size > 0 ? companyFile : null;

  // Persist everything to a stable dir; the task (not this request) cleans it up.
  const baseDir = await createWorkdir();
  const variants: { label: string; cvPath: string; cvHash: string }[] = [];
  for (let i = 0; i < cvFiles.length; i += 1) {
    const cvPath = await persistFile(baseDir, cvFiles[i].file, `cv-${i}`);
    // Content-addressed identity: stamp the CV's content hash so the saved analysis
    // is keyed to the CV bytes, not the filename. Reuses cvVariantHash — the SAME
    // digest collectCvFiles already computed to dedupe (see below) — so the identity
    // and the "same variant" question stay one answer.
    variants.push({ label: cvFiles[i].label, cvPath, cvHash: cvFiles[i].cvHash });
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

  // `workspace` was resolved at the top of the handler (all gate reads share it) and
  // rides on the params so the background task stamps the saved analysis with it —
  // the detached task can't read the cookie itself.
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
    workspace,
  };

  // Reservation gate (finding #2 — close the gate→debit burst window): the
  // ai_candidates unit is debited LATER, inside the background task on a delivered
  // non-cached result, so N concurrent submits that all read the same pre-debit balance
  // could each pass the pre-check above and collectively overrun a hard cap. Each
  // queued/running analyze task will debit at most ONE unit, so its task row IS a
  // one-unit reservation: count those in flight and refuse unless a unit remains ON TOP
  // of them. Race-safe because better-sqlite3 writes are synchronous and there is NO
  // await between this count and startTask's row insert below — two concurrent requests
  // can't both read the same count; each sees every earlier reservation and atomically
  // adds its own. TENANCY (P2): both the in-flight count and the meter read are scoped
  // to THIS workspace, and startTask stamps the row with it — so one tenant's burst
  // reserves against its OWN quota only and can't block or drain another tenant's runs.
  const inFlightAnalyze = listRecentTasks(new Date().toISOString(), 200, workspace).filter(
    (t) => t.kind === "analyze" && (t.status === "queued" || t.status === "running")
  ).length;
  const reserve = meterGate("ai_candidates", { inFlight: inFlightAnalyze, workspace });
  if (reserve) return jsonRefusal("BILLING_QUOTA_EXCEEDED", 402, { meter: reserve.meter, plan: reserve.plan });

  // No debit here — runAnalyze charges the unit only on a delivered, non-cached result.
  const task = startTask("analyze", params as unknown as Record<string, unknown>, workspace);
  return NextResponse.json({ task });
}

// Collect the uploaded CV file(s), drop content-duplicate uploads, then label
// what's left. Dedupe is by CONTENT via the one cvVariantHash helper the client
// intake (addCvFile) also uses (app/_lib/cv-variant.ts), so the same file added
// twice no longer runs twice, hits the same analyze cache key, and ranks an
// identical clone against itself. The (n) suffix still disambiguates genuinely
// different files that happen to share a display name.
async function collectCvFiles(form: FormData): Promise<Array<{ file: File; label: string; cvHash: string }>> {
  const uploaded: File[] = [];
  for (const value of form.getAll("cvs")) {
    if (value instanceof File && value.size > 0) uploaded.push(value);
  }
  if (uploaded.length === 0) {
    const single = form.get("cv");
    if (single instanceof File && single.size > 0) uploaded.push(single);
  }

  const unique = await dedupeCvVariants(uploaded);

  const out: Array<{ file: File; label: string; cvHash: string }> = [];
  const seenLabels = new Set<string>();
  for (const file of unique) {
    let label = file.name || `CV ${out.length + 1}`;
    if (seenLabels.has(label)) label = `${label} (${out.length + 1})`;
    seenLabels.add(label);
    // Content hash = the content-addressed candidate identity persisted with the
    // saved analysis. Same helper dedupeCvVariants used above, so it's cheap here.
    out.push({ file, label, cvHash: await cvVariantHash(file) });
  }
  return out;
}
