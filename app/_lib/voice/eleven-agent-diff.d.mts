// Types for eleven-agent-diff.mjs (plain-JS source of truth, importable by the
// bare-`node` ElevenLabs setup script). Keep in sync with the .mjs exports;
// eleven-agent-diff.test.ts cross-checks the diff invariants.

export interface IntendedAgentConfig {
  prompt: string;
  asrKeywords: string[];
  overrides: { prompt: boolean; first_message: boolean; language: boolean };
}

export interface PromptDiff {
  match: boolean;
  intended: string;
  live: string;
  firstDiffAt: number;
}

export interface KeywordDiff {
  match: boolean;
  missing: string[];
  extra: string[];
}

export interface OverrideFlagDiff {
  flag: string;
  intended: boolean;
  live: boolean;
  match: boolean;
}

export interface OverridesDiff {
  match: boolean;
  flags: OverrideFlagDiff[];
}

export interface AgentConfigDiff {
  ok: boolean;
  prompt: PromptDiff;
  asrKeywords: KeywordDiff;
  overrides: OverridesDiff;
}

export function firstDifferenceIndex(a: string, b: string): number;
export function extractLivePrompt(agent: unknown): string;
export function extractLiveKeywords(agent: unknown): string[];
export function extractLiveOverrides(agent: unknown): { prompt: boolean; first_message: boolean; language: boolean };
export function diffAgentConfig(intended: IntendedAgentConfig, agent: unknown): AgentConfigDiff;
export function formatDriftReport(report: AgentConfigDiff): string;
