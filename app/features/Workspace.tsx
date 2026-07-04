"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/app/_components/Skeleton";
import { ErrorBoundary } from "@/app/_components/ErrorBoundary";
import { LanguageSwitcher } from "@/app/_components/LanguageSwitcher";
import { ThemeToggle } from "@/app/_components/ThemeToggle";
import { SignOutButton } from "@/app/_components/auth/SignOutButton";
import KandidateMark from "@/app/landing/_components/KandidateMark";
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
import {
  ABOUT_TAB_IN_NAV,
  buildTabSwitchUrl,
  buildUrl,
  clearedTabScopedParams,
  DEFAULT_TAB,
  isWorkspaceTabId,
  navItemClass,
  navLabel,
  NAV_GROUPS,
  type WorkspaceTabId,
} from "./tabs";

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
const OnboardingTab = dynamic(() => import("./sub_onboarding/OnboardingTab").then((m) => ({ default: m.OnboardingTab })), { loading });
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
const BillingTab = dynamic(() => import("./sub_billing/BillingTab").then((m) => ({ default: m.BillingTab })), { loading });
const ModelsTab = dynamic(() => import("./sub_models/ModelsTab").then((m) => ({ default: m.ModelsTab })), { loading });
const WorkspaceTab = dynamic(() => import("./sub_workspace/WorkspaceTab").then((m) => ({ default: m.WorkspaceTab })), { loading });
const OrganizationTab = dynamic(() => import("./sub_organization/OrganizationTab").then((m) => ({ default: m.OrganizationTab })), { loading });

export function Workspace() {
  const router = useRouter();
  const params = useSearchParams();
  const t = useTranslations("nav");
  // Translate a nav key (tabs.<id> / groups.<key>) through the catalog, falling
  // back to the English label baked into tabs.ts for any not-yet-translated entry.
  const navText = (key: string, fallback: string): string => navLabel(t, key, fallback);
  const search = params.toString();
  const tabParam = params.get("tab");
  // SHELL2 — live "what needs my attention" counts behind the nav badges.
  const attention = useAttention();
  // Below `md` the sidebar is an off-canvas drawer (a permanent rail at md+). Without
  // this, the full ~16-item nav stacked above content and pushed every page below the
  // fold on a phone — the studio was close to unusable on a handset.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const requested: WorkspaceTabId = isWorkspaceTabId(tabParam) ? tabParam : DEFAULT_TAB;
  // About is a dev-only deep-dive (ABOUT_TAB_IN_NAV); in production a direct
  // ?tab=about falls back to the default so the view can't be reached.
  const active: WorkspaceTabId = requested === "about" && !ABOUT_TAB_IN_NAV ? DEFAULT_TAB : requested;
  // History is consolidated into Analyze; ?tab=history opens Analyze in history mode.
  const navActive: WorkspaceTabId = active === "history" ? "analyze" : active;

  // Switching tabs from the sidebar clears every tab-scoped deep-link param
  // (the allowlist lives in tabs.ts, not in this call site) so the destination
  // never inherits the prior tab's selection.
  const selectTab = useCallback(
    (id: WorkspaceTabId): void => {
      setMobileNavOpen(false); // a tab pick on mobile closes the drawer
      router.replace(buildTabSwitchUrl(id, search), { scroll: false });
    },
    // setMobileNavOpen is identity-stable, but React Compiler's memoization
    // check requires the declared deps to match what the body references.
    [router, search, setMobileNavOpen]
  );

  // Close the mobile drawer on Escape (desktop rail is unaffected — it's never "open").
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

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

      {/* Mobile top bar (brand + hamburger) — hidden at md+ where the rail is permanent. */}
      <div className="flex items-center justify-between border-b border-stone-300 bg-paper px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <KandidateMark className="h-7 w-7 shrink-0 text-ink [--k-accent:var(--color-coral)] [--k-fg:var(--color-paper)]" />
          <p className="font-serif text-h3 text-ink">{t("brandName")}</p>
        </div>
        <button
          type="button"
          onClick={() => setMobileNavOpen((v) => !v)}
          aria-expanded={mobileNavOpen}
          aria-controls="workspace-nav"
          aria-label={mobileNavOpen ? t("closeMenu") : t("openMenu")}
          className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-md border border-stone-300 text-ink"
        >
          {mobileNavOpen ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
        </button>
      </div>

      {/* Scrim behind the open drawer (mobile only) — click to dismiss. */}
      {mobileNavOpen ? (
        <div
          className="fixed inset-0 z-40 bg-ink/40 md:hidden"
          aria-hidden
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <aside
        id="workspace-nav"
        className={`flex flex-col bg-paper fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] overflow-y-auto border-r border-stone-300 shadow-xl transition-transform duration-200 ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        } md:z-auto md:w-64 md:max-w-none md:shrink-0 md:translate-x-0 md:overflow-y-auto md:border-r md:shadow-none md:transition-none md:sticky md:top-0 md:h-screen`}
      >
        <div className="px-4 py-5">
          <div className="flex items-center gap-2.5">
            <KandidateMark className="h-9 w-9 shrink-0 text-ink [--k-accent:var(--color-coral)] [--k-fg:var(--color-paper)] dark:-rotate-3" />
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
                  // badgeKey (Decisions / Pipeline / Schedule / Jobs / Channels).
                  const badge = item.badgeKey && attention ? attention[item.badgeKey] : 0;
                  // Items with badgeParams get a second click target: the badge
                  // opens the tab pre-filtered to the counted slice (declared in
                  // tabs.ts). Rendered as a SIBLING of the row button — a button
                  // may not nest interactive content — overlaid on the space the
                  // row reserves via padding.
                  const badgeSliceHref =
                    badge > 0 && item.badgeParams
                      ? buildUrl({ tab: item.id, ...clearedTabScopedParams(), ...item.badgeParams }, search)
                      : null;
                  return (
                    <div key={item.id} className={badgeSliceHref ? "relative" : "contents"}>
                      <button
                        type="button"
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => selectTab(item.id)}
                        className={`focus-ring flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-base font-medium transition-colors ${navItemClass(isActive)} ${badgeSliceHref ? "pr-10" : ""}`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-coral" : "bg-stone-300"}`}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1 truncate text-left">{navText(`tabs.${item.id}`, item.label)}</span>
                        {badge > 0 && !badgeSliceHref ? (
                          <span
                            aria-label={t("attentionBadge", { count: badge })}
                            className="shrink-0 rounded-full bg-coral/10 px-1.5 py-0.5 text-sm font-semibold leading-none text-coral"
                          >
                            {badge}
                          </span>
                        ) : null}
                      </button>
                      {badgeSliceHref ? (
                        <button
                          type="button"
                          title={t("attentionBadgeGo", { count: badge })}
                          aria-label={t("attentionBadgeGo", { count: badge })}
                          onClick={() => router.replace(badgeSliceHref, { scroll: false })}
                          className="focus-ring absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full bg-coral/10 px-1.5 py-0.5 text-sm font-semibold leading-none text-coral hover:bg-coral/20"
                        >
                          {badge}
                        </button>
                      ) : null}
                    </div>
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
        {/* Last item in the menu: drop the dev session and return to the landing. */}
        <div className="border-t border-stone-200 px-3 py-2">
          <SignOutButton />
        </div>
        <TasksIndicator active={active === "tasks"} onOpen={() => selectTab("tasks")} />
      </aside>

      <main id="main" tabIndex={-1} className="min-w-0 flex-1 bg-paper focus:outline-none">
        {/* pb-24 keeps content clear of the fixed simulation bar. The boundary
            contains a single tab's render crash to this panel (sidebar + sim bar
            survive) and clears itself when resetKey/navActive changes on a tab
            switch. The inner key replays the fade-in entrance on each switch. */}
        <div className="mx-auto max-w-[108rem] px-4 py-8 pb-24 sm:px-6 lg:px-8">
          <ErrorBoundary resetKey={navActive} label="This tab">
            <div key={navActive} className="animate-tab-in">
              {navActive === "pipeline" ? <PipelineTab /> : null}
              {navActive === "channels" ? <ChannelsTab /> : null}
              {navActive === "decisions" ? <DecisionsTab /> : null}
              {navActive === "schedule" ? <ScheduleTab /> : null}
              {navActive === "onboarding" ? <OnboardingTab /> : null}
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
              {navActive === "billing" ? <BillingTab /> : null}
              {navActive === "models" ? <ModelsTab /> : null}
              {navActive === "workspace" ? <WorkspaceTab /> : null}
              {navActive === "organization" ? <OrganizationTab /> : null}
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
