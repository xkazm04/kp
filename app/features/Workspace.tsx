"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { AboutTab } from "./sub_about/AboutTab";
import { AnalyzeWorkspace } from "./sub_analyze/AnalyzeWorkspace";
import { DecisionsTab } from "./sub_decisions/DecisionsTab";
import { ScheduleTab } from "./sub_schedule/ScheduleTab";
import { JobsTab } from "./sub_jobs/JobsTab";
import { LibraryTab } from "./sub_library/LibraryTab";
import { MatchTab } from "./sub_match/MatchTab";
import { MatrixTab } from "./sub_matrix/MatrixTab";
import { PipelineTab } from "./sub_pipeline/PipelineTab";
import { DevTab } from "./sub_dev/DevTab";
import { ProfileTab } from "./sub_profile/ProfileTab";
import { TasksIndicator } from "./tasks/TasksIndicator";
import { TasksProvider } from "./tasks/TasksProvider";
import { buildUrl, DEFAULT_TAB, isWorkspaceTabId, navItemClass, NAV_GROUPS, type WorkspaceTabId } from "./tabs";

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
      <a
        href="#main"
        className="focus-ring sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-coral focus:px-3 focus:py-2 focus:text-base focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>
      <aside className="flex flex-col border-b border-stone-300 bg-paper md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r">
        <div className="px-4 py-5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-ink font-serif text-base font-semibold text-white">
              KP
            </span>
            <div className="leading-tight">
              <p className="font-serif text-h3 text-ink">studio</p>
              <p className="text-sm uppercase tracking-[0.12em] text-steel">talent matching</p>
            </div>
          </div>
        </div>

        <nav aria-label="Workspace" className="space-y-5 px-3 pb-6">
          {NAV_GROUPS.map((group, gi) => (
            <div key={group.label ?? `g${gi}`}>
              {group.label ? (
                <p className="px-2 pb-1 text-sm font-semibold uppercase tracking-[0.12em] text-steel/70">
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
                      className={`focus-ring flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-base font-medium transition-colors ${navItemClass(isActive)}`}
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

      <main id="main" tabIndex={-1} className="min-w-0 flex-1 bg-white focus:outline-none">
        {/* key on the active tab so each switch replays the fade-in entrance */}
        <div key={navActive} className="animate-fade-in mx-auto max-w-[108rem] px-3 py-6 sm:px-4 lg:px-6">
          {navActive === "pipeline" ? <PipelineTab /> : null}
          {navActive === "decisions" ? <DecisionsTab /> : null}
          {navActive === "schedule" ? <ScheduleTab /> : null}
          {navActive === "profile" ? <ProfileTab /> : null}
          {navActive === "match" ? <MatchTab /> : null}
          {navActive === "analyze" ? (
            <AnalyzeWorkspace initialMode={active === "history" ? "history" : "new"} />
          ) : null}
          {navActive === "jobs" ? <JobsTab /> : null}
          {navActive === "library" ? <LibraryTab /> : null}
          {navActive === "matrix" ? <MatrixTab /> : null}
          {navActive === "dev" ? <DevTab /> : null}
          {navActive === "about" ? <AboutTab /> : null}
        </div>
      </main>
    </div>
    </TasksProvider>
  );
}
