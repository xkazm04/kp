// Shared types for the screening auto-reject wave modal, split out so both
// the state hook and the render pieces (DecisionsScreenWaveModal,
// DecisionsScreenWaveLists) can import them without a cycle.

// One decision in the wave (mirrors ScreenDecision in screen-wave.ts). DEC4 —
// `reasonCode`/`reasonParams` are the locale-renderable mirror of the English
// `rationale`; older shapes without them fall back to the raw string.
export type WaveDecision = {
  entryId: string;
  label: string;
  archetype: string | null;
  // null = unscored (never measured). Such rows are always keeps with reasonCode
  // "unscored" — rendered as an explicit dash, never a fabricated 0 (SD-L1-002).
  matchScore: number | null;
  action: "reject" | "keep";
  rationale: string;
  reasonCode?: string;
  reasonParams?: Record<string, string | number>;
  commsFailed?: boolean;
  // Direction 2 (queue-staleness) — server-derived: this score predates the JD's
  // last content edit (`staleSince`). Informs the reviewer that the ranking uses a
  // score against stale text; it never blocks the wave. Absent → no stale chip.
  stale?: boolean;
  staleSince?: string;
};
export type WaveResult = {
  decisions: WaveDecision[];
  rejected: number;
  kept: number;
  cohort: number;
  commsFailures: number;
  dryRun: boolean;
  approvalToken?: string;
};
