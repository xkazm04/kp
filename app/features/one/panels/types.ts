import type { ReactNode } from "react";
import type { ActKind, PanelInstance, PanelKind } from "../types";

/** A layout's hook into a panel's look without forking its data code: the token rides
 *  on the panel root as `data-look`, `className` lands on the same element.
 *
 *  - `table`   fills its container (give it a height): sticky column head, dense aligned
 *              rows, the body scrolls inside the panel;
 *  - `summary` a compact card: the headline figure, ≤ 3 rows, a See-all (`onExpand`);
 *              never scrolls;
 *  - `list`    a dense single column for a narrow side (≤ 320px): a line + a meta line;
 *  - `default` / `compact` / `spotlight` the round-1 looks (Greet): the list drawn bare,
 *              inside whatever frame the host's `className` gives it. */
export type PanelLook = "default" | "compact" | "spotlight" | "table" | "summary" | "list";

export type PanelProps = {
  panel: PanelInstance;
  /** Bumped after a data act so every view re-reads. */
  epoch: number;
  look?: PanelLook;
  className?: string;
  /** The host's pin / close / focus controls, drawn in the panel's head. */
  chrome?: ReactNode;
  /** `summary` look: what its See-all does (the host decides where the full view goes). */
  onExpand?: () => void;
  /** A row's own act (Advance / Reject on a decision) — the USER's press, so it arrives
   *  as a hand proposal and still goes through the ConsentCard. */
  onPropose: (act: ActKind, params: Record<string, string>) => void;
  /** A row asks for another view (the needs panel opens the queue a bucket names). */
  onShow: (kind: PanelKind, params?: Record<string, string>) => void;
};
