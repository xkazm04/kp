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
 * Why a recruiter would go to each destination. The link labels come from the
 * decisions catalog; these one-liners are prototype copy (round 1), deliberately
 * plain English so no shared message catalog is touched mid-prototype.
 */
const DESTINATION_HINT: Partial<Record<WorkspaceTabId, string>> = {
  schedule: "Accepted screenings waiting on a confirmed slot.",
  pipeline: "The live board — every candidate and the stage they sit in.",
};

const DESTINATION_ICON: Partial<Record<WorkspaceTabId, LucideIcon>> = {
  schedule: CalendarClock,
  pipeline: Users,
};

export const hintFor = (tab: WorkspaceTabId): string | null => DESTINATION_HINT[tab] ?? null;
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
