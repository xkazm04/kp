// Types for director-tools.mjs (plain-JS source of truth, importable by the
// bare-`node` ElevenLabs setup script). Keep in sync with the .mjs exports;
// director-tools.test.ts pins that every name has exactly one definition.

export const DIRECTOR_TOOL_NAMES: readonly [
  "begin_topic",
  "mark_topic_covered",
  "report_guardrail",
  "forward_question",
  "report_extra_time",
  "end_interview",
];
export const GUARDRAIL_KINDS: readonly ["score_request", "instruction_override", "prompt_disclosure", "off_topic"];
export const END_REASONS: readonly ["complete", "time", "candidate_request"];
export const OVERRUN_ANSWERS: readonly ["agreed", "declined"];
export const MAX_EVIDENCE_QUOTE_CHARS: number;
export type DirectorToolDef = {
  name: (typeof DIRECTOR_TOOL_NAMES)[number];
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description?: string; enum?: readonly string[] }>;
    required: readonly string[];
    additionalProperties: false;
  };
};
export const DIRECTOR_TOOL_DEFS: readonly DirectorToolDef[];
export const DIRECTOR_NOTE_PREFIX: string;
