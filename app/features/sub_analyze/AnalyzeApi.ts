import { analysisSchema, type Analysis } from "@/app/_lib/schemas";
import type { StageId, StageStatus } from "@/app/_components/AnalysisProgress";
import type { ProgressEmitter } from "./AnalyzeTypes";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// POST the upload; the server persists it and starts a background `analyze`
// task, returning its id. The actual run is tracked + refresh-safe via /api/tasks.
export async function submitAnalysis(
  cvFiles: File[],
  jobDescriptionFile: File | null,
  jobDescriptionText: string,
  companyFile: File | null,
  companyText: string,
  jdSlug: string | null
): Promise<string> {
  const form = new FormData();
  form.append("grounding", "true");
  if (cvFiles.length === 1) form.append("cv", cvFiles[0]);
  else for (const file of cvFiles) form.append("cvs", file);
  if (jobDescriptionFile) form.append("jobDescription", jobDescriptionFile);
  if (jobDescriptionText.trim()) form.append("jobDescriptionText", jobDescriptionText);
  if (companyFile) form.append("company", companyFile);
  if (companyText.trim()) form.append("companyText", companyText);
  if (jdSlug) form.append("jdSlug", jdSlug);

  const response = await fetch("/api/analyze", { method: "POST", body: form });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Analysis failed.");
  const taskId = payload.task?.id as string | undefined;
  if (!taskId) throw new Error("Analysis did not start.");
  return taskId;
}

// Poll a running analyze task to completion, animating the stage strip on a
// soft timeline (the pipeline emits one final result, not per-token stages).
export async function watchAnalysis(taskId: string, onProgress: ProgressEmitter): Promise<Analysis> {
  const stages: StageId[] = ["extract", "gemini", "profile", "scoring", "salary", "insights"];
  let active = true;
  let idx = 0;
  onProgress(stages[0], "active");
  const tick = window.setInterval(() => {
    if (!active) return;
    if (idx < stages.length - 1) {
      onProgress(stages[idx], "done" as StageStatus);
      idx += 1;
      onProgress(stages[idx], "active" as StageStatus);
    }
  }, 1800);

  try {
    while (true) {
      await delay(1500);
      const r = await fetch(`/api/tasks/${taskId}`);
      if (!r.ok) continue;
      const { task } = await r.json();
      if (!task) continue;
      if (task.status === "succeeded") {
        const parsed = analysisSchema.safeParse(task.result);
        if (parsed.success) return parsed.data;
        throw new Error("Analysis returned an unexpected payload.");
      }
      if (task.status === "failed" || task.status === "canceled" || task.status === "interrupted") {
        throw new Error(task.error ?? "Analysis did not complete.");
      }
    }
  } finally {
    active = false;
    window.clearInterval(tick);
  }
}

// Extract plain text from an uploaded document via the server-side Python
// extractor (the same one the CV pipeline uses). Lets the GitHub deep-dive read
// a file-only JD instead of silently treating it as empty.
export async function extractFileText(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/extract-text", { method: "POST", body: form });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload.text !== "string") {
    throw new Error(payload?.error ?? "Text extraction failed.");
  }
  return payload.text;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
