import type {
  StageId,
  StageStatus,
} from "@/app/_components/AnalysisProgress";

export type GithubStatus = "idle" | "loading" | "done" | "error";

export type JdSummary = {
  slug: string;
  title: string;
  body: string;
  created_at: string;
};

export type ColumnStatus = {
  tone: "required" | "optional" | "attached";
  label: string;
};

export type ProgressEmitter = (stage: StageId, status: StageStatus) => void;

export const MAX_CV_VARIANTS = 3;
