// SERVER-ONLY: the traced art behind every GlyphId.
//
// This is the one module allowed to value-import the generated /motionize modules
// in ./glyphs/, and only GET /api/glyphs/[id] imports it. A client component that
// imports this file puts ~274 KB of path data back on the workspace page's graph —
// glyphLoader.test.ts walks app/page.tsx and fails if it ever reaches this file or
// any ./glyphs/*Glyph.ts module. Client code asks for art by id through
// glyphLoader.ts instead.
//
// The generated modules are never edited here (they are regenerable from
// .claude/skills/motionize); the catalog serves the very objects they export.
import type { TracedGlyph } from "./MotionizedGlyph";
import { isGlyphId, type GlyphId } from "./glyphRegistry";
import { ANALYTICS_GLYPH } from "./glyphs/analyticsGlyph";
import { DECISIONS_GLYPH } from "./glyphs/decisionsGlyph";
import { DEV_CASES_GLYPH } from "./glyphs/devCasesGlyph";
import { JOBS_GLYPH } from "./glyphs/jobsGlyph";
import { LIBRARY_GLYPH } from "./glyphs/libraryGlyph";
import { MATRIX_GLYPH } from "./glyphs/matrixGlyph";
import { PROFILE_MATRIX_GLYPH } from "./glyphs/profileMatrixGlyph";
import { PROFILE_ROSTER_GLYPH } from "./glyphs/profileRosterGlyph";
import { SCHEDULE_GLYPH } from "./glyphs/scheduleGlyph";

export const GLYPH_CATALOG: Readonly<Record<GlyphId, TracedGlyph>> = {
  analytics: ANALYTICS_GLYPH,
  decisions: DECISIONS_GLYPH,
  devCases: DEV_CASES_GLYPH,
  jobs: JOBS_GLYPH,
  library: LIBRARY_GLYPH,
  matrix: MATRIX_GLYPH,
  profileMatrix: PROFILE_MATRIX_GLYPH,
  profileRoster: PROFILE_ROSTER_GLYPH,
  schedule: SCHEDULE_GLYPH,
};

/** The art for an id, or null for anything that is not a GlyphId. Never throws. */
export function glyphArt(id: string): TracedGlyph | null {
  return isGlyphId(id) ? GLYPH_CATALOG[id] : null;
}
