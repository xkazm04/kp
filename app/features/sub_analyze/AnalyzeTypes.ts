import type {
  StageId,
  StageStatus,
} from "@/app/_components/AnalysisProgress";

export type GithubStatus = "idle" | "loading" | "done" | "error";

export type JdSummary = {
  slug: string;
  title: string;
  preview: string;
  created_at: string;
};

export type ColumnStatus = {
  tone: "required" | "optional" | "attached";
  label: string;
};

export type ProgressEmitter = (stage: StageId, status: StageStatus) => void;

// Re-exported from the single source of truth so existing imports keep working.
export { MAX_CV_VARIANTS } from "@/app/_lib/upload-constraints";
