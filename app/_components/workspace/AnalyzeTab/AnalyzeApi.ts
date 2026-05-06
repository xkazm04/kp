import {
  analysisSchema,
  type Analysis,
} from "@/app/_lib/schemas";
import type { StageId, StageStatus } from "@/app/_components/AnalysisProgress";
import type { ProgressEmitter } from "./AnalyzeTypes";

export async function runStreamingAnalysis(
  cvFile: File,
  jobDescriptionFile: File | null,
  jobDescriptionText: string,
  companyFile: File | null,
  companyText: string,
  jdSlug: string | null,
  onProgress: ProgressEmitter
): Promise<Analysis> {
  const form = new FormData();
  form.append("grounding", "true");
  form.append("cv", cvFile);
  if (jobDescriptionFile) form.append("jobDescription", jobDescriptionFile);
  if (jobDescriptionText.trim()) form.append("jobDescriptionText", jobDescriptionText);
  if (companyFile) form.append("company", companyFile);
  if (companyText.trim()) form.append("companyText", companyText);
  if (jdSlug) form.append("jdSlug", jdSlug);

  const response = await fetch("/api/analyze/stream", { method: "POST", body: form });
  if (!response.ok || !response.body) {
    let message = "Analysis failed.";
    try {
      const text = await response.text();
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let analysis: Analysis | null = null;
  let finalError: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separator = buffer.indexOf("\n\n");
    while (separator !== -1) {
      const rawEvent = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      const event = parseSseEvent(rawEvent);
      if (event) {
        if (event.type === "stage" && event.stage && event.status) {
          onProgress(event.stage as StageId, event.status as StageStatus);
        } else if (event.type === "result") {
          const validated = analysisSchema.safeParse(event.data);
          if (validated.success) analysis = validated.data;
          else finalError = "Pipeline returned an unexpected payload.";
        } else if (event.type === "error") {
          finalError = typeof event.message === "string" ? event.message : "Analysis failed.";
        }
      }
      separator = buffer.indexOf("\n\n");
    }
  }

  if (finalError) throw new Error(finalError);
  if (!analysis) throw new Error("Analysis ended without a result.");
  return analysis;
}

export async function runMultiVariantAnalysis(
  cvFiles: File[],
  jobDescriptionFile: File | null,
  jobDescriptionText: string,
  companyFile: File | null,
  companyText: string,
  jdSlug: string | null,
  onProgress: ProgressEmitter
): Promise<Analysis> {
  // The multi-variant endpoint runs N pipelines in parallel and only emits a
  // single final JSON; drive the progress UI on a soft client-side timeline
  // so the stage strip still animates.
  const stageOrderForFallback: StageId[] = [
    "extract",
    "gemini",
    "profile",
    "scoring",
    "salary",
    "insights",
  ];
  let active = true;
  let stageIdx = 0;
  onProgress(stageOrderForFallback[0], "active");
  const tick = window.setInterval(() => {
    if (!active) return;
    if (stageIdx < stageOrderForFallback.length - 1) {
      onProgress(stageOrderForFallback[stageIdx], "done");
      stageIdx += 1;
      onProgress(stageOrderForFallback[stageIdx], "active");
    }
  }, 1800);

  try {
    const form = new FormData();
    form.append("grounding", "true");
    for (const file of cvFiles) form.append("cvs", file);
    if (jobDescriptionFile) form.append("jobDescription", jobDescriptionFile);
    if (jobDescriptionText.trim()) form.append("jobDescriptionText", jobDescriptionText);
    if (companyFile) form.append("company", companyFile);
    if (companyText.trim()) form.append("companyText", companyText);
    if (jdSlug) form.append("jdSlug", jdSlug);

    const response = await fetch("/api/analyze", { method: "POST", body: form });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "Analysis failed.");
    }
    return analysisSchema.parse(payload);
  } finally {
    active = false;
    window.clearInterval(tick);
  }
}

function parseSseEvent(rawEvent: string): Record<string, unknown> | null {
  const trimmed = rawEvent.trim();
  if (!trimmed) return null;
  const dataLines = trimmed
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) return null;
  try {
    const parsed = JSON.parse(dataLines.join("\n"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
