import type { WorkspaceTabId } from "@/app/features/shell/tabs";
import type { TracedGlyph } from "./MotionizedGlyph";
import { ANALYTICS_GLYPH } from "./glyphs/analyticsGlyph";
import { CHANNEL_COMMS_GLYPH } from "./glyphs/channelCommsGlyph";
import { DECISIONS_GLYPH } from "./glyphs/decisionsGlyph";
import { DEV_CASES_GLYPH } from "./glyphs/devCasesGlyph";
import { JOBS_GLYPH } from "./glyphs/jobsGlyph";
import { LIBRARY_GLYPH } from "./glyphs/libraryGlyph";
import { MATRIX_GLYPH } from "./glyphs/matrixGlyph";
import { PROFILE_MATRIX_GLYPH } from "./glyphs/profileMatrixGlyph";
import { PROFILE_ROSTER_GLYPH } from "./glyphs/profileRosterGlyph";
import { SCHEDULE_GLYPH } from "./glyphs/scheduleGlyph";

// Tab → traced glyph for first-run empty states. Channel pane extras
// (ads / careers / email) stay in channelsEmptySpecs; the tab default is comms.
// Archetypes has two projections — list uses the roster trace, matrix uses its
// own — so ARCHETYPE_VIEW_GLYPHS keys the second module.
export const GLYPH_BY_TAB = {
  jobs: JOBS_GLYPH,
  library: LIBRARY_GLYPH,
  analytics: ANALYTICS_GLYPH,
  decisions: DECISIONS_GLYPH,
  channels: CHANNEL_COMMS_GLYPH,
  schedule: SCHEDULE_GLYPH,
  assignments: DEV_CASES_GLYPH,
  archetypes: PROFILE_ROSTER_GLYPH,
  matrix: MATRIX_GLYPH,
} as const satisfies Partial<Record<WorkspaceTabId, TracedGlyph>>;

export const ARCHETYPE_VIEW_GLYPHS = {
  list: PROFILE_ROSTER_GLYPH,
  matrix: PROFILE_MATRIX_GLYPH,
} as const;

export type GlyphRegistryTabId = keyof typeof GLYPH_BY_TAB;

/** Lookup. Unknown / unmapped tab → undefined, never throws. */
export function glyphForTab(id: string): TracedGlyph | undefined {
  if (!Object.hasOwn(GLYPH_BY_TAB, id)) return undefined;
  return GLYPH_BY_TAB[id as GlyphRegistryTabId];
}
