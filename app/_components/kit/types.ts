/*
 * The composition kit's shared vocabulary (kit-unification spark; contest style-kit-r2, winner
 * "One Measure", API sketch in .contest/arena/style-kit-r2/entries/.../variant-1/API.md).
 *
 * Two layers share these types:
 *  - the EVERYDAY parts (PageHead, Section, ListRow, StatStrip, KeyValueGrid, ChipRow, Toolbar,
 *    SettingRow, DataTable, ReadingPane, Button, Mark) that every surface composes;
 *  - the GRAPHIC parts (ShapeMark, Sieve, StageRail, Lane, Skyline) for the few surfaces whose
 *    data has a shape worth seeing (the hiring pipeline, the journey board).
 * Every row-shaped part sits on ONE grid template, the measure: mark | name | meta | fig | time | act.
 */

/** Set once on a surface root (`data-density`). Changes spacing, leading and row height, never type size. */
export type Density = "compact" | "calm";

/** The measure's named tracks. Callers name a track; they never pass column widths. */
export type Track = "mark" | "name" | "meta" | "fig" | "time" | "act";

/** Row / section tone. Coral is not a tone: coral means "needs you" and is a row state. */
export type RowTone = "default" | "caution" | "critical";

/** An everyday status mark. Meaning is carried by SHAPE; colour is secondary. */
export type MarkKind =
  | "ok" | "wait" | "needs" | "fail" | "bounce" | "recovered" | "unknown" | "caution"
  | "human" | "machine" | "nobody";

/** generated -> hollow mark + italic name; name-only -> "≈" + wavy rule. Italic means "generated" and nothing else. */
export type Provenance = "observed" | "generated" | "name-only";

/** A figure in a page head or stat strip. `value: null` renders "—" with its reason as a Tooltip, never 0. */
export type Figure = {
  label: string;
  value: number | string | null;
  of?: number;
  unit?: string;
  delta?: number;
  /** 0..1 - draw the quantity as a bar under the figure. */
  draw?: number;
  tone?: "default" | "needs";
  /** Required when value is null: why there is no value. */
  tip?: string;
};

/** Row states. "needs" = the coral waiting-on-you edge. */
export type RowState = "selected" | "hover" | "muted" | "needs";

/** Loading / error state a part renders itself (loading-choreography: no skeletons). */
export type PartState = "ready" | "loading" | "error";

/* ---------------------------------------------------------------- graphic layer */

/**
 * How an item reached its state, drawn as the dot's shape:
 * solid = observed (a recorded row proves it) · half = observed, identity uncertain (name-only match)
 * ring = not observed (generated, or placed without a recorded move) · dashed = nothing on record (reason attached)
 * none = never reached · exit = left (rejected)
 */
export type ShapeKind = "solid" | "half" | "ring" | "dashed" | "none" | "exit";

/** The stage ramp, token-backed (`--tone-*` in kit.css). */
export type StageTone = "accepted" | "screened" | "interview" | "offer" | "hired" | "out" | "quiet" | "default";

/** Motion plays once per data change: change `replayKey` when the data changes; an equal key = no motion. */
export type Replay = { replayKey: string };
