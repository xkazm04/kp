"use client";

/**
 * Shared scaffolding for the Decisions empty-state prototype (round 1).
 *
 * Both directional variants are chain-aware in exactly the way
 * `ChainEmptyState` is — an empty tab must teach where its data comes from and
 * link there — so the navigation contract lives here once rather than being
 * re-derived per variant: same `buildTabSwitchUrl` hop, same destinations, same
 * per-destination explanation. Extracted so a winning variant can keep it and
 * the losers can be deleted without taking the behavior with them.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, Users, type LucideIcon } from "lucide-react";
import { buildTabSwitchUrl, type WorkspaceTabId } from "@/app/features/shell/tabs";

/** A chain destination, in the shape `ChainEmptyState` already takes. */
export type ChainLink = { tab: WorkspaceTabId; label: string };

/** Props every Decisions empty-state variant receives — identical across tabs. */
export type DecisionsEmptyProps = {
  title: string;
  body: string;
  /** Upstream/downstream hops this empty tab teaches. Never drop these. */
  links: ChainLink[];
  /** Decision records currently in view (the queue is clear, not unbuilt). */
  recordCount: number;
  /** Auto-rejected candidates that can still be pulled back for review. */
  reconsiderCount: number;
};

/**
 * Why a recruiter would go to each destination. Both the link labels and these
 * one-liners come from the decisions catalog — the map holds the KEY (relative
 * to the `decisions.empty` namespace) so the caller resolves it with its own `t`.
 */
type DestinationHintKey = "hintSchedule" | "hintPipeline";

const DESTINATION_HINT: Partial<Record<WorkspaceTabId, DestinationHintKey>> = {
  schedule: "hintSchedule",
  pipeline: "hintPipeline",
};

const DESTINATION_ICON: Partial<Record<WorkspaceTabId, LucideIcon>> = {
  schedule: CalendarClock,
  pipeline: Users,
};

/** The `decisions.empty.*` key explaining a destination, or null if it has none. */
export const hintFor = (tab: WorkspaceTabId): DestinationHintKey | null => DESTINATION_HINT[tab] ?? null;
/**
 * Exported as the map, not as an `iconFor(tab)` helper: the React compiler rejects
 * calling a function that returns a component during render ("Cannot create
 * components during render"). A plain lookup is not a call, so consumers index it.
 */
export { DESTINATION_ICON };

/**
 * The one navigation seam. Mirrors `ChainEmptyState`: every hop goes through
 * `buildTabSwitchUrl` so the destination tab opens clean instead of inheriting
 * the Decisions tab's scoped params.
 */
export function useChainNav() {
  const router = useRouter();
  const search = useSearchParams();
  return (tab: WorkspaceTabId) => router.push(buildTabSwitchUrl(tab, search.toString()));
}
