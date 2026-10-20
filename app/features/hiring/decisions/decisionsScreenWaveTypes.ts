// Shared types for the screening auto-reject wave modal, split out so both
// the state hook and the render pieces (DecisionsScreenWaveModal,
// DecisionsScreenWaveLists) can import them without a cycle.

import type { ScreenDecisionRead, ScreenWaveRead } from "@/app/_lib/screen-wave-contract";

// One decision / one wave, exactly as the client may trust them after
// readWaveResult (screen-wave-contract.ts). These used to be a hand mirror of the
// server types that had drifted: a bare-string reasonCode, and a REQUIRED `holdout`
// count the server never sent. Holdout keeps are counted from their reason codes
// (holdoutCount in decisionsFloorDisclosure.ts); an unknown reason code arrives as
// null and renders from the English `rationale`.
export type WaveDecision = ScreenDecisionRead;
export type WaveResult = ScreenWaveRead;

/** What the tab keeps after the wave modal closes. */
export type WaveCommitSummary = {
  commsFailures: number;
  failedLabels: string[];
  sealFailures: number;
};

/** True when the post-commit banner must say the chain is incomplete. */
export function committedWaveNeedsSealBanner(summary: { sealFailures: number }): boolean {
  return summary.sealFailures > 0;
}
