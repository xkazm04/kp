import type { AutomationRefusal } from "./automation-run";
import type { RefusalErrorCode } from "./api-response";

// An automation module refusal -> the coded answer the reader sees in their language.
// Shared by every route that runs runAutomationTask, so none of them forwards a raw
// AutomationError message. An AutomationError WITHOUT a refusal token is an engine
// failure (parseStderrError text: traceback, argparse usage, workdir path) and takes
// the STORE path (safeJsonError) instead.
export const REFUSAL_FOR: Record<AutomationRefusal, RefusalErrorCode> = {
  unknown_task: "AUTOMATION_TASK_UNKNOWN",
  entry_not_found: "AUTOMATION_ENTRY_NOT_FOUND",
  entry_has_no_profile: "AUTOMATION_ENTRY_NO_PROFILE",
  task_not_offered: "AUTOMATION_TASK_NOT_OFFERED",
};
