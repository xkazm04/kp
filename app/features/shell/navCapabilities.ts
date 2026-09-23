// Which capability each shell door needs — the ONE table the nav, the command
// palette and the tour command read.
//
// Until this existed, nothing under app/features/shell read a capability at all:
// the rail offered Organization, Billing, Models, Integrations and Workspaces to
// every viewer, and the palette's "Go to" list offered the same doors plus a tour
// command that mutates pipeline data. Wave 18a's capability gates then refused the
// request behind each one, so a viewer's only feedback was a 403 rendered as a
// failed load — the shell invited them through a door it knew was locked.
//
// Every entry below is the capability the tab's OWN primary route already enforces
// server-side, so this table cannot invent authority; it only mirrors it:
//   organization  members:manage  app/api/org/invites, org/members/[userId]
//   billing       org:manage      app/api/billing/authority.ts
//   models        org:manage      app/api/llm/config, llm/keys
//   integrations  org:manage      app/api/ats/config, ats/connections
//   workspace     team:manage     app/api/workspaces (POST)
//   hiring        pipeline:write  app/api/decisions/config
//   branding      org:manage      app/api/brand (PUT)
// Branding was once absent because PUT /api/brand gated on `requireOperator` alone;
// since challenge-r07 it asks org:manage (the brand paints every member's workspace
// and every candidate page), so an admin offered the editor could only meet a 403.
//
// The gate is advisory UI, never enforcement: the server refuses regardless, and an
// UNKNOWN capability set (the fetch has not landed, or failed) locks NOTHING — a
// shell that hid an owner's Billing tab because one GET blipped would be a worse
// failure than the one this closes.

import type { Capability } from "@/app/_lib/auth/roles";
import { NAV_GROUPS, type NavGroup, type WorkspaceTabDef, type WorkspaceTabId } from "./tabs";

export const TAB_CAPABILITY: Readonly<Partial<Record<WorkspaceTabId, Capability>>> = {
  organization: "members:manage",
  billing: "org:manage",
  models: "org:manage",
  integrations: "org:manage",
  workspace: "team:manage",
  hiring: "pipeline:write",
  branding: "org:manage",
};

/** The guided tour STARTS A RUN that moves candidates through the board — a write,
 *  not a demo overlay. Offered only to a caller who may perform it. */
export const TOUR_CAPABILITY: Capability = "pipeline:write";

/** The capability this tab needs, or null when it needs nothing beyond `read`. */
export function capabilityForTab(id: WorkspaceTabId): Capability | null {
  return TAB_CAPABILITY[id] ?? null;
}

/** The capability that LOCKS this tab for a caller holding `caps` — null when the
 *  tab is open to them, and null whenever `caps` is unknown (see the header). */
export function lockedCapability(
  id: WorkspaceTabId,
  caps: readonly Capability[] | null | undefined
): Capability | null {
  const needed = capabilityForTab(id);
  if (!needed || !caps) return null;
  return caps.includes(needed) ? null : needed;
}

/** Is a shell command (the tour) available to this caller? Unknown caps ⇒ yes. */
export function commandAllowed(cap: Capability, caps: readonly Capability[] | null | undefined): boolean {
  return !caps || caps.includes(cap);
}

export type NavItemView = { def: WorkspaceTabDef; locked: Capability | null };
export type NavGroupView = { group: NavGroup; items: NavItemView[] };

/**
 * The nav, annotated with what this caller may open. Nothing is REMOVED: a door
 * that vanishes for the person who holds the key (an admin whose capability set
 * has not loaded, an owner on a slow network) is indistinguishable from a broken
 * build, so a locked tab renders disabled with the capability named instead.
 */
export function visibleNavFor(
  caps: readonly Capability[] | null | undefined,
  groups: readonly NavGroup[] = NAV_GROUPS
): NavGroupView[] {
  return groups.map((group) => ({
    group,
    items: group.items.map((def) => ({ def, locked: lockedCapability(def.id, caps) })),
  }));
}

/** The locked tabs for a caller, as a set — what the renderers actually branch on. */
export function lockedTabsFor(caps: readonly Capability[] | null | undefined): ReadonlySet<WorkspaceTabId> {
  const out = new Set<WorkspaceTabId>();
  if (!caps) return out;
  for (const [id, needed] of Object.entries(TAB_CAPABILITY)) {
    if (needed && !caps.includes(needed)) out.add(id as WorkspaceTabId);
  }
  return out;
}

// The catalog key for a capability's human name. Capability ids carry a ":" and
// next-intl paths are dot-separated, so the wire vocabulary is mapped onto safe
// keys here rather than interpolated raw.
const CAPABILITY_KEY: Record<Capability, string> = {
  "org:manage": "orgManage",
  "members:manage": "membersManage",
  "team:manage": "teamManage",
  "pipeline:write": "pipelineWrite",
  read: "read",
};

export function capabilityLabelKey(cap: Capability): string {
  return `capabilities.${CAPABILITY_KEY[cap]}`;
}

// ---- Every entrance, one answer --------------------------------------------
//
// The rail and the palette read the table above; a g-chord, a ?tab= arrival (the
// billing checkout return, the calendar callback, a pasted link) and programmatic
// selectTab did not, and opened a gated tab straight into its 403. The rule now:
// a tab's lock is decided at the DESTINATION. Whatever door a seat came through,
// WorkspaceTabPanel renders through panelFor, and a locked arrival lands on the
// locked-door panel (who can grant it, and a way to ask) rather than the tab.
// Same fail-open posture as everything above: unknown caps open every door, and
// the panel swaps to the lock the moment caps resolve without the capability.

export type TabArrival = { kind: "open" } | { kind: "locked"; needs: Capability };

/** What a seat holding `caps` meets on arriving at `id`, from any door. */
export function tabArrival(id: WorkspaceTabId, caps: readonly Capability[] | null | undefined): TabArrival {
  const needs = lockedCapability(id, caps);
  return needs ? { kind: "locked", needs } : { kind: "open" };
}

export type PanelChoice<P> = { kind: "open"; panel: P } | { kind: "locked"; needs: Capability };

/**
 * The tab panel for `id`, looked up in an EXHAUSTIVE registry — or the lock.
 *
 * The registry parameter is `Record<WorkspaceTabId, P>`, not a partial map: a tab
 * id added to tabs.ts with no panel fails tsc at the one call site
 * (WorkspaceTabChunks.tsx) instead of rendering a silently blank main panel — the
 * failure a hand-synced ternary chain allowed (idea-47b71431).
 */
export function panelFor<P>(
  registry: Readonly<Record<WorkspaceTabId, P>>,
  id: WorkspaceTabId,
  caps: readonly Capability[] | null | undefined
): PanelChoice<P> {
  const arrival = tabArrival(id, caps);
  return arrival.kind === "locked" ? arrival : { kind: "open", panel: registry[id] };
}

/** How a rail row renders. A locked row is a LOCK DOOR — focusable, activatable,
 *  opening the explanation — never a disabled row: a disabled entry teaches the
 *  reader the product is broken, and says nothing about the way in. */
export function navItemMode(locked: Capability | null | undefined, isLink: boolean): "lockedDoor" | "link" | "button" {
  if (locked) return "lockedDoor";
  return isLink ? "link" : "button";
}
