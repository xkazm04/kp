// Tab definitions shared by the interactive Workspace (studio sidebar) and the
// server-rendered deep-link breadcrumb (WorkspaceTabBarLinks).

export type WorkspaceTabId =
  | "pipeline"
  | "profile"
  | "match"
  | "analyze"
  | "history"
  | "jobs"
  | "library"
  | "matrix"
  | "about";

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
  { id: "profile", label: "Profile" },
  { id: "match", label: "Match" },
  { id: "analyze", label: "Analyze" },
  { id: "jobs", label: "Jobs" },
  { id: "library", label: "Job descriptions" },
  { id: "matrix", label: "Matrix" },
  { id: "about", label: "About" },
];

// Grouped structure for the studio left sidebar.
export type NavGroup = { label?: string; items: WorkspaceTabDef[] };

export const NAV_GROUPS: NavGroup[] = [
  { items: [{ id: "pipeline", label: "Pipeline" }] },
  {
    label: "Candidates",
    items: [
      { id: "profile", label: "Profile" },
      { id: "match", label: "Match" },
      { id: "analyze", label: "Analyze" },
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
    label: "Insights",
    items: [
      { id: "matrix", label: "Matrix" },
      { id: "about", label: "About" },
    ],
  },
];

const TAB_IDS = new Set<WorkspaceTabId>([
  "pipeline",
  "profile",
  "match",
  "analyze",
  "history",
  "jobs",
  "library",
  "matrix",
  "about",
]);

export function isWorkspaceTabId(value: string | null | undefined): value is WorkspaceTabId {
  return typeof value === "string" && TAB_IDS.has(value as WorkspaceTabId);
}

export function tabHref(id: WorkspaceTabId): string {
  return id === DEFAULT_TAB ? "/" : `/?tab=${id}`;
}

// Client-side navigation that updates the URL query and lets the Workspace
// (which reads useSearchParams) re-render. Used for cross-tab deep links —
// e.g. drilling from the Pipeline into a candidate's Match view.
export function navigate(updates: Record<string, string | null>): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  if (url.searchParams.get("tab") === DEFAULT_TAB) url.searchParams.delete("tab");
  window.history.pushState(null, "", url.toString());
  window.dispatchEvent(new PopStateEvent("popstate"));
}
