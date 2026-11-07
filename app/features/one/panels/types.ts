import type { ReactNode } from "react";
import type { ActKind, PanelInstance, PanelKind } from "../types";

/** A layout's hook into a panel's look without forking its data code: the token rides
 *  on the panel root as `data-look`, `className` lands on the same element.
 *
 *  - `table`   fills its container (give it a height): sticky column head, dense aligned
 *              rows with quiet acts, the body scrolls inside the panel;
 *  - `insight` the answer's card: the SHAPE of the answer (parts, spread, facts) and at most
 *              one suggested act — never the table's rows again; grows into the height it
 *              is given (its spread stretches);
 *  - `list`    a dense single column for a narrow side (≤ 320px): a line + a meta line. */
export type PanelLook = "table" | "insight" | "list";

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
};
