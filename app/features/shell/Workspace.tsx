"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { KeyboardShortcuts } from "./WorkspaceKeyboardShortcuts";
import { navKey, shouldCloseDrawerOnNav } from "./nav/navDrawerClose";
import { useShellNavigate } from "./nav/shallow-nav";
import { useUrlInboxState } from "./nav/useUrlInboxState";
import { prefetchTabChunk, warmLikelyTabChunks } from "./tabChunks";
import { isMainInert } from "./nav/navDrawerA11y";
import { useAttention } from "./useAttention";
import { TasksProvider } from "./tasks/TasksProvider";
import { SimulationProvider } from "./simulation/SimulationProvider";
import { WorkspaceNavDrawer } from "./WorkspaceNavDrawer";
import { WorkspaceTabPanel } from "./WorkspaceTabChunks";
import { SimSurfaces, FirstRunOnboarding } from "./WorkspaceSimSurfaces";
import {
  AGENTS_TAB_IN_NAV,
  buildUrl,
  clearedTabScopedParams,
  DEFAULT_TAB,
  navLabel,
  resolveTabParam,
  type WorkspaceTabId,
} from "./tabs";

export type { WorkspaceTabId } from "./tabs";

export function Workspace({ firstRunOnboarding = false }: { firstRunOnboarding?: boolean }) {
  // Same-document URL patching, not router.push: a `?tab=` switch changes nothing
  // the SERVER render of '/' depends on, so making it a server navigation only
  // bought a ~358 KB RSC round-trip per click. See nav/shallow-nav.ts.
  const nav = useShellNavigate();
  const params = useSearchParams();
  const pathname = usePathname();
  const t = useTranslations("nav");
  // First-run setup wizard, decided server-side by the '/' gate. Local state so
  // Skip/finish dismisses it immediately; persistence (completed/skipped) is the
  // wizard's own POST /api/me/onboarding, which stops the gate re-firing it.
  const [onboardingOpen, setOnboardingOpen] = useState(firstRunOnboarding);
  // Translate a nav key (tabs.<id> / groups.<key>) through the catalog, falling
  // back to the English label baked into tabs.ts for any not-yet-translated entry.
  const navText = (key: string, fallback: string): string => navLabel(t, key, fallback);
  const search = params.toString();
  // SHELL2 — live "what needs my attention" counts behind the nav badges.
  const attention = useAttention();
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
  // setMobileNavOpen is identity-stable, but React Compiler's memoization check
  // requires the declared deps to match what the body references (same as selectTab).
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), [setMobileNavOpen]);
  // The active tab lives in APP STATE; `?tab=` is only an inbox for arrivals
  // (deep links, comms emails, TasksIndicator, CompletionCta), consumed and
  // cleared on receipt. See nav/useUrlInboxState.ts for why.
  //
  // `parse` owns the whole vocabulary so the hook stays generic: legacy ids
  // (?tab=profile, ?tab=dev) resolve to their renamed tab via LEGACY_TAB_ALIASES,
  // and a gated tab (Agents, experimental via AGENTS_TAB_IN_NAV) is REJECTED
  // here rather than adopted-then-corrected. Returning null leaves the current
  // tab alone, so a link to a gated view is inert instead of bouncing the
  // reader to the default.
  const [active, setActive] = useUrlInboxState<WorkspaceTabId>(
    "tab",
    (raw) => {
      const requested = resolveTabParam(raw);
      if (requested == null) return null;
      if (requested === "agents" && !AGENTS_TAB_IN_NAV) return null;
      return requested;
    },
    DEFAULT_TAB
  );
  // History is consolidated into Analyze; ?tab=history opens Analyze in history mode.
  const navActive: WorkspaceTabId = active === "history" ? "analyze" : active;

  // Switching tabs from the sidebar clears every tab-scoped deep-link param
  // (the allowlist lives in tabs.ts, not in this call site) so the destination
  // never inherits the prior tab's selection.
  const selectTab = useCallback(
    (id: WorkspaceTabId): void => {
      setMobileNavOpen(false); // a tab pick on mobile closes the drawer
      // Start the destination's code-split chunk before the swap, so the fetch
      // overlaps it instead of following it. A no-op once warm.
      prefetchTabChunk(id);
      setActive(id);
      // The switch itself writes nothing to the URL. The ONE thing that still
      // must: tab-scoped deep-link params (?profile=, ?job=, ?edit=, ?jd*) are
      // still read from the URL by their tabs, so a leftover selection would be
      // inherited by the destination — the exact leak clearedTabScopedParams
      // exists to prevent. Only written when one is actually present, so the
      // ordinary click still touches nothing.
      const stale = Object.keys(clearedTabScopedParams()).some((k) => params.get(k) != null);
      if (stale) nav.replace(buildUrl(clearedTabScopedParams(), search));
    },
    // setMobileNavOpen is identity-stable, but React Compiler's memoization
    // check requires the declared deps to match what the body references.
    [nav, params, search, setActive, setMobileNavOpen]
  );

  // a11y — on a tab switch, move focus to the <main> landmark (reusing the
  // skip-link target) and announce the newly active tab through a polite live
  // region, so an AT user isn't left with a silently swapped page after a sidebar
  // click or a g-chord (both route through selectTab → navActive). The prevNavActive
  // comparison fires the effect ONLY on a real tab change: the very first render
  // (initial load / deep link) sees prevNavActive === navActive and skips — so we
  // never steal focus on load — and unrelated re-renders (attention counts, drawer
  // toggles) don't re-announce.
  const mainRef = useRef<HTMLElement>(null);
  const [tabAnnouncement, setTabAnnouncement] = useState("");
  const prevNavActive = useRef(navActive);
  useEffect(() => {
    if (prevNavActive.current === navActive) return;
    prevNavActive.current = navActive;
    mainRef.current?.focus();
    setTabAnnouncement(t("tabSwitched", { tab: navText(`tabs.${navActive}`, navActive) }));
    // navText/t are derived from the same render; navActive is the sole trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navActive]);

  // Warm the hiring tabs a session almost always reaches, once the browser is idle
  // — the cold-render cost of a tab is its chunk download, and paying it during a
  // quiet moment after mount is free. Re-armed when the active tab changes so the
  // warm set never includes what is already rendering. See shell/tabChunks.ts.
  useEffect(() => warmLikelyTabChunks(navActive), [navActive]);

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

  // Escape-close, Tab-trap and focus-restore are owned by <MobileDrawerA11y> (inside
  // WorkspaceNavDrawer), which mounts only while the drawer is open on mobile (the
  // shared useDialogA11y).

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

      {/* Polite live region: announces the active tab on a switch (focus is moved to
          <main> in the effect above). Visually hidden; updated once per real switch. */}
      <div aria-live="polite" role="status" className="sr-only">
        {tabAnnouncement}
      </div>

      <WorkspaceNavDrawer
        t={t}
        drawerRef={drawerRef}
        isMobile={isMobile}
        mobileNavOpen={mobileNavOpen}
        setMobileNavOpen={setMobileNavOpen}
        closeMobileNav={closeMobileNav}
        navActive={navActive}
        active={active}
        attention={attention}
        search={search}
        selectTab={selectTab}
        onSliceNav={(href) => nav.push(href)}
        onPrefetchTab={prefetchTabChunk}
      />

      {/* SHELL4: g-chord tab navigation + the "?" reference overlay (keyboard-only;
          no visible sidebar chrome). */}
      <KeyboardShortcuts onSelectTab={selectTab} />

      {/* While the mobile drawer is open, the rest of the page is inert so focus can't
          leak behind the scrim (the actual focus trap). Never inert at md+. */}
      <main ref={mainRef} id="main" tabIndex={-1} inert={isMainInert(isMobile, mobileNavOpen)} className="min-w-0 flex-1 bg-paper focus:outline-none">
        {/* pb-24 keeps content clear of the fixed simulation bar. The boundary
            contains a single tab's render crash to this panel (sidebar + sim bar
            survive) and clears itself when resetKey/navActive changes on a tab
            switch. The inner key replays the fade-in entrance on each switch. */}
        <div className="mx-auto max-w-[108rem] px-4 py-8 pb-24 sm:px-6 lg:px-8">
          <WorkspaceTabPanel navActive={navActive} active={active} />
        </div>
      </main>
      <SimSurfaces />
      {onboardingOpen && <FirstRunOnboarding mode="live" onClose={() => setOnboardingOpen(false)} />}
    </div>
    </SimulationProvider>
    </TasksProvider>
  );
}
