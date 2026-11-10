import type { ReactNode } from "react";
import type { ActKind, PanelInstance, PanelKind, Selected } from "../types";

/** A layout's hook into a panel's look without forking its data code: the token rides
 *  on the panel root as `data-look`, `className` lands on the same element.
 *
 *  - `table`   fills its container (give it a height): sticky column head, dense aligned
 *              rows with quiet acts, the body scrolls inside the panel;
 *  - `insight` the answer's card: the SHAPE of the answer (parts, spread, facts) and at most
 *              one suggested act — never the table's rows again; grows into the height it
 *              is given (its spread stretches);
 *  - `list`    a dense single column for a narrow side (≤ 320px): a line + a meta line;
 *  - `pane`    round 4: a TOOL that fills its container (the profile's CV | score, the
 *              letter reader, the calendar's week) — two columns from 26rem (profile,
 *              interview) or 36rem (letter, calendar) of its own width, stacked below. A kind without a pane body draws its table. */
export type PanelLook = "table" | "insight" | "list" | "pane";

/** Role grouping of a pipeline list (table / list looks): `role` (default) groups rows by
 *  their role under a sticky head; `none` keeps the flat order. */
export type PanelGroup = "role" | "none";

export type PanelProps = {
  panel: PanelInstance;
  /** Bumped after a data act so every view re-reads. */
  epoch: number;
  look?: PanelLook;
  className?: string;
  /** The host's pin / close / focus controls, drawn in the panel's head. */
  chrome?: ReactNode;
  /** `insight` look: what "See all" does (the host decides where the full view goes). */
  onExpand?: () => void;
  /** A row's own act (Advance / Reject on a decision) — the USER's press, so it arrives
   *  as a hand proposal and still goes through the ConsentCard. */
  onPropose: (act: ActKind, params: Record<string, string>) => void;
  /** A row asks for another view (the needs panel opens the queue a bucket names). */
  onShow: (kind: PanelKind, params?: Record<string, string>) => void;
  /** Round 4: role grouping of the table / list rows (default `role`). */
  group?: PanelGroup;
  /** The candidate picked in the session (its row is marked) and how a row picks one
   *  (Enter / a press; Esc on a row clears). Absent = rows are not selectable. */
  selectedEntryId?: string | null;
  onSelectEntry?: (entry: Selected | null) => void;
};
