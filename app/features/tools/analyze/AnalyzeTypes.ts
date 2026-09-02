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

// Stable codes for user-facing analyze failures — each is a key in the `analyze`
// message namespace, so the surface localizes them (the API helpers that throw
// these aren't components and can't translate). Kept as a closed union so a typo
// or an un-added key is a compile error against the next-intl catalog.
export type AnalyzeErrorCode =
  | "errFailed"
  | "errNotStarted"
  | "errLostTrack"
  | "errUnavailable"
  | "errIncomplete"
  | "errBadPayload"
  | "errExtractionFailed"
  | "errGithubFailed";

// Non-error, localizable notices a run can emit (e.g. the GitHub deep-dive ran
// JD-blind because the attached JD wouldn't extract). Also `analyze`-namespace keys.
export type AnalyzeNoticeCode = "githubJdDropped";

// The localizable descriptor a run hands back on failure/degradation: a stable
// `code` the surface maps, plus optional engine/server English preferred verbatim
// when present (see AnalyzeClientError). onWarning reuses the same shape (code only).
// `apiCode` is a route's OWN machine code (`{ error, code }`) when the failing
// call has one — today the GitHub deep-dive's `results.github.errors.*`. It wins
// over `serverText`: a code resolves in the reader's language, and preferring the
// server's English over it would be the English-fallback-chain trap by another name.
export type AnalyzeErrorInfo = {
  code?: AnalyzeErrorCode | AnalyzeNoticeCode;
  apiCode?: string;
  serverText?: string;
  /** The refusal's HTTP status, when the failure came off a response. */
  status?: number;
  /** Seconds from a `Retry-After` header, when the boundary sent one — turns the
   *  open-ended throttle line into "try again in N seconds". */
  retryAfterSeconds?: number;
};

// Re-exported from the single source of truth so existing imports keep working.
export { MAX_CV_VARIANTS } from "@/app/_lib/upload-constraints";
