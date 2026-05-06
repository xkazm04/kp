import { analysisSchema, type Analysis } from "@/app/_lib/schemas";
import {
  computeCacheKey,
  lookupCachedAnalysis,
  storeCachedAnalysis,
} from "@/app/_lib/cache";
import { saveAnalysis } from "@/app/_lib/db";
import { logAnalyze, newRequestId } from "@/app/_lib/logger";
import {
  buildCliArgs,
  cleanupWorkdir,
  createWorkdir,
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

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

const STAGE_ORDER = ["extract", "gemini", "profile", "scoring", "salary", "insights"] as const;

export async function POST(request: Request) {
  const requestId = newRequestId();
  const startedAt = Date.now();

  const form = await request.formData();
  const grounding = form.get("grounding") === "true";
  const jobDescriptionFile = form.get("jobDescription");
  const jobDescriptionText = form.get("jobDescriptionText");
  const companyFile = form.get("company");
  const companyText = form.get("companyText");
  const cvFile = form.get("cv");
  const jdSlug = typeof form.get("jdSlug") === "string" ? (form.get("jdSlug") as string) : null;
  const candidateLabel = cvFile instanceof File ? cvFile.name : "candidate";

  if (!(cvFile instanceof File) || cvFile.size === 0) {
    return errorEvent("Upload a CV or profile file under the field name cv.", 400);
  }

  const validationError =
    validateFile(cvFile, "profile") ||
    validateOptionalFile(jobDescriptionFile, "job description") ||
    validateOptionalFile(companyFile, "company overview");
  if (validationError) {
    return errorEvent(validationError, 400);
  }

  const jobDescFile = jobDescriptionFile instanceof File && jobDescriptionFile.size > 0 ? jobDescriptionFile : null;
  const compFile = companyFile instanceof File && companyFile.size > 0 ? companyFile : null;
  const jobDescText = typeof jobDescriptionText === "string" ? jobDescriptionText : null;
  const compText = typeof companyText === "string" ? companyText : null;

  const cvBytes = Buffer.from(await cvFile.arrayBuffer());
  const jdBytes = jobDescFile ? Buffer.from(await jobDescFile.arrayBuffer()) : null;
  const coBytes = compFile ? Buffer.from(await compFile.arrayBuffer()) : null;

  const cacheKey = computeCacheKey({
    cvBytes,
    jobDescriptionText: jobDescText ?? "",
    jobDescriptionFileBytes: jdBytes,
    companyText: compText ?? "",
    companyFileBytes: coBytes,
    grounding,
  });

  const cached = lookupCachedAnalysis(cacheKey);
  if (cached) {
    const parsed = analysisSchema.safeParse(cached);
    if (parsed.success) {
      const persisted = persistResult(candidateLabel, jdSlug, parsed.data);
      void logAnalyze({
        request_id: requestId,
        route: "analyze-stream",
        candidate_label: candidateLabel,
        variant_count: 1,
        jd_present: Boolean(jobDescFile || jobDescText?.trim()),
        jd_slug: jdSlug,
        company_present: Boolean(compFile || compText?.trim()),
        github_present: false,
        cache_hit: true,
        duration_ms: Date.now() - startedAt,
        status: "ok",
        saved_slug: persisted?.slug ?? null,
      });
      return new Response(buildCachedSseBody(parsed.data, persisted), { headers: SSE_HEADERS });
    }
  }

  const workdir = await createWorkdir();
  let workdirCleaned = false;
  const cleanup = async () => {
    if (workdirCleaned) return;
    workdirCleaned = true;
    await cleanupWorkdir(workdir);
  };

  let cvPath: string;
  let jobDescriptionPath: string | undefined;
  let companyPath: string | undefined;
  try {
    cvPath = await persistFile(workdir, cvFile, "cv");
    jobDescriptionPath = jobDescFile ? await persistFile(workdir, jobDescFile, "job-description") : undefined;
    companyPath = compFile ? await persistFile(workdir, compFile, "company") : undefined;
  } catch (error) {
    await cleanup();
    const message = error instanceof Error ? error.message : "Failed to stage uploads.";
    void logAnalyze({
      request_id: requestId,
      route: "analyze-stream",
      candidate_label: candidateLabel,
      variant_count: 1,
      jd_present: Boolean(jobDescFile || jobDescText?.trim()),
      jd_slug: jdSlug,
      company_present: Boolean(compFile || compText?.trim()),
      github_present: false,
      cache_hit: false,
      duration_ms: Date.now() - startedAt,
      status: "error",
      error: message,
    });
    return errorEvent(message, 500);
  }

  const args = [
    ...buildCliArgs(
      {
        grounding,
        cvFile,
        jobDescriptionFile: jobDescFile,
        jobDescriptionText: jobDescText,
        companyFile: compFile,
        companyText: compText,
      },
      { cvPath, jobDescriptionPath, companyPath }
    ),
    "--stream",
  ];

  const { child, result } = spawnPython(args);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let capturedResult: Analysis | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let buffer = "";

      const flushEvent = (raw: string) => {
        const transformed = transformEvent(raw, (analysis) => {
          capturedResult = analysis;
        });
        if (transformed !== null) controller.enqueue(encoder.encode(transformed));
      };

      child.stdout.on("data", (chunk: Buffer) => {
        buffer += decoder.decode(chunk, { stream: true });
        let separator = buffer.indexOf("\n\n");
        while (separator !== -1) {
          const raw = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          flushEvent(raw);
          separator = buffer.indexOf("\n\n");
        }
      });

      const finish = async () => {
        const { stderr, exitCode } = await result.catch((err) => ({
          stdout: "",
          stderr: err instanceof Error ? err.message : String(err),
          exitCode: -1,
        }));
        if (buffer.trim()) flushEvent(buffer);
        if (exitCode !== 0) {
          const trimmed = stderr.trim();
          const message = trimmed || `Pipeline exited with code ${exitCode ?? "?"}.`;
          controller.enqueue(encoder.encode(formatEvent({ type: "error", message })));
          void logAnalyze({
            request_id: requestId,
            route: "analyze-stream",
            candidate_label: candidateLabel,
            variant_count: 1,
            jd_present: Boolean(jobDescFile || jobDescText?.trim()),
            jd_slug: jdSlug,
            company_present: Boolean(compFile || compText?.trim()),
            github_present: false,
            cache_hit: false,
            duration_ms: Date.now() - startedAt,
            status: "error",
            error: message,
          });
        } else if (capturedResult) {
          storeCachedAnalysis(cacheKey, capturedResult);
          const persisted = persistResult(candidateLabel, jdSlug, capturedResult);
          if (persisted) {
            controller.enqueue(encoder.encode(formatEvent({ type: "persisted", data: persisted })));
          }
          void logAnalyze({
            request_id: requestId,
            route: "analyze-stream",
            candidate_label: candidateLabel,
            variant_count: 1,
            jd_present: Boolean(jobDescFile || jobDescText?.trim()),
            jd_slug: jdSlug,
            company_present: Boolean(compFile || compText?.trim()),
            github_present: false,
            cache_hit: false,
            duration_ms: Date.now() - startedAt,
            status: "ok",
            saved_slug: persisted?.slug ?? null,
          });
        }
        controller.close();
      };

      child.once("close", () => {
        void finish();
      });
      child.once("error", (err) => {
        controller.enqueue(
          encoder.encode(
            formatEvent({
              type: "error",
              message: err instanceof Error ? err.message : "Pipeline failed to start.",
            })
          )
        );
        controller.close();
      });
    },
    async cancel() {
      child.kill();
      await cleanup();
    },
  });

  result.finally(cleanup);

  return new Response(stream, { headers: SSE_HEADERS });
}

function buildCachedSseBody(
  analysis: Analysis,
  persisted: { slug: string; createdAt: string } | null
): string {
  const lines: string[] = [];
  for (const stage of STAGE_ORDER) {
    lines.push(formatEvent({ type: "stage", stage, status: "done" }));
  }
  lines.push(formatEvent({ type: "result", data: analysis }));
  if (persisted) {
    lines.push(formatEvent({ type: "persisted", data: persisted }));
  }
  return lines.join("");
}

function persistResult(
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
    console.error("Failed to persist streamed analysis", error);
    return null;
  }
}

function transformEvent(
  rawEvent: string,
  onResult?: (analysis: Analysis) => void
): string | null {
  const trimmed = rawEvent.trim();
  if (!trimmed) return null;
  const dataLines = trimmed
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) return null;
  const dataString = dataLines.join("\n");
  let parsed: unknown;
  try {
    parsed = JSON.parse(dataString);
  } catch {
    return null;
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    (parsed as { type?: unknown }).type === "result"
  ) {
    const data = (parsed as { data?: unknown }).data;
    const validated = analysisSchema.safeParse(data);
    if (!validated.success) {
      return formatEvent({
        type: "error",
        message: "Pipeline returned an unexpected payload."
      });
    }
    if (onResult) onResult(validated.data);
    return formatEvent({ type: "result", data: validated.data });
  }
  return formatEvent(parsed);
}

function formatEvent(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function errorEvent(message: string, status: number) {
  const body = `data: ${JSON.stringify({ type: "error", message, status })}\n\n`;
  return new Response(body, {
    status: 200,
    headers: SSE_HEADERS,
  });
}

function validateOptionalFile(file: FormDataEntryValue | null, label: string) {
  if (!(file instanceof File) || file.size === 0) return null;
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
