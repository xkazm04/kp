import type { WorkspaceTabId } from "@/app/features/shell/tabs";

// The traced-glyph vocabulary: NAMES only, never art.
//
// Each id is a generated /motionize module in ./glyphs/ minus its `Glyph.ts`
// suffix (`jobsGlyph.ts` -> "jobs"). The art itself (8-36 KB of emitted path data
// per glyph) is served by GET /api/glyphs/[id] from the server-only glyphCatalog.ts
// and fetched on demand by glyphLoader.ts, so importing this file costs a few
// hundred bytes instead of the ~274 KB it used to put on the workspace page's
// import graph. Keep it that way: a value import of a ./glyphs/ module here, or
// anywhere a client component reaches, puts the art straight back.
//
// Literal array + derived union + runtime guard: the house shape of tabs.ts and
// task-kinds.ts.
export const GLYPH_IDS = [
  "analytics",
  "channelAds",
  "channelCareers",
  "channelComms",
  "channelEmail",
  "decisions",
  "devCases",
  "jobs",
  "library",
  "matrix",
  "profileMatrix",
  "profileRoster",
  "schedule",
] as const;

export type GlyphId = (typeof GLYPH_IDS)[number];

const GLYPH_ID_SET: ReadonlySet<string> = new Set(GLYPH_IDS);

/** Runtime guard — a Set lookup, so `"constructor"` and friends are not ids. */
export function isGlyphId(value: unknown): value is GlyphId {
  return typeof value === "string" && GLYPH_ID_SET.has(value);
}

// Tab → traced glyph for first-run empty states. Channel pane extras
// (ads / careers / email) stay in channelsEmptySpecs; the tab default is comms.
// Archetypes has two projections — list uses the roster trace, matrix uses its
// own — so ARCHETYPE_VIEW_GLYPHS keys the second id.
export const GLYPH_BY_TAB = {
  jobs: "jobs",
  library: "library",
  analytics: "analytics",
  decisions: "decisions",
  channels: "channelComms",
  schedule: "schedule",
  assignments: "devCases",
  archetypes: "profileRoster",
  matrix: "matrix",
} as const satisfies Partial<Record<WorkspaceTabId, GlyphId>>;

export const ARCHETYPE_VIEW_GLYPHS = {
  list: "profileRoster",
  matrix: "profileMatrix",
} as const satisfies Record<string, GlyphId>;

export type GlyphRegistryTabId = keyof typeof GLYPH_BY_TAB;

/** Lookup. Unknown / unmapped tab → undefined, never throws. */
export function glyphForTab(id: string): GlyphId | undefined {
  if (!Object.hasOwn(GLYPH_BY_TAB, id)) return undefined;
  return GLYPH_BY_TAB[id as GlyphRegistryTabId];
}
