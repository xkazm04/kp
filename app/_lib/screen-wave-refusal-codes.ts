import type { ScreenWaveRefusalReason } from "./screen-wave-contract.ts";
import type { RefusalErrorCode } from "./api-response.ts";

/** The registered refusal code for each of the five human-approval refusals. ONE
 *  definition, shared by the screen-wave route and the role-run gate commit route: the
 *  two doors apply the same protocol, so a refusal reads the same on both. */
export const SCREEN_WAVE_APPROVAL_CODES = {
  required: "SCREEN_WAVE_APPROVAL_REQUIRED",
  expired: "SCREEN_WAVE_APPROVAL_EXPIRED",
  mismatch: "SCREEN_WAVE_APPROVAL_MISMATCH",
  spent: "SCREEN_WAVE_APPROVAL_SPENT",
  unattributed: "SCREEN_WAVE_APPROVAL_UNATTRIBUTED",
} as const satisfies Record<ScreenWaveRefusalReason, RefusalErrorCode>;
