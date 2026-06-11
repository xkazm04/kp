"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/app/_components/Skeleton";
import { ErrorBoundary } from "@/app/_components/ErrorBoundary";
import { LanguageSwitcher } from "@/app/_components/LanguageSwitcher";
import { ThemeToggle } from "@/app/_components/ThemeToggle";
import { CommandPalette } from "./CommandPalette";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { RecentsNav } from "./RecentsNav";
import { useAttention } from "./useAttention";
import { TasksIndicator } from "./tasks/TasksIndicator";
import { TasksProvider } from "./tasks/TasksProvider";
import { SimulationProvider } from "./simulation/SimulationProvider";
import { SimBar } from "./simulation/SimBar";
import { SimSpotlight } from "./simulation/SimSpotlight";
import { SimExplainDrawer } from "./simulation/SimExplainDrawer";
import { SimOfferFrame } from "./simulation/SimOfferFrame";
import { SimGroupEval } from "./simulation/SimGroupEval";
import { SimDecisionWave } from "./simulation/SimDecisionWave";
import { buildTabSwitchUrl, DEFAULT_TAB, isWorkspaceTabId, navItemClass, NAV_GROUPS, type WorkspaceTabId } from "./tabs";

export type { WorkspaceTabId } from "./tabs";

// Lightweight placeholder while a tab's code-split chunk loads.
function TabSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-48 w-full rounded-lg" />
    </div>
  );
}

// Lazy-load each tab so the initial bundle only carries the shell + the active
// tab's chunk; the rest are fetched on demand when navigated to. A shared
// skeleton fills the swap. (Named exports → map to a default for next/dynamic.)
const loading = () => <TabSkeleton />;
const AboutTab = dynamic(() => import("./sub_about/AboutTab").then((m) => ({ default: m.AboutTab })), { loading });
const AnalyzeWorkspace = dynamic(() => import("./sub_analyze/AnalyzeWorkspace").then((m) => ({ default: m.AnalyzeWorkspace })), { loading });
const DecisionsTab = dynamic(() => import("./sub_decisions/DecisionsTab").then((m) => ({ default: m.DecisionsTab })), { loading });
const ScheduleTab = dynamic(() => import("./sub_schedule/ScheduleTab").then((m) => ({ default: m.ScheduleTab })), { loading });
const JobsTab = dynamic(() => import("./sub_jobs/JobsTab").then((m) => ({ default: m.JobsTab })), { loading });
const LibraryTab = dynamic(() => import("./sub_library/LibraryTab").then((m) => ({ default: m.LibraryTab })), { loading });
const MatchTab = dynamic(() => import("./sub_match/MatchTab").then((m) => ({ default: m.MatchTab })), { loading });
const MatrixTab = dynamic(() => import("./sub_matrix/MatrixTab").then((m) => ({ default: m.MatrixTab })), { loading });
const AnalyticsTab = dynamic(() => import("./sub_analytics/AnalyticsTab").then((m) => ({ default: m.AnalyticsTab })), { loading });
const PipelineTab = dynamic(() => import("./sub_pipeline/PipelineTab").then((m) => ({ default: m.PipelineTab })), { loading });
const ChannelsTab = dynamic(() => import("./sub_channels/ChannelsTab").then((m) => ({ default: m.ChannelsTab })), { loading });
const DevTab = dynamic(() => import("./sub_dev/DevTab").then((m) => ({ default: m.DevTab })), { loading });
const ProfileTab = dynamic(() => import("./sub_profile/ProfileTab").then((m) => ({ default: m.ProfileTab })), { loading });
const InterviewSimTab = dynamic(() => import("./sub_interview/InterviewSimTab").then((m) => ({ default: m.InterviewSimTab })), { loading });
const TasksTab = dynamic(() => import("./tasks/TasksTab").then((m) => ({ default: m.TasksTab })), { loading });

export function Workspace() {
  const router = useRouter();
  const params = useSearchParams();
  const t = useTranslations("nav");
  // Translate a nav key (tabs.<id> / groups.<key>) through the catalog, falling
  // back to the English label baked into tabs.ts for any not-yet-translated entry.
  const navText = (key: string, fallback: string): string => {
    const k = key as Parameters<typeof t>[0];
    return t.has(k) ? t(k) : fallback;
  };
  const search = params.toString();
  const tabParam = params.get("tab");
  // SHELL2 — live "what needs my attention" counts behind the nav badges.
  const attention = useAttention();
  const active: WorkspaceTabId = isWorkspaceTabId(tabParam) ? tabParam : DEFAULT_TAB;
  // History is consolidated into Analyze; ?tab=history opens Analyze in history mode.
  const navActive: WorkspaceTabId = active === "history" ? "analyze" : active;

  // Switching tabs from the sidebar clears every tab-scoped deep-link param
  // (the allowlist lives in tabs.ts, not in this call site) so the destination
  // never inherits the prior tab's selection.
  const selectTab = useCallback(
    (id: WorkspaceTabId): void => {
      router.replace(buildTabSwitchUrl(id, search), { scroll: false });
    },
    [router, search]
  );

  return (
    <TasksProvider>
    <SimulationProvider>
    <div className="min-h-screen bg-paper md:flex">
      <a
        href="#main"
        className="focus-ring sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-coral focus:px-3 focus:py-2 focus:text-base focus:font-semibold focus:text-white"
      >
        {t("skipToContent")}
      </a>
      <aside className="flex flex-col border-b border-stone-300 bg-paper md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r">
        <div className="px-4 py-5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-ink font-serif text-base font-semibold text-white dark:-rotate-3 dark:rounded-xl dark:shadow-sticker-sm">
              {t("brandMark")}
            </span>
            <div className="leading-tight">
              <p className="font-serif text-h3 text-ink">{t("brandName")}</p>
              <p className="text-sm uppercase tracking-[0.12em] text-steel">{t("tagline")}</p>
            </div>
          </div>
        </div>

        {/* SHELL1: the global search affordance — the palette itself also opens
            anywhere via Ctrl/Cmd+K. */}
        <div className="px-3 pb-4">
          <CommandPalette />
        </div>

        {/* SHELL3: pick-up-where-I-left-off deep links. */}
        <RecentsNav />

        {/* SHELL4: g-chord tab navigation + the "?" reference overlay. */}
        <KeyboardShortcuts onSelectTab={selectTab} />

        <nav aria-label={t("ariaLabel")} className="space-y-5 px-3 pb-6">
          {NAV_GROUPS.map((group, gi) => (
            <div key={group.key ?? `g${gi}`}>
              {group.key ? (
                <p className="px-2 pb-1 text-sm font-semibold uppercase tracking-[0.12em] text-steel/70">
                  {navText(`groups.${group.key}`, group.label ?? "")}
                </p>
              ) : null}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = item.id === navActive;
                  // SHELL2: live queue-depth pill for items that declared a
                  // badgeKey (Decisions / Pipeline / Schedule / Jobs).
                  const badge = item.badgeKey && attention ? attention[item.badgeKey] : 0;
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
                      <span className="min-w-0 flex-1 truncate text-left">{navText(`tabs.${item.id}`, item.label)}</span>
                      {badge > 0 ? (
                        <span
                          aria-label={t("attentionBadge", { count: badge })}
                          className="shrink-0 rounded-full bg-coral/10 px-1.5 py-0.5 text-sm font-semibold leading-none text-coral"
                        >
                          {badge}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="mt-auto flex items-center justify-between gap-2 px-3 py-3">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
        <TasksIndicator active={active === "tasks"} onOpen={() => selectTab("tasks")} />
      </aside>

      <main id="main" tabIndex={-1} className="min-w-0 flex-1 bg-white focus:outline-none">
        {/* pb-24 keeps content clear of the fixed simulation bar. The boundary
            contains a single tab's render crash to this panel (sidebar + sim bar
            survive) and clears itself when resetKey/navActive changes on a tab
            switch. The inner key replays the fade-in entrance on each switch. */}
        <div className="mx-auto max-w-[108rem] px-3 py-6 pb-24 sm:px-4 lg:px-6">
          <ErrorBoundary resetKey={navActive} label="This tab">
            <div key={navActive} className="animate-tab-in">
              {navActive === "pipeline" ? <PipelineTab /> : null}
              {navActive === "channels" ? <ChannelsTab /> : null}
              {navActive === "decisions" ? <DecisionsTab /> : null}
              {navActive === "schedule" ? <ScheduleTab /> : null}
              {navActive === "profile" ? <ProfileTab /> : null}
              {navActive === "match" ? <MatchTab /> : null}
              {navActive === "interview" ? <InterviewSimTab /> : null}
              {navActive === "analyze" ? (
                <AnalyzeWorkspace initialMode={active === "history" ? "history" : "new"} />
              ) : null}
              {navActive === "jobs" ? <JobsTab /> : null}
              {navActive === "library" ? <LibraryTab /> : null}
              {navActive === "matrix" ? <MatrixTab /> : null}
              {navActive === "analytics" ? <AnalyticsTab /> : null}
              {navActive === "dev" ? <DevTab /> : null}
              {navActive === "about" ? <AboutTab /> : null}
              {navActive === "tasks" ? <TasksTab /> : null}
            </div>
          </ErrorBoundary>
        </div>
      </main>
      <SimSpotlight />
      <SimExplainDrawer />
      <SimOfferFrame />
      <SimGroupEval />
      <SimDecisionWave />
      <SimBar />
    </div>
    </SimulationProvider>
    </TasksProvider>
  );
}
