// Types for asr-keywords.mjs (plain-JS source of truth, importable by the
// bare-`node` ElevenLabs setup script). Keep in sync with the .mjs exports;
// asr-keywords.test.ts pins the normalization and cap rules.

export const ASR_KEYWORD_LIMIT: number;
export const BASE_ASR_KEYWORDS: string[];
export function normalizeKeyword(value: unknown): string | null;
export function buildAsrKeywords(
  jobTerms?: Iterable<unknown>,
  base?: Iterable<unknown>,
  limit?: number,
): string[];
