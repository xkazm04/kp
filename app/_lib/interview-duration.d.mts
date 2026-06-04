// Types for interview-duration.mjs (the plain-JS source of truth, importable by
// the bare-`node` ElevenLabs setup script). Keep in sync with the .mjs exports;
// interview-duration.test.ts cross-checks the numeric invariants.

export const QUICK_SCREEN_MIN: number;
export const GROUNDED_DEFAULT_MIN: number;
export const GROUNDED_MAX_MIN: number;
export const PROVIDER_HEADROOM_MIN: number;
export const PROVIDER_CAP_MIN: number;
export const PROVIDER_MAX_DURATION_SECONDS: number;

export function durationLabel(min: number): string;
export function durationChip(min: number): string;
