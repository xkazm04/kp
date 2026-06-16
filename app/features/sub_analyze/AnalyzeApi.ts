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
  jdSlug: string | null,
  reportLang?: string,
  blind?: boolean
): Promise<string> {
  const form = new FormData();
  form.append("grounding", "true");
  if (blind) form.append("blind", "true");
  if (cvFiles.length === 1) form.append("cv", cvFiles[0]);
  else for (const file of cvFiles) form.append("cvs", file);
  if (jobDescriptionFile) form.append("jobDescription", jobDescriptionFile);
  if (jobDescriptionText.trim()) form.append("jobDescriptionText", jobDescriptionText);
  if (companyFile) form.append("company", companyFile);
  if (companyText.trim()) form.append("companyText", companyText);
  if (jdSlug) form.append("jdSlug", jdSlug);
  if (reportLang) form.append("reportLang", reportLang); // CV3 — per-run report language

  const response = await fetch("/api/analyze", { method: "POST", body: form });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Analysis failed.");
  const taskId = payload.task?.id as string | undefined;
  if (!taskId) throw new Error("Analysis did not start.");
  return taskId;
}

// Poll a running analyze task to completion, animating the stage strip on a
// soft timeline (the pipeline emits one final result, not per-token stages).
export async function watchAnalysis(
  taskId: string,
  onProgress: ProgressEmitter,
  signal?: AbortSignal
): Promise<Analysis> {
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

  // A permanently-failing poll (the task row was reaped after a `next dev`
  // hot-restart, or the in-memory runner was lost) must not spin forever with no
  // escape. Count consecutive non-OK polls and bail past a threshold; a healthy
  // slow run keeps returning 200 (status "running") and resets the counter, so a
  // legitimately long analysis is never abandoned. A 404 is terminal on its own.
  const MAX_CONSECUTIVE_ERRORS = 10; // ~15s of solid failure at the 1.5s cadence
  let consecutiveErrors = 0;
  // Count one soft (non-terminal) poll failure and bail past the threshold. The
  // three soft-failure branches below (thrown fetch, non-OK response, missing task
  // body) all funnel through here so the threshold and the user-facing message stay
  // single-sourced.
  const softFail = () => {
    if ((consecutiveErrors += 1) >= MAX_CONSECUTIVE_ERRORS) {
      throw new Error("Lost track of the analysis — please retry.");
    }
  };
  const aborted = () => signal?.aborted ?? false;

  try {
    while (true) {
      if (aborted()) throw new DOMException("Analysis watch aborted", "AbortError");
      await delay(1500);
      if (aborted()) throw new DOMException("Analysis watch aborted", "AbortError");
      let r: Response;
      try {
        r = await fetch(`/api/tasks/${taskId}`, { signal });
      } catch (err) {
        if (aborted()) throw err; // intentional cancel — surfaced as AbortError
        softFail();
        continue;
      }
      // 404 = the task is gone (reaped / lost to a restart); it will never reach a
      // terminal success, so stop now rather than poll a vanished task forever.
      if (r.status === 404) throw new Error("The analysis is no longer available — please retry.");
      if (!r.ok) {
        softFail();
        continue;
      }
      const body = await r.json().catch(() => null);
      const task = body?.task;
      if (!task) {
        softFail();
        continue;
      }
      consecutiveErrors = 0;
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
