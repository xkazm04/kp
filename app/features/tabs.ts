// Tab definitions shared by the interactive Workspace (studio sidebar) and the
// server-rendered deep-link pages (which reuse the sidebar via WorkspaceNav).

// Single source of truth for the tab universe. The WorkspaceTabId union AND the
// runtime allowlist behind isWorkspaceTabId are both derived from this one
// literal array, so the type and the guard can never drift — adding a tab is a
// one-line edit the compiler keeps consistent (an id missing from the guard, or
// an extra one, used to be a silent bug: a deep link to a valid tab 404'd to the
// default with no error).
export const WORKSPACE_TAB_IDS = [
  "pipeline",
  "channels",
  "decisions",
  "schedule",
  "interview",
  "profile",
  "match",
  "analyze",
  // Analyze history is a sub-view reached from the Analyze tab (Workspace maps
  // it onto the Analyze nav item); a valid id but intentionally absent from
  // NAV_GROUPS below.
  "history",
  "jobs",
  "library",
  "matrix",
  "analytics",
  "dev",
  "about",
  // Background tasks is a client-only live view reached from the sidebar footer
  // (TasksIndicator), not a deep-link target — so it's a valid tab id here but
  // intentionally absent from NAV_GROUPS below.
  "tasks",
  "billing",
  "models",
] as const;

export type WorkspaceTabId = (typeof WORKSPACE_TAB_IDS)[number];

// SHELL2 — the attention-count buckets /api/attention serves. A nav item opts
// into a badge by declaring which bucket it renders (`badgeKey` below); the
// mapping is declarative here, never positional in the renderers.
export type AttentionKey = "decisions" | "pipeline" | "schedule" | "jobs" | "channels";

export type WorkspaceTabDef = {
  id: WorkspaceTabId;
  label: string;
  badgeKey?: AttentionKey;
  // When set, the badge itself becomes a second click target that opens the tab
  // WITH these deep-link params — landing on the exact slice the count refers to
  // (e.g. Pipeline's stale entries via ?quick=aging) instead of the bare tab.
  // Only declare this when the counted cohort is NOT what the bare tab already
  // shows on landing; Decisions/Schedule open on their queues anyway.
  badgeParams?: Partial<Record<TabScopedParamKey, string>>;
};

// The Pipeline dashboard is the default landing surface.
export const DEFAULT_TAB: WorkspaceTabId = "pipeline";

// Grouped structure for the studio left sidebar. A flat tab list, if ever needed
// (e.g. a deep-link breadcrumb), should be derived from NAV_GROUPS.flatMap(g => g.items)
// rather than maintained as a fourth parallel declaration.
// `label` is the English source/fallback; `key` is the i18n key (under the `nav`
// catalog: tabs.<id> for items, groups.<key> for group headers) the renderers
// translate through, falling back to `label` for any not-yet-translated entry.
export type NavGroup = { label?: string; key?: string; items: WorkspaceTabDef[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { id: "pipeline", label: "Pipeline", badgeKey: "pipeline", badgeParams: { quick: "aging" } },
      { id: "channels", label: "Channels", badgeKey: "channels" },
      { id: "decisions", label: "Decisions", badgeKey: "decisions" },
      { id: "schedule", label: "Schedule", badgeKey: "schedule" },
    ],
  },
  {
    label: "Library",
    key: "library",
    items: [
      { id: "jobs", label: "Jobs", badgeKey: "jobs" },
      { id: "library", label: "Job descriptions" },
    ],
  },
  {
    // Phase 6: Profile + Match are standalone tools (reachable from Channels:
    // Match = proactive sourcing, Profile = manual add), de-emphasized here.
    label: "Tools",
    key: "tools",
    items: [
      { id: "profile", label: "Profile" },
      { id: "match", label: "Match" },
      { id: "analyze", label: "Analyze" },
      { id: "interview", label: "Interview sim" },
    ],
  },
  {
    label: "Dev extension",
    key: "devExtension",
    items: [{ id: "dev", label: "Dev cases" }],
  },
  {
    label: "Insights",
    key: "insights",
    items: [
      { id: "analytics", label: "Analytics" },
      { id: "matrix", label: "Matrix" },
      { id: "about", label: "About" },
    ],
  },
  {
    // Workspace administration: subscription/usage (Billing) and the LLM
    // provider routing + key store (Models).
    label: "Settings",
    key: "settings",
    items: [
      { id: "billing", label: "Billing" },
      { id: "models", label: "Models" },
    ],
  },
];

// Built from the canonical array above — never re-listed — so it stays in lockstep
// with the WorkspaceTabId union.
const TAB_IDS: ReadonlySet<WorkspaceTabId> = new Set(WORKSPACE_TAB_IDS);

export function isWorkspaceTabId(value: string | null | undefined): value is WorkspaceTabId {
  return typeof value === "string" && TAB_IDS.has(value as WorkspaceTabId);
}

export function tabHref(id: WorkspaceTabId): string {
  return id === DEFAULT_TAB ? "/" : `/?tab=${id}`;
}

// Canonical active/inactive nav treatment, shared by the studio sidebar and the
// deep-link tab bar so the active state reads the same on both surfaces (was
// coral-wash on one, ink-pill on the other).
export function navItemClass(isActive: boolean): string {
  return isActive ? "bg-coral/10 text-coral" : "text-steel hover:bg-stone-50 hover:text-ink";
}

// Build a "/?…" href by patching `search` (the current query string, e.g. from
// useSearchParams().toString()) with `updates` (null/"" clears a key).
//
// `search` MUST be the React-tracked searchParams string — callers pass it in
// rather than letting this read window.location. router.replace/push
// (next/navigation) do NOT update window.location in the same tick, so when two
// navigations fire close together — a programmatic SimulationProvider.nav() during
// a sim run, or a user clicking a deep link then a tab — a window.location read on
// the second call would see the pre-first-navigation URL and clobber the first
// update (lost profile/job/tab params). Composing off the committed router state
// (useSearchParams) instead makes successive patches stack correctly.
//
// Components still pass the result to next/navigation's router so App Router's
// useSearchParams reliably re-renders — a raw history.pushState does NOT trigger
// that in Next 16, which is why sidebar clicks weren't switching content.
export function buildUrl(updates: Record<string, string | null>, search: string): string {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
  }
  if (params.get("tab") === DEFAULT_TAB) params.delete("tab");
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

// The deep-link query params that scope a tab's view to a specific selection or
// prefill — a candidate (`profile`), a job (`job`), the profile editor's target
// (`edit`), the JD-builder draft (`jd*`). Unlike a future global/filter param,
// these must NOT survive a bare tab switch: otherwise the destination tab
// inherits the previous tab's selection (Profile's ?edit= or the JD-builder
// prefill silently leaking onto Jobs). This is the single canonical declaration
// of which params are tab-scoped — `buildTabSwitchUrl` clears every key here, the
// simulation reuses it to wipe the JD prefill, and the unit test pins the exact
// set so adding a deep-link param is a deliberate, reviewed edit rather than a
// silent leak. Anything NOT listed here survives a tab switch by design.
export const TAB_SCOPED_PARAM_KEYS = [
  "profile",
  "job",
  "edit",
  "jdTitle",
  "jdCompany",
  "jdSeniority",
  "jdFamily",
  "jdNeed",
  // Board filter deep-link params (ANA1): analytics charts link into the
  // pipeline board pre-filtered (?q= text, ?quick= chip, ?stage= funnel stage).
  // Tab-scoped like any selection — switching away must not let a stale filter
  // silently re-apply when the user later returns via the sidebar.
  "q",
  "quick",
  "stage",
] as const;

export type TabScopedParamKey = (typeof TAB_SCOPED_PARAM_KEYS)[number];

// A `{ key: null }` patch that clears every tab-scoped param. Spread into
// buildUrl (or the simulation's nav) to wipe a tab's selection/prefill from one
// place instead of hand-listing keys — re-listing them at a call site is exactly
// the literal that rots as new deep-link params are added.
export function clearedTabScopedParams(): Record<TabScopedParamKey, null> {
  return Object.fromEntries(TAB_SCOPED_PARAM_KEYS.map((key) => [key, null])) as Record<TabScopedParamKey, null>;
}

// Href for a bare tab switch (sidebar nav, TasksIndicator): select `tab` and
// clear every tab-scoped param so the destination opens on a clean view. `search`
// is the React-tracked searchParams string (see buildUrl) — threaded through so the
// switch composes off the committed router state, not a stale window.location read.
export function buildTabSwitchUrl(id: WorkspaceTabId, search: string): string {
  return buildUrl({ tab: id, ...clearedTabScopedParams() }, search);
}
