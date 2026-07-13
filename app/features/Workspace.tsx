"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import dynamic from "next/dynamic";
import { Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/app/_components/Skeleton";
import { ErrorBoundary } from "@/app/_components/ErrorBoundary";
import { LanguageSwitcher } from "@/app/_components/LanguageSwitcher";
import { ThemeToggle } from "@/app/_components/ThemeToggle";
import { SignOutButton } from "@/app/_components/auth/SignOutButton";
import { BrandHeader } from "@/app/_components/BrandHeader";
import { useBrand } from "@/app/_components/BrandProvider";
import KandidateMark from "@/app/landing/_components/KandidateMark";
import { CommandPalette } from "./CommandPalette";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { RecentsNav } from "./RecentsNav";
import { SectionRailNav } from "./nav/SectionRailNav";
import { useDialogA11y } from "@/app/_components/useDialogA11y";
import { isDrawerInert, isMainInert, shouldTrapDrawerFocus } from "./nav/drawer-a11y";
import { navKey, shouldCloseDrawerOnNav } from "./nav/drawer-nav-close";
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
const BrandingTab = dynamic(() => import("./sub_branding/BrandingTab").then((m) => ({ default: m.BrandingTab })), { loading });

// Mounted ONLY while the mobile drawer is open (never on desktop, where the rail is
// permanent). Reuses the shared dialog machinery on the <aside>: move focus inside on
// open, trap Tab within the drawer, close on Escape (top-of-stack gated), lock body
// scroll, and restore focus to the hamburger on close/unmount. Mounting on open (and
// unmounting on close) is what fits the mount-lifecycle hook to a persistent element.
function MobileDrawerA11y({
  drawerRef,
  onClose,
}: {
  drawerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  useDialogA11y(drawerRef, onClose, { trap: true, lockScroll: true });
  return null;
}

export function Workspace() {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
  const t = useTranslations("nav");
  // Translate a nav key (tabs.<id> / groups.<key>) through the catalog, falling
  // back to the English label baked into tabs.ts for any not-yet-translated entry.
  const navText = (key: string, fallback: string): string => navLabel(t, key, fallback);
  const search = params.toString();
  const tabParam = params.get("tab");
  // SHELL2 — live "what needs my attention" counts behind the nav badges.
  const attention = useAttention();
  // White-label mark for the rail top (workspace logo, else the KandiDate mark).
  const { logoUrl } = useBrand();
  // Below `md` the sidebar is an off-canvas drawer (a permanent rail at md+). Without
  // this, the full ~16-item nav stacked above content and pushed every page below the
  // fold on a phone — the studio was close to unusable on a handset.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Below `md` the <aside> is the off-canvas drawer; at md+ it's the always-visible
  // rail. `inert`/focus-trap decisions differ between the two and can't be expressed in
  // CSS (inert is an attribute, not a property), so we track the breakpoint in JS. md =
  // 768px (Tailwind), so "mobile" is < 768px. Defaults false → SSR/first client render
  // agree (no hydration mismatch); the effect corrects it on mount.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767.98px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  // The drawer element, wired to the shared dialog machinery while open (below).
  const drawerRef = useRef<HTMLElement | null>(null);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
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

  // Close the mobile drawer on ANY in-shell navigation, not just a sidebar tab pick.
  // The badge-slice pill (onSliceNav) and the command palette (which has no access to
  // mobileNavOpen) navigate through separate entry points that selectTab's own close
  // never covered, leaving the drawer parked over the freshly-loaded content. Keying an
  // effect on the navigation identity (pathname + search) clears it for every present
  // and future path. bug-ui-scan 2026-07-09 (#2).
  const currentNavKey = navKey(pathname, search);
  const prevNavKey = useRef(currentNavKey);
  useEffect(() => {
    if (shouldCloseDrawerOnNav(prevNavKey.current, currentNavKey)) {
      prevNavKey.current = currentNavKey;
      setMobileNavOpen(false);
    }
  }, [currentNavKey]);

  // Escape-close, Tab-trap and focus-restore are owned by <MobileDrawerA11y> below,
  // which mounts only while the drawer is open on mobile (the shared useDialogA11y).

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
          <BrandHeader markClass="h-7 w-7" showTagline={false} />
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

      {/* Collapsed on mobile → `inert` removes the whole subtree from the tab order
          AND the a11y tree (so aria-expanded={mobileNavOpen} is truthful), not merely
          translated off-canvas. Never inert at md+ where the rail is the visible nav. */}
      <aside
        ref={drawerRef}
        id="workspace-nav"
        tabIndex={-1}
        inert={isDrawerInert(isMobile, mobileNavOpen)}
        className={`bg-paper fixed inset-y-0 left-0 z-50 flex w-[17rem] max-w-[85vw] overflow-hidden border-r border-stone-300 shadow-xl transition-transform duration-200 focus:outline-none ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        } md:z-auto md:max-w-none md:shrink-0 md:translate-x-0 md:border-r md:shadow-none md:transition-none md:sticky md:top-0 md:h-screen`}
      >
        <SectionRailNav
          groups={NAV_GROUPS}
          navActive={navActive}
          onSelect={selectTab}
          attention={attention}
          navText={navText}
          attentionLabel={(count) => t("attentionBadge", { count })}
          attentionGoLabel={(count) => t("attentionBadgeGo", { count })}
          sliceHrefFor={(item) =>
            item.badgeParams ? buildUrl({ tab: item.id, ...clearedTabScopedParams(), ...item.badgeParams }, search) : null
          }
          onSliceNav={(href) => router.replace(href, { scroll: false })}
          railTop={
            <div className="mb-1 flex justify-center py-1">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- external brand logo URL, not a bundled asset
                <img src={logoUrl} alt="" className="h-8 w-8 rounded-lg object-contain" />
              ) : (
                <KandidateMark className="h-8 w-8 text-ink [--k-accent:var(--color-coral)] [--k-fg:var(--color-paper)] dark:-rotate-3" />
              )}
            </div>
          }
          panelHeader={
            <>
              {/* SHELL1: global search (also opens anywhere via Ctrl/Cmd+K). */}
              <div className="px-3 pb-1 pt-3">
                <CommandPalette />
              </div>
              {/* SHELL3: pick-up-where-I-left-off deep links. */}
              <RecentsNav />
            </>
          }
          panelFooter={
            <>
              <div className="space-y-2 border-t border-stone-200 px-3 py-2.5">
                <LanguageSwitcher />
                <ThemeToggle />
              </div>
              {/* Drop the dev session and return to the landing. */}
              <div className="border-t border-stone-200 px-3 py-2">
                <SignOutButton />
              </div>
              <TasksIndicator active={active === "tasks"} onOpen={() => selectTab("tasks")} />
            </>
          }
        />
      </aside>

      {/* SHELL4: g-chord tab navigation + the "?" reference overlay (keyboard-only;
          no visible sidebar chrome). */}
      <KeyboardShortcuts onSelectTab={selectTab} />

      {/* Modal focus-trap for the open mobile drawer (focus-in, Tab-trap, Escape,
          focus-restore to the hamburger). Mounted only when isMobile && open. */}
      {shouldTrapDrawerFocus(isMobile, mobileNavOpen) ? (
        <MobileDrawerA11y drawerRef={drawerRef} onClose={closeMobileNav} />
      ) : null}

      {/* While the mobile drawer is open, the rest of the page is inert so focus can't
          leak behind the scrim (the actual focus trap). Never inert at md+. */}
      <main id="main" tabIndex={-1} inert={isMainInert(isMobile, mobileNavOpen)} className="min-w-0 flex-1 bg-paper focus:outline-none">
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
              {navActive === "branding" ? <BrandingTab /> : null}
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
