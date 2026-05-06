"use client";

import { useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { AboutTab } from "./AboutTab/AboutTab";
import { AnalyzeTab } from "./AnalyzeTab/AnalyzeTab";
import { HistoryTab } from "./HistoryTab/HistoryTab";
import { LibraryTab } from "./LibraryTab/LibraryTab";
import { MatrixTab } from "./MatrixTab/MatrixTab";
import { isWorkspaceTabId, WORKSPACE_TABS, type WorkspaceTabId } from "./tabs";

export type { WorkspaceTabId } from "./tabs";

export function Workspace() {
  const params = useSearchParams();
  const tabParam = params.get("tab");
  const active: WorkspaceTabId = isWorkspaceTabId(tabParam) ? tabParam : "analyze";

  const selectTab = useCallback((id: WorkspaceTabId): void => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (id === "analyze") url.searchParams.delete("tab");
    else url.searchParams.set("tab", id);
    // pushState so the back button navigates between tabs; firing popstate
    // ourselves makes useSearchParams pick up the change.
    window.history.pushState(null, "", url.toString());
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);

  return (
    <div className="space-y-5">
      <nav
        aria-label="Workspace tabs"
        className="rounded-lg border border-stone-200 bg-white p-1 shadow-panel"
      >
        <div className="grid grid-cols-3 gap-1 sm:grid-cols-5">
          {WORKSPACE_TABS.map((tab) => {
            const isActive = tab.id === active;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => selectTab(tab.id)}
                className={`focus-ring h-10 rounded-md px-3 text-sm font-semibold transition-colors ${
                  isActive
                    ? "bg-ink text-white"
                    : "text-steel hover:bg-paper hover:text-ink"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>

      <div role="tabpanel">
        {active === "analyze" ? <AnalyzeTab /> : null}
        {active === "history" ? <HistoryTab /> : null}
        {active === "library" ? <LibraryTab /> : null}
        {active === "matrix" ? <MatrixTab /> : null}
        {active === "about" ? <AboutTab /> : null}
      </div>
    </div>
  );
}
