import { NextResponse } from "next/server";
import { analysisSchema, type Analysis } from "@/app/_lib/schemas";
import {
  computeCacheKey,
  lookupCachedAnalysis,
  storeCachedAnalysis,
} from "@/app/_lib/cache";
import { buildComparison } from "@/app/_lib/comparison";
import { saveAnalysis } from "@/app/_lib/db";
import { logAnalyze, newRequestId } from "@/app/_lib/logger";
import {
  buildCliArgs,
  cleanupWorkdir,
  createWorkdir,
  parseStderrError,
  persistFile,
  spawnPython,
} from "@/app/_lib/python-runner";

export const runtime = "nodejs";
export const maxDuration = 60;

const allowedTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  ""
]);

const MAX_CV_VARIANTS = 3;

export async function POST(request: Request) {
  const requestId = newRequestId();
  const startedAt = Date.now();

  const form = await request.formData();
  const grounding = form.get("grounding") === "true";
  const jobDescriptionFile = form.get("jobDescription");
  const jobDescriptionText = form.get("jobDescriptionText");
  const companyFile = form.get("company");
  const companyText = form.get("companyText");

  const cvFiles = collectCvFiles(form);

  if (cvFiles.length === 0) {
    return NextResponse.json({ error: "Upload a CV or profile file under the field name cv." }, { status: 400 });
  }

  if (cvFiles.length > MAX_CV_VARIANTS) {
    return NextResponse.json(
      { error: `Compare at most ${MAX_CV_VARIANTS} CV variants in one run.` },
      { status: 400 }
    );
  }

  const fileValidation = cvFiles
    .map(({ file }, index) => validateFile(file, cvFiles.length > 1 ? `CV variant ${index + 1}` : "profile"))
    .find(Boolean);
  const validationError =
    fileValidation ||
    validateOptionalFile(jobDescriptionFile, "job description") ||
    validateOptionalFile(companyFile, "company overview");
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const jobDescFile = jobDescriptionFile instanceof File && jobDescriptionFile.size > 0 ? jobDescriptionFile : null;
  const compFile = companyFile instanceof File && companyFile.size > 0 ? companyFile : null;
  const jobDescText = typeof jobDescriptionText === "string" ? jobDescriptionText : null;
  const compText = typeof companyText === "string" ? companyText : null;

  // Pre-load file bytes once so the cache key computation and the Python
  // spawn don't both have to slurp them.
  const jdFileBytes = jobDescFile ? Buffer.from(await jobDescFile.arrayBuffer()) : null;
  const coFileBytes = compFile ? Buffer.from(await compFile.arrayBuffer()) : null;

  const variantBuffers = await Promise.all(
    cvFiles.map(async (entry) => ({
      ...entry,
      bytes: Buffer.from(await entry.file.arrayBuffer()),
    }))
  );

  const cacheStats = { hits: 0, total: cvFiles.length };

  const results = await Promise.all(
    variantBuffers.map(async ({ file, label, bytes }) => {
      const cacheKey = computeCacheKey({
        cvBytes: bytes,
        jobDescriptionText: jobDescText ?? "",
        jobDescriptionFileBytes: jdFileBytes,
        companyText: compText ?? "",
        companyFileBytes: coFileBytes,
        grounding,
      });

      const cached = lookupCachedAnalysis(cacheKey);
      if (cached) {
        const parsed = analysisSchema.safeParse(cached);
        if (parsed.success) {
          cacheStats.hits += 1;
          return { label, ok: true as const, analysis: parsed.data };
        }
      }

      const workdir = await createWorkdir();
      try {
        const cvPath = await persistFile(workdir, file, "cv");
        const jobDescriptionPath = jobDescFile ? await persistFile(workdir, jobDescFile, "job-description") : undefined;
        const companyPath = compFile ? await persistFile(workdir, compFile, "company") : undefined;
        const args = buildCliArgs(
          {
            grounding,
            cvFile: file,
            jobDescriptionFile: jobDescFile,
            jobDescriptionText: jobDescText,
            companyFile: compFile,
            companyText: compText,
          },
          { cvPath, jobDescriptionPath, companyPath }
        );
        const { result } = spawnPython(args);
        const { stdout, stderr, exitCode } = await result;
        if (exitCode !== 0) {
          const err = parseStderrError(stderr, exitCode);
          return { label, ok: false as const, error: err.message, status: err.status };
        }
        let payload: unknown;
        try {
          payload = JSON.parse(stdout);
        } catch {
          return {
            label,
            ok: false as const,
            error: `Pipeline returned non-JSON output for "${label}".`,
            status: 502,
          };
        }
        const parsed = analysisSchema.safeParse(payload);
        if (!parsed.success) {
          return {
            label,
            ok: false as const,
            error: `Pipeline returned an unexpected payload for "${label}".`,
            status: 502,
          };
        }
        storeCachedAnalysis(cacheKey, parsed.data);
        return { label, ok: true as const, analysis: parsed.data };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Pipeline failed to start.";
        return { label, ok: false as const, error: message, status: 500 };
      } finally {
        await cleanupWorkdir(workdir);
      }
    })
  );

  const jdSlug = typeof form.get("jdSlug") === "string" ? (form.get("jdSlug") as string) : null;

  const failure = results.find((entry) => !entry.ok);
  if (failure && !failure.ok) {
    void logAnalyze({
      request_id: requestId,
      route: "analyze",
      candidate_label: variantBuffers[0]?.label,
      variant_count: cvFiles.length,
      jd_present: Boolean(jobDescFile || jobDescText?.trim()),
      jd_slug: jdSlug,
      company_present: Boolean(compFile || compText?.trim()),
      github_present: false,
      cache_hit: false,
      duration_ms: Date.now() - startedAt,
      status: "error",
      error: failure.error,
    });
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }

  const analyses = results
    .filter((entry): entry is { label: string; ok: true; analysis: Analysis } => entry.ok)
    .map((entry) => ({ label: entry.label, analysis: entry.analysis }));

  const allCached = cacheStats.hits === cacheStats.total;

  if (analyses.length === 1) {
    const single = analyses[0];
    const persisted = persistAnalysis(single.label, jdSlug, single.analysis);
    void logAnalyze({
      request_id: requestId,
      route: "analyze",
      candidate_label: single.label,
      variant_count: 1,
      jd_present: Boolean(jobDescFile || jobDescText?.trim()),
      jd_slug: jdSlug,
      company_present: Boolean(compFile || compText?.trim()),
      github_present: false,
      cache_hit: allCached,
      duration_ms: Date.now() - startedAt,
      status: "ok",
      saved_slug: persisted?.slug ?? null,
    });
    return NextResponse.json({ ...single.analysis, persistence: persisted });
  }

  const comparison = buildComparison(analyses);
  const winner = analyses.find((entry) => entry.label === comparison.bestLabel) ?? analyses[0];
  const merged = { ...winner.analysis, comparison };
  const persisted = persistAnalysis(`${winner.label} (best of ${analyses.length})`, jdSlug, merged);
  void logAnalyze({
    request_id: requestId,
    route: "analyze",
    candidate_label: `${winner.label} (best of ${analyses.length})`,
    variant_count: analyses.length,
    jd_present: Boolean(jobDescFile || jobDescText?.trim()),
    jd_slug: jdSlug,
    company_present: Boolean(compFile || compText?.trim()),
    github_present: false,
    cache_hit: allCached,
    duration_ms: Date.now() - startedAt,
    status: "ok",
    saved_slug: persisted?.slug ?? null,
  });
  return NextResponse.json({ ...merged, persistence: persisted });
}

function persistAnalysis(
  candidateLabel: string,
  jdSlug: string | null,
  analysis: Analysis
): { slug: string; createdAt: string } | null {
  try {
    return saveAnalysis({
      candidateLabel,
      jdSlug,
      score: analysis.score?.total ?? null,
      roleFamily: analysis.candidate?.roleFamily ?? null,
      seniority: analysis.candidate?.currentSeniority ?? null,
      payload: analysis,
    });
  } catch (error) {
    console.error("Failed to persist analysis", error);
    return null;
  }
}

function collectCvFiles(form: FormData): Array<{ file: File; label: string }> {
  const out: Array<{ file: File; label: string }> = [];
  const seenLabels = new Set<string>();

  const pushFile = (entry: FormDataEntryValue | null, indexLabel?: string) => {
    if (!(entry instanceof File) || entry.size === 0) return;
    let label = entry.name || indexLabel || `CV ${out.length + 1}`;
    if (seenLabels.has(label)) {
      label = `${label} (${out.length + 1})`;
    }
    seenLabels.add(label);
    out.push({ file: entry, label });
  };

  for (const value of form.getAll("cvs")) {
    pushFile(value);
  }
  if (out.length === 0) {
    pushFile(form.get("cv"));
  }
  return out;
}

function validateOptionalFile(file: FormDataEntryValue | null, label: string) {
  if (!(file instanceof File) || file.size === 0) {
    return null;
  }
  return validateFile(file, label);
}

function validateFile(file: File, label: string) {
  if (!allowedTypes.has(file.type)) {
    return `Use PDF, DOCX, TXT, or MD for the ${label}.`;
  }
  if (file.size > 8 * 1024 * 1024) {
    return `The ${label} upload limit is 8 MB.`;
  }
  return null;
}
