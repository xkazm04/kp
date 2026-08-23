import type { CompanionTurn, CompanionTurnMeta } from "@/app/_lib/db/companion";
import type { AttentionCounts } from "@/app/features/shell/useAttention";

// The contract every dock body variant renders against. Both directional
// variants take exactly these props, so the switcher in CompanionDock is a
// one-line swap and neither variant can quietly grow its own data source.

export type CompanionVariantId = "colleague" | "desk";

export type CompanionVariantProps = {
  turns: CompanionTurn[];
  busy: boolean;
  /** Machine error code from the route, already resolved to a message upstream. */
  error: string | null;
  /** Live studio facts — the same counts behind the sidebar badges. */
  attention: AttentionCounts | null;
  onSend: (message: string) => Promise<boolean>;
};

/** Collapsed rest affordance — each variant draws its own (a pill vs an edge tab). */
export type CompanionRestProps = {
  onOpen: () => void;
  /** A turn is still in flight after the operator collapsed the dock. */
  busy: boolean;
  /** A reply landed while the dock was closed. */
  unread: boolean;
  label: string;
};

/** Turn provenance, read from the stored meta without asserting past it: an
 *  unrecognised shape yields an empty record rather than a confident lie. */
export function turnMeta(turn: CompanionTurn): CompanionTurnMeta {
  return turn.meta ?? {};
}
