// Tab definitions shared by the interactive Workspace (studio sidebar) and the
// server-rendered deep-link pages (which reuse the sidebar via WorkspaceNav).

export type WorkspaceTabId =
  | "pipeline"
  | "channels"
  | "decisions"
  | "schedule"
  | "profile"
  | "match"
  | "analyze"
  | "history"
  | "jobs"
  | "library"
  | "matrix"
  | "analytics"
  | "dev"
  | "about"
  | "tasks";

export type WorkspaceTabDef = {
  id: WorkspaceTabId;
  label: string;
};

// The Pipeline dashboard is the default landing surface.
export const DEFAULT_TAB: WorkspaceTabId = "pipeline";

// Flat list (no standalone History — it's consolidated into Analyze). Used by
// the deep-link breadcrumb.
export const WORKSPACE_TABS: WorkspaceTabDef[] = [
  { id: "pipeline", label: "Pipeline" },
  { id: "channels", label: "Channels" },
  { id: "decisions", label: "Decisions" },
  { id: "schedule", label: "Schedule" },
  { id: "profile", label: "Profile" },
  { id: "match", label: "Match" },
  { id: "analyze", label: "Analyze" },
  { id: "jobs", label: "Jobs" },
  { id: "library", label: "Job descriptions" },
  { id: "matrix", label: "Matrix" },
  { id: "analytics", label: "Analytics" },
  { id: "dev", label: "Dev cases" },
  { id: "about", label: "About" },
];

// Grouped structure for the studio left sidebar.
export type NavGroup = { label?: string; items: WorkspaceTabDef[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { id: "pipeline", label: "Pipeline" },
      { id: "channels", label: "Channels" },
      { id: "decisions", label: "Decisions" },
      { id: "schedule", label: "Schedule" },
    ],
  },
  {
    label: "Library",
    items: [
      { id: "jobs", label: "Jobs" },
      { id: "library", label: "Job descriptions" },
    ],
  },
  {
    // Phase 6: Profile + Match are standalone tools (reachable from Channels:
    // Match = proactive sourcing, Profile = manual add), de-emphasized here.
    label: "Tools",
    items: [
      { id: "profile", label: "Profile" },
      { id: "match", label: "Match" },
      { id: "analyze", label: "Analyze" },
    ],
  },
  {
    label: "Dev extension",
    items: [{ id: "dev", label: "Dev cases" }],
  },
  {
    label: "Insights",
    items: [
      { id: "analytics", label: "Analytics" },
      { id: "matrix", label: "Matrix" },
      { id: "about", label: "About" },
    ],
  },
];

const TAB_IDS = new Set<WorkspaceTabId>([
  "pipeline",
  "channels",
  "decisions",
  "schedule",
  "profile",
  "match",
  "analyze",
  "history",
  "jobs",
  "library",
  "matrix",
  "analytics",
  "dev",
  "about",
  // Background tasks is a client-only live view reached from the sidebar footer
  // (TasksIndicator), not a deep-link target — so it's a valid tab id here but
  // intentionally absent from WORKSPACE_TABS/NAV_GROUPS above.
  "tasks",
]);

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

// Build a "/?…" href by patching the current query with `updates` (null clears
// a key). Components pass the result to next/navigation's router so App Router's
// useSearchParams reliably re-renders — a raw history.pushState does NOT trigger
// that in Next 16, which is why sidebar clicks weren't switching content.
export function buildUrl(updates: Record<string, string | null>): string {
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
  }
  if (params.get("tab") === DEFAULT_TAB) params.delete("tab");
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}
