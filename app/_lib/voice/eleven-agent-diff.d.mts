// Types for eleven-agent-diff.mjs (plain-JS source of truth, importable by the
// bare-`node` ElevenLabs setup script). Keep in sync with the .mjs exports;
// eleven-agent-diff.test.ts cross-checks the diff invariants.

export interface IntendedAgentConfig {
  prompt: string;
  asrKeywords: string[];
  overrides: { prompt: boolean; first_message: boolean; language: boolean; asr_keywords: boolean };
  firstMessage: string;
  language: string;
  llm: string;
  temperature: number;
  maxDurationSeconds: number;
  ttsModel: string;
  textOnly: boolean;
  /** The director's client tool_configs the agent must reference (toElevenClientTool).
   *  Absent → tools are not checked. */
  clientTools?: ElevenClientToolConfig[];
}

/** An ElevenLabs client tool_config as the deploy creates it (POST /v1/convai/tools). */
export interface ElevenClientToolConfig {
  type: "client";
  name: string;
  description: string;
  expects_response: boolean;
  response_timeout_secs: number;
  parameters: {
    type: "object";
    required: string[];
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
  };
}

export interface ClientToolsDiff {
  /** False when the intended config named no client tools (nothing was compared). */
  checked: boolean;
  match: boolean;
  missing: string[];
  extra: string[];
  drifted: { name: string; fields: string[] }[];
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

export interface ScalarFieldDiff {
  key: string;
  label: string;
  intended: string | number | boolean;
  live: unknown;
  match: boolean;
}

export interface ScalarsDiff {
  match: boolean;
  flags: ScalarFieldDiff[];
}

export interface AgentConfigDiff {
  ok: boolean;
  prompt: PromptDiff;
  asrKeywords: KeywordDiff;
  overrides: OverridesDiff;
  scalars: ScalarsDiff;
  tools: ClientToolsDiff;
}

export function firstDifferenceIndex(a: string, b: string): number;
export function extractLivePrompt(agent: unknown): string;
export function extractLiveKeywords(agent: unknown): string[];
export function extractLiveOverrides(agent: unknown): Record<string, boolean>;
export function extractLiveScalars(agent: unknown): Record<string, unknown>;
export function diffAgentConfig(intended: IntendedAgentConfig, agent: unknown, liveTools?: unknown[]): AgentConfigDiff;
export const DIRECTOR_TOOL_RESPONSE_TIMEOUT_SECS: number;
export function toElevenClientTool(def: {
  name: string;
  description: string;
  parameters: { properties: Record<string, { type: string; description?: string; enum?: readonly string[] }>; required: readonly string[] };
}): ElevenClientToolConfig;
export function normalizeClientTool(cfg: unknown): {
  name: string;
  description: string | null;
  expects_response: boolean;
  response_timeout_secs: number | null;
  parameters: { required: string[]; properties: Record<string, { type: unknown; description: string | null; enum: string[] | null }> };
} | null;
export function clientToolDrift(intended: unknown, live: unknown): string[];
export function extractLiveToolIds(agent: unknown): string[];
export function diffClientTools(intended: ElevenClientToolConfig[], live: unknown[]): Omit<ClientToolsDiff, "checked">;
export function formatDriftReport(report: AgentConfigDiff): string;
