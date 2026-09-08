/**
 * The three moves that fill an empty pipeline board, in the order the PRODUCT
 * enforces — not in the order the old empty state offered them.
 *
 * The order is a real dependency, not an opinion, and that is why it lives in a
 * pure module with a test rather than being re-typed per variant:
 *
 *   1. `intake` — write the job description. Every board lane is keyed by a job
 *      (`entryLaneKey` in pipelineTypes.ts), so until a role exists there is
 *      nothing for a candidate to arrive INTO.
 *   2. `analyze` — put candidates against it. The "Add to pipeline" button on an
 *      analysis result is DISABLED until the run was tagged to a saved JD
 *      (`analyzePipelineRef.ts`, reason "jdless"), so this move genuinely cannot
 *      be done first. The product already teaches the order; the empty state
 *      should stop contradicting it.
 *   3. `channels` — open the careers page / email intake / ad forms so candidates
 *      file themselves in. A next choice, never a prerequisite: an operator can
 *      hire without ever opening one.
 *
 * The old state led with `channels` and pointed "Add a candidate manually" at
 * `archetypes`, which cannot add anyone to the board at all (it builds standalone
 * profiles) — the two things this taxonomy fixes.
 *
 * Pure on purpose: no React, no next-intl, no glyph data. Copy is resolved per
 * variant from `pipeline.emptyState.moves.<key>.*`, and the glyph for a move is a
 * VARIANT's choice (only the sequence variant draws one).
 */

// Type-only, so this module stays runnable under `node --test` type stripping.
import type { WorkspaceTabId } from "@/app/features/shell/tabs";

export type EmptyMoveKey = "role" | "candidates" | "channels";

export type EmptyMove = {
  key: EmptyMoveKey;
  /** The workspace tab this move is done on. */
  tab: WorkspaceTabId;
  /** True for a move the operator may skip forever. Rendered as a chip, never
   *  as a dimmed step — an optional move is still a first-class one. */
  optional: boolean;
};

export const EMPTY_MOVES: readonly EmptyMove[] = [
  { key: "role", tab: "intake", optional: false },
  { key: "candidates", tab: "analyze", optional: false },
  { key: "channels", tab: "channels", optional: true },
];

/** The move an operator should make first on a board with nothing on it. Always
 *  the first entry today (nothing is done yet, by definition of "empty"), but
 *  named so a variant reads intent rather than `EMPTY_MOVES[0]`. */
export const FIRST_MOVE: EmptyMove = EMPTY_MOVES[0];
