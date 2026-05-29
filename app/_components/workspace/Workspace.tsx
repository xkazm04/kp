"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { AboutTab } from "./AboutTab/AboutTab";
import { AnalyzeWorkspace } from "./AnalyzeWorkspace/AnalyzeWorkspace";
import { DecisionsTab } from "./DecisionsTab/DecisionsTab";
import { JobsTab } from "./JobsTab/JobsTab";
import { LibraryTab } from "./LibraryTab/LibraryTab";
import { MatchTab } from "./MatchTab/MatchTab";
import { MatrixTab } from "./MatrixTab/MatrixTab";
import { PipelineTab } from "./PipelineTab/PipelineTab";
import { ProfileTab } from "./ProfileTab/ProfileTab";
import { TasksIndicator } from "./tasks/TasksIndicator";
import { TasksProvider } from "./tasks/TasksProvider";
import { buildUrl, DEFAULT_TAB, isWorkspaceTabId, NAV_GROUPS, type WorkspaceTabId } from "./tabs";

export type { WorkspaceTabId } from "./tabs";

export function Workspace() {
  const router = useRouter();
  const params = useSearchParams();
  const tabParam = params.get("tab");
  const active: WorkspaceTabId = isWorkspaceTabId(tabParam) ? tabParam : DEFAULT_TAB;
  // History is consolidated into Analyze; ?tab=history opens Analyze in history mode.
  const navActive: WorkspaceTabId = active === "history" ? "analyze" : active;

  // Switching tabs from the sidebar clears any cross-tab deep-link params.
  const selectTab = useCallback(
    (id: WorkspaceTabId): void => {
      router.replace(buildUrl({ tab: id, profile: null, job: null }), { scroll: false });
    },
    [router]
  );

  return (
    <TasksProvider>
    <div className="min-h-screen bg-paper md:flex">
      <aside className="flex flex-col border-b border-stone-300 bg-paper md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r">
        <div className="px-4 py-5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-ink font-serif text-sm font-semibold text-white">
              KP
            </span>
            <div className="leading-tight">
              <p className="font-serif text-h3 text-ink">studio</p>
              <p className="text-[10px] uppercase tracking-[0.12em] text-steel">talent matching</p>
            </div>
          </div>
        </div>

        <nav aria-label="Workspace" className="space-y-5 px-3 pb-6">
          {NAV_GROUPS.map((group, gi) => (
            <div key={group.label ?? `g${gi}`}>
              {group.label ? (
                <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-steel/70">
                  {group.label}
                </p>
              ) : null}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = item.id === navActive;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={isActive ? "page" : undefined}
                      onClick={() => selectTab(item.id)}
                      className={`focus-ring flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? "bg-coral/10 text-coral"
                          : "text-ink/80 hover:bg-white hover:text-ink"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-coral" : "bg-stone-300"}`}
                        aria-hidden
                      />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="mt-auto" />
        <TasksIndicator />
      </aside>

      <main className="min-w-0 flex-1 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
          {navActive === "pipeline" ? <PipelineTab /> : null}
          {navActive === "decisions" ? <DecisionsTab /> : null}
          {navActive === "profile" ? <ProfileTab /> : null}
          {navActive === "match" ? <MatchTab /> : null}
          {navActive === "analyze" ? (
            <AnalyzeWorkspace initialMode={active === "history" ? "history" : "new"} />
          ) : null}
          {navActive === "jobs" ? <JobsTab /> : null}
          {navActive === "library" ? <LibraryTab /> : null}
          {navActive === "matrix" ? <MatrixTab /> : null}
          {navActive === "about" ? <AboutTab /> : null}
        </div>
      </main>
    </div>
    </TasksProvider>
  );
}
