// The board's layout model — everything the DOM needs, computed once, in one
// pass over the events.
//
// WHY A PLAN AT ALL. The board is a grid: row `n` of a cluster means the SAME
// canonical step in every column of that cluster, which is the whole reason the
// rail was imported from the contest's runner-up. A grid needs every cell's row
// to be decided before any cell is drawn, and the board must stay responsive at
// ~99 columns, so the decision cannot be made by the DOM.
//
// THE COST SHAPE, stated so it can be checked (journeyLayout.test.ts does):
// planning is O(total events + clusters x rail length), NOT O(columns x rows).
// Each column's cells are stored SPARSELY — one entry per event, never one per
// row — so a 99-column board with 1,131 events allocates ~1,131 cells, not
// 99 x 40 = 3,960 nulls. Lazy DOM mounting (useVisibleColumns.ts) is layered on
// top of this; the plan itself is cheap enough to compute eagerly, and it has to
// be, because the row heights every column shares are derived from all of them.
//
// Pure and JSX-free so `node --test` can load it.

import type {
  JourneyBoard,
  JourneyColumn,
  JourneyEvent,
  JourneyPhaseId,
  JourneyRailStep,
  RoleCluster,
} from "@/app/_lib/journey/types";
import { JOURNEY_PHASE_IDS } from "@/app/_lib/journey/types";
import { alignEventsToRail, lastReachedRailIndex } from "./railCells";
import { isObservedRow } from "./journeyMarks";

/** A stretch of this many whole days or more between two consecutive rows in the
 *  same phase prints its own silence marker. "Nothing happened" and "we never
 *  recorded this" must never look the same, and neither may be silently elided. */
export const SILENCE_DAYS = 7;

const DAY_MS = 86_400_000;

/** One row of one column. `silenceDays` is set when the record went quiet for
 *  SILENCE_DAYS or more before this event. */
export type JourneyCell = {
  event: JourneyEvent;
  silenceDays?: number;
};

/**
 * What a whole band says when it holds no rows. THREE states that must never
 * look alike (acceptance criterion 5):
 *
 *  - `nothing-happened` — the phase did not happen AND the record says why.
 *    `journey.absence.nothingHappened` over the phase's own `absenceReasonKey`.
 *  - `never-recorded`   — nothing is on file and no reason either. That covers
 *    two cases the contract allows and that are the same fact to a reader: an
 *    `absenceReasonKey` no catalog can resolve, and the `present: true` band
 *    that carries no rows (types.ts calls this contradiction out by name — the
 *    contest's own staged material shipped 22 of them).
 *  - `rows`             — it happened. `allGenerated` flags the band whose every
 *    row fails `isObservedRow`, which earns the amber strip.
 */
export type BandState =
  | { kind: "rows"; allGenerated: boolean }
  | { kind: "nothing-happened"; reasonKey: string }
  | { kind: "never-recorded" };

export type ColumnBand = {
  state: BandState;
  /** rowIndex -> cell. Sparse: one entry per event, never one per row. */
  cells: Map<number, JourneyCell>;
  /**
   * The first row of the "never reached" block — the journey ended before here,
   * so it runs unbroken to the foot of the band. `-1` when the column has rows
   * later than this band and every gap here is a `skipped`.
   */
  tailFrom: number;
};

export type ColumnPlan = {
  column: JourneyColumn;
  bands: Map<JourneyPhaseId, ColumnBand>;
  /** Rows surviving the current filters — what the minimap draws. */
  visibleRows: number;
};

export type PhasePlan = {
  phase: JourneyPhaseId;
  steps: JourneyRailStep[];
  /** steps.length plus however many rows the overflow needed. */
  rowCount: number;
  /** rowIndex -> at least one column here opens that row with a silence marker,
   *  so every column's row `n` must reserve the same extra height. */
  silentRows: boolean[];
};

export type ClusterPlan = {
  cluster: RoleCluster;
  /** The job-definition band, drawn ONCE above all the columns. */
  shared: JourneyCell[];
  sharedSilentRows: boolean[];
  /** Rail steps for the job-definition phase, beside the shared rows. */
  sharedSteps: JourneyRailStep[];
  sharedRowCount: number;
  phases: Map<JourneyPhaseId, PhasePlan>;
  columns: ColumnPlan[];
};

export type BoardPlan = {
  clusters: ClusterPlan[];
  /** Global row count per phase: the max across clusters, so a phase band is the
   *  same height everywhere and the bands line up across the whole board. */
  bandRows: Map<JourneyPhaseId, number>;
  sharedRowCount: number;
  /** Which phases any column actually has rows for. `job-definition` normally
   *  belongs to the role rather than to a candidate, so drawing 99 identical
   *  empty bands for it would be noise — it is included only if some column has
   *  one. */
  columnPhases: JourneyPhaseId[];
  totals: { columns: number; rows: number; observed: number };
};

export type PlanOptions = {
  /** Resolves an `absenceReasonKey` against the catalog. Injected rather than
   *  imported so this module stays free of next-intl and stays testable. */
  hasKey: (key: string) => boolean;
  /** "Observed rows only": drop every row that is not a real, certainly
   *  attributed product row (see journeyMarks.isObservedRow). */
  observedOnly?: boolean;
};

/**
 * An `absenceReasonKey` arrives as a string. types.ts documents it as a key
 * under `journey.absence.*`, and render-keys.ts's sibling convention is that a
 * key is relative to the `journey.` namespace — but a projector that writes the
 * absolute path is equally plausible, so accept both and let the caller's
 * `hasKey` decide. A key nothing can resolve is reported as `never-recorded`
 * rather than rendered raw: a bare `absence.somethingNew` in the middle of a
 * band is worse than an honest "no reason on file".
 */
export function normalizeAbsenceKey(key: string): string {
  return key.startsWith("journey.") ? key.slice("journey.".length) : key;
}

function silenceBefore(previous: JourneyEvent | undefined, event: JourneyEvent): number | undefined {
  if (!previous) return undefined;
  const a = Date.parse(previous.occurredAt);
  const b = Date.parse(event.occurredAt);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return undefined;
  const days = Math.floor((b - a) / DAY_MS);
  return days >= SILENCE_DAYS ? days : undefined;
}

/** Events of one phase, in the order the contract guarantees (occurredAt, id). */
function eventsInPhase(column: JourneyColumn, phase: JourneyPhaseId, observedOnly: boolean): JourneyEvent[] {
  const out: JourneyEvent[] = [];
  for (const event of column.events) {
    if (event.phase !== phase) continue;
    if (observedOnly && !isObservedRow(event, column.origin)) continue;
    out.push(event);
  }
  return out;
}

function resolveBandState(
  column: JourneyColumn,
  phase: JourneyPhaseId,
  rows: JourneyEvent[],
  hasKey: (key: string) => boolean
): BandState {
  const state = column.phases[phase];
  if (state && !state.present) {
    const key = normalizeAbsenceKey(state.absenceReasonKey);
    return hasKey(key) ? { kind: "nothing-happened", reasonKey: key } : { kind: "never-recorded" };
  }
  if (rows.length === 0) return { kind: "never-recorded" };
  return { kind: "rows", allGenerated: rows.every((e) => !isObservedRow(e, column.origin)) };
}

function planCluster(cluster: RoleCluster, options: PlanOptions): ClusterPlan {
  const observedOnly = options.observedOnly === true;
  const stepsByPhase = new Map<JourneyPhaseId, JourneyRailStep[]>();
  for (const phase of JOURNEY_PHASE_IDS) stepsByPhase.set(phase, []);
  for (const step of [...cluster.rail].sort((a, b) => a.index - b.index)) {
    stepsByPhase.get(step.phase)?.push(step);
  }

  // ── the shared job-definition band, drawn once above the whole cluster ──
  const sharedSource = observedOnly
    ? cluster.sharedEvents.filter((e) => isObservedRow(e, undefined))
    : cluster.sharedEvents;
  const shared: JourneyCell[] = [];
  for (let i = 0; i < sharedSource.length; i++) {
    const days = silenceBefore(sharedSource[i - 1], sharedSource[i]);
    shared.push(days === undefined ? { event: sharedSource[i] } : { event: sharedSource[i], silenceDays: days });
  }
  const sharedSteps = stepsByPhase.get("job-definition") ?? [];
  const sharedRowCount = Math.max(shared.length, sharedSteps.length);
  const sharedSilentRows = new Array<boolean>(sharedRowCount).fill(false);
  shared.forEach((cell, i) => {
    if (cell.silenceDays !== undefined) sharedSilentRows[i] = true;
  });

  // ── the column grid ──
  // Row counts are per phase and per cluster: a rail is per role, so equal
  // vertical position in two clusters is NOT the same step (journey.rail.note).
  // Only the BAND heights are equalised across clusters, further down.
  const phases = new Map<JourneyPhaseId, PhasePlan>();
  for (const phase of JOURNEY_PHASE_IDS) {
    const steps = stepsByPhase.get(phase) ?? [];
    phases.set(phase, { phase, steps, rowCount: steps.length, silentRows: [] });
  }

  const columns: ColumnPlan[] = [];
  for (const column of cluster.columns) {
    const bands = new Map<JourneyPhaseId, ColumnBand>();
    let visibleRows = 0;
    // Where the journey actually stopped, across the whole rail — the input to
    // `skipped` vs `never-reached`. A gap before this point is a step the
    // journey went on without; a gap after it is the floor of the funnel.
    let lastPhase = -1;
    let lastRow = -1;

    for (let p = 0; p < JOURNEY_PHASE_IDS.length; p++) {
      const phase = JOURNEY_PHASE_IDS[p];
      const plan = phases.get(phase);
      if (!plan) continue;
      const rows = eventsInPhase(column, phase, observedOnly);
      const state = resolveBandState(column, phase, rows, options.hasKey);
      const cells = new Map<number, JourneyCell>();

      if (state.kind === "rows") {
        const { placedAt, occupied, overflow } = alignEventsToRail(rows, plan.steps);
        // An event with no free rail step still gets a row, appended after the
        // last step. Never dropped: a swallowed row is the defect this feature
        // exists to remove.
        const overflowRow = new Map<number, number>();
        overflow.forEach((eventIndex, k) => overflowRow.set(eventIndex, plan.steps.length + k));
        if (overflow.length > 0) {
          plan.rowCount = Math.max(plan.rowCount, plan.steps.length + overflow.length);
        }
        for (let i = 0; i < rows.length; i++) {
          const row = placedAt[i] >= 0 ? placedAt[i] : (overflowRow.get(i) ?? -1);
          if (row < 0) continue;
          const days = silenceBefore(rows[i - 1], rows[i]);
          cells.set(row, days === undefined ? { event: rows[i] } : { event: rows[i], silenceDays: days });
          if (row > lastRow || p > lastPhase) {
            lastPhase = p;
            lastRow = row;
          }
        }
        visibleRows += rows.length;
        const reached = lastReachedRailIndex(occupied);
        bands.set(phase, { state, cells, tailFrom: reached >= 0 ? reached + 1 : 0 });
      } else {
        bands.set(phase, { state, cells, tailFrom: -1 });
      }
    }

    // Second pass: a band earlier than the journey's last position has no tail
    // at all — every gap in it is a `skipped`. Only the band the journey died
    // in, and the bands after it, carry the "never reached" block.
    for (let p = 0; p < JOURNEY_PHASE_IDS.length; p++) {
      const band = bands.get(JOURNEY_PHASE_IDS[p]);
      if (!band || band.state.kind !== "rows") continue;
      if (p < lastPhase) band.tailFrom = -1;
      else if (p > lastPhase) band.tailFrom = 0;
      else band.tailFrom = lastRow + 1;
    }

    columns.push({ column, bands, visibleRows });
  }

  // Silence reserves extra height, and every column's row `n` must reserve the
  // same amount or the grid stops lining up. Collected after all the columns are
  // planned, because it is a property of the ROW, not of a column.
  for (const [phase, plan] of phases) {
    const silent = new Array<boolean>(plan.rowCount).fill(false);
    for (const col of columns) {
      const band = col.bands.get(phase);
      if (!band) continue;
      for (const [row, cell] of band.cells) {
        if (cell.silenceDays !== undefined && row < silent.length) silent[row] = true;
      }
    }
    plan.silentRows = silent;
  }

  return { cluster, shared, sharedSilentRows, sharedSteps, sharedRowCount, phases, columns };
}

export function planBoard(board: JourneyBoard, options: PlanOptions): BoardPlan {
  const clusters = board.clusters.map((cluster) => planCluster(cluster, options));

  const bandRows = new Map<JourneyPhaseId, number>();
  for (const phase of JOURNEY_PHASE_IDS) {
    let max = 0;
    for (const plan of clusters) max = Math.max(max, plan.phases.get(phase)?.rowCount ?? 0);
    bandRows.set(phase, max);
  }
  const sharedRowCount = clusters.reduce((max, plan) => Math.max(max, plan.sharedRowCount), 0);

  const columnPhases = JOURNEY_PHASE_IDS.filter((phase) => {
    if (phase !== "job-definition") return true;
    // Only draw a per-column job-definition band if some column really has one;
    // the role's own conversation lives in the shared band above.
    return clusters.some((plan) =>
      plan.columns.some((col) => {
        const band = col.bands.get(phase);
        return band !== undefined && band.cells.size > 0;
      })
    );
  });

  let columns = 0;
  let rows = 0;
  let observed = 0;
  for (const plan of clusters) {
    columns += plan.columns.length;
    for (const col of plan.columns) {
      for (const event of col.column.events) {
        rows++;
        if (isObservedRow(event, col.column.origin)) observed++;
      }
    }
  }

  return { clusters, bandRows, sharedRowCount, columnPhases, totals: { columns, rows, observed } };
}

/* ── Row geometry ────────────────────────────────────────────────────────────
 *
 * Heights are computed here rather than left to the browser because the rail,
 * the phase gutter and 99 columns have to agree on where row `n` starts, and
 * `height: auto` in one column would silently move it in all the others.
 *
 * The base unit is NOT a constant: `nextRowUnit` below lets the board raise it
 * once, globally, when a rendered sentence turns out to need more room than the
 * current unit gives it. That is how "a clipped sentence is a defect, not a
 * trade-off" is kept true in cs/de/fr and under the app's larger-text setting,
 * without measuring text before it exists. One number, so alignment survives.
 */

/** Height of one row in a band, in px, given the board's current base unit. */
export function rowHeight(base: number, silence: boolean, silenceHeight: number): number {
  return base + (silence ? silenceHeight : 0);
}

/** Total height of a band with these silence flags, padded to `rowCount` rows. */
export function bandHeight(rowCount: number, silentRows: readonly boolean[], base: number, silenceHeight: number): number {
  let total = 0;
  for (let i = 0; i < rowCount; i++) total += rowHeight(base, silentRows[i] === true, silenceHeight);
  return total;
}

/** The y offset of row `i` inside its band. */
export function rowOffset(index: number, silentRows: readonly boolean[], base: number, silenceHeight: number): number {
  let y = 0;
  for (let i = 0; i < index; i++) y += rowHeight(base, silentRows[i] === true, silenceHeight);
  return y;
}

/**
 * The row unit that WOULD have fitted these measured cells. Lives here rather
 * than beside the hook that calls it so `node --test` can load the arithmetic
 * without pulling React in.
 */
export function requiredRowUnit(
  current: number,
  cells: readonly { scrollHeight: number; clientHeight: number }[]
): number {
  let needed = current;
  for (const cell of cells) {
    if (cell.clientHeight <= 0) continue;
    const overflow = cell.scrollHeight - cell.clientHeight;
    if (overflow > 0) needed = Math.max(needed, current + overflow);
  }
  return nextRowUnit(current, needed, JOURNEY_ROW_MAX);
}

/** Monotonic: the unit only ever grows, so a column mounting late can widen the
 *  grid but never make it jump back and re-clip a sentence the reader is on.
 *  `max` is a sanity ceiling — a pathological string should scroll its own cell,
 *  not push every row on the board to 300px. */
export function nextRowUnit(current: number, measured: number, max: number): number {
  if (!Number.isFinite(measured) || measured <= current) return current;
  return Math.min(max, Math.ceil(measured));
}

/* ── The board's fixed geometry ──────────────────────────────────────────────
 *
 * In px, and in one place, because the rail, the phase gutter, the minimap and
 * every column derive their positions from the same numbers. `JOURNEY_ROW_BASE`
 * is only the STARTING unit — see `nextRowUnit` above.
 */

/** Column width. The winner's 318px, rounded to the app's rem grid: wide enough
 *  that the catalog's longest sentence sets in two lines at `text-sm`.
 *
 *  Spelled BOTH as a number and as the Tailwind class the markup uses, because
 *  Tailwind only emits a utility it can see as a literal in the source. The
 *  numbers exist so the geometry is readable and so a test can assert the two
 *  spellings have not drifted (journeyLayout.test.ts). */
export const JOURNEY_COLUMN_REM = 20;
export const JOURNEY_COLUMN_W = "w-[20rem]";

/** The canonical-step rail, per cluster — and the left offset everything that
 *  pins beside it (the shared band, the cluster title) has to clear. */
export const JOURNEY_RAIL_REM = 16;
export const JOURNEY_RAIL_W = "w-[16rem]";
export const JOURNEY_RAIL_LEFT = "left-[16rem]";

/** Starting row unit, px. Two lines of `text-sm` plus the row's own padding. */
export const JOURNEY_ROW_BASE = 44;

/** Ceiling for the adaptive unit. A pathological string scrolls its own cell
 *  rather than pushing every row on the board to a screenful. */
export const JOURNEY_ROW_MAX = 132;

/** Extra height a row takes when some column opens it with a silence marker. */
export const JOURNEY_SILENCE_PX = 22;

/** Sticky column header, and the cluster header above it. */
export const JOURNEY_COLUMN_HEAD_PX = 86;
export const JOURNEY_CLUSTER_HEAD_PX = 44;

/** The strip that names a phase at the head of its band. */
export const JOURNEY_BAND_LABEL_PX = 30;

/**
 * A FLOOR under every band's height.
 *
 * A phase can legitimately have no rail steps at all — a role that runs no
 * work-sample case has nothing on its `case` rail — and without this the band
 * would be 0px tall and would silently swallow the very thing it exists to say:
 * "Nothing happened here. This role runs no work-sample case." An empty band is
 * the headline case of this feature, not an edge case, so it gets room.
 */
export const JOURNEY_MIN_BAND_PX = 96;

/** The shared band's own header: taller, because it carries the sentence that
 *  says the role's conversation happened ONCE above every column, plus the
 *  "not linked to this role in the record" caveat when the band is a weaker
 *  claim than it looks. */
export const JOURNEY_SHARED_HEAD_PX = 58;

/**
 * A cluster's NATURAL band height for one phase, in px.
 *
 * Row counts are per cluster (a rail is per role), and so are the silence
 * markers that widen individual rows — so two clusters' `case` bands are rarely
 * the same height on their own.
 */
export function clusterBandHeight(
  cluster: ClusterPlan,
  phase: JourneyPhaseId,
  unit: number,
  silencePx: number
): number {
  const plan = cluster.phases.get(phase);
  if (!plan) return JOURNEY_MIN_BAND_PX;
  return Math.max(JOURNEY_MIN_BAND_PX, bandHeight(plan.rowCount, plan.silentRows, unit, silencePx));
}

export function clusterSharedHeight(cluster: ClusterPlan, unit: number, silencePx: number): number {
  return bandHeight(cluster.sharedRowCount, cluster.sharedSilentRows, unit, silencePx);
}

/**
 * ONE GLOBAL BAND HEIGHT — the winner's "so phases align across every column and
 * cluster". Take the tallest cluster's band and let every other cluster pad to
 * it at the foot. A reader travelling sideways across four role clusters then
 * finds "candidate screening" starting at the same y in all of them, which is
 * what makes the phase gutter on the left a true statement rather than a label
 * that happens to sit near the right rows.
 */
export function globalBandHeights(
  plan: BoardPlan,
  unit: number,
  silencePx: number
): { shared: number; phases: Map<JourneyPhaseId, number> } {
  const phases = new Map<JourneyPhaseId, number>();
  for (const phase of JOURNEY_PHASE_IDS) {
    let max = 0;
    for (const cluster of plan.clusters) max = Math.max(max, clusterBandHeight(cluster, phase, unit, silencePx));
    phases.set(phase, max);
  }
  let shared = 0;
  for (const cluster of plan.clusters) shared = Math.max(shared, clusterSharedHeight(cluster, unit, silencePx));
  return { shared, phases };
}
