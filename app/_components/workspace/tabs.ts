// Tab definitions shared by the interactive Workspace (studio sidebar) and the
// server-rendered deep-link breadcrumb (WorkspaceTabBarLinks).

export type WorkspaceTabId =
  | "pipeline"
  | "decisions"
  | "profile"
  | "match"
  | "analyze"
  | "history"
  | "jobs"
  | "library"
  | "matrix"
  | "dev"
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
  { id: "decisions", label: "Decisions" },
  { id: "profile", label: "Profile" },
  { id: "match", label: "Match" },
  { id: "analyze", label: "Analyze" },
  { id: "jobs", label: "Jobs" },
  { id: "library", label: "Job descriptions" },
  { id: "matrix", label: "Matrix" },
  { id: "dev", label: "Dev cases" },
  { id: "about", label: "About" },
];

// Grouped structure for the studio left sidebar.
export type NavGroup = { label?: string; items: WorkspaceTabDef[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { id: "pipeline", label: "Pipeline" },
      { id: "decisions", label: "Decisions" },
    ],
  },
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
    label: "Dev extension",
    items: [{ id: "dev", label: "Dev cases" }],
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
  "decisions",
  "profile",
  "match",
  "analyze",
  "history",
  "jobs",
  "library",
  "matrix",
  "dev",
  "about",
]);

export function isWorkspaceTabId(value: string | null | undefined): value is WorkspaceTabId {
  return typeof value === "string" && TAB_IDS.has(value as WorkspaceTabId);
}

export function tabHref(id: WorkspaceTabId): string {
  return id === DEFAULT_TAB ? "/" : `/?tab=${id}`;
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
