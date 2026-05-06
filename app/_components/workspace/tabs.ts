// Shared tab definitions so client (Workspace) and server (deep-link pages)
// render the same strip without duplication.

export type WorkspaceTabId = "analyze" | "history" | "library" | "matrix" | "about";

export type WorkspaceTabDef = {
  id: WorkspaceTabId;
  label: string;
};

export const WORKSPACE_TABS: WorkspaceTabDef[] = [
  { id: "analyze", label: "Analyze" },
  { id: "history", label: "History" },
  { id: "library", label: "Library" },
  { id: "matrix", label: "Matrix" },
  { id: "about", label: "About" },
];

const TAB_IDS = new Set<WorkspaceTabId>(WORKSPACE_TABS.map((t) => t.id));

export function isWorkspaceTabId(value: string | null | undefined): value is WorkspaceTabId {
  return typeof value === "string" && TAB_IDS.has(value as WorkspaceTabId);
}

export function tabHref(id: WorkspaceTabId): string {
  return id === "analyze" ? "/" : `/?tab=${id}`;
}
