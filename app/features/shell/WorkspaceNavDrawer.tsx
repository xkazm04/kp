"use client";

// The mobile top bar + off-canvas drawer chrome (rail + panel), split out of
// Workspace.tsx to stay under the 200-line file cap. Below `md` the sidebar is an
// off-canvas drawer (a permanent rail at md+); this owns the hamburger, the scrim,
// the <aside> and its focus-trap mount, and the SectionRailNav wiring. Verbatim
// move — no behaviour change.
import { Menu, X } from "lucide-react";
import type { RefObject } from "react";
import type { useTranslations } from "next-intl";
import KandidateMark from "@/app/landing/_components/KandidateMark";
import type { AttentionCounts } from "@/app/_lib/attention";
import { BrandHeader } from "@/app/_components/BrandHeader";
import { SignOutButton } from "@/app/_components/auth/SignOutButton";
import { useDialogA11y } from "@/app/_components/useDialogA11y";
import { CommandPalette } from "./WorkspaceCommandPalette";
import { RecentsNav } from "./WorkspaceRecentsNav";
import { NavFeedbackButton } from "./nav/NavFeedbackButton";
import { RailPreferences } from "./nav/NavRailPreferences";
import { NavSectionRail } from "./nav/NavSectionRail";
import { isDrawerInert, shouldTrapDrawerFocus } from "./nav/navDrawerA11y";
import { TasksIndicator } from "./tasks/TasksIndicator";
import { NAV_GROUPS, type WorkspaceTabId } from "./tabs";

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

export function WorkspaceNavDrawer({
  t,
  drawerRef,
  isMobile,
  mobileNavOpen,
  setMobileNavOpen,
  closeMobileNav,
  navActive,
  active,
  attention,
  search,
  logoUrl,
  selectTab,
  onSliceNav,
  onPrefetchTab,
}: {
  t: ReturnType<typeof useTranslations>;
  drawerRef: RefObject<HTMLElement | null>;
  isMobile: boolean;
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean | ((v: boolean) => boolean)) => void;
  closeMobileNav: () => void;
  navActive: WorkspaceTabId;
  active: WorkspaceTabId;
  attention: AttentionCounts | null;
  search: string;
  logoUrl: string | null;
  selectTab: (id: WorkspaceTabId) => void;
  onSliceNav: (href: string) => void;
  /** Warm a tab's code-split chunk on nav hover/focus (shell/tabChunks.ts). */
  onPrefetchTab: (id: WorkspaceTabId) => void;
}) {
  return (
    <>
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
        className={`bg-paper fixed inset-y-0 left-0 z-50 flex w-[17rem] max-w-[85vw] overflow-hidden border-r border-stone-300 pb-[env(safe-area-inset-bottom)] shadow-xl transition-transform duration-200 focus:outline-none ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        } md:z-auto md:max-w-none md:shrink-0 md:translate-x-0 md:border-r md:pb-0 md:shadow-none md:transition-none md:sticky md:top-0 md:h-screen`}
      >
        <NavSectionRail
          groups={NAV_GROUPS}
          navActive={navActive}
          attention={attention}
          // The React-tracked query string — NavSectionRail composes the badge-slice
          // hrefs off it (i18n + href helpers now resolve inside the shared renderer,
          // so the link-mode deep-link wrapper can be a plain Server Component).
          search={search}
          onSelect={selectTab}
          onSliceNav={onSliceNav}
          onPrefetchTab={onPrefetchTab}
          railTop={
            <div className="mb-1 hidden justify-center py-1 md:flex">
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
          // Theme, language and sign-out now live on the RAIL as icon-only
          // controls (each preference a popup of its variants), where Settings
          // used to be pinned. The level-2 panel footer keeps only the one item
          // that needs width: the Background-tasks label + load meter.
          railFooter={
            <>
              {/* The recruiter feedback door — in-product, lands on /control. */}
              <NavFeedbackButton />
              <RailPreferences />
              {/* Drop the dev session and return to the landing. */}
              <SignOutButton />
            </>
          }
          panelFooter={<TasksIndicator active={active === "tasks"} onOpen={() => selectTab("tasks")} />}
        />
      </aside>

      {/* Modal focus-trap for the open mobile drawer (focus-in, Tab-trap, Escape,
          focus-restore to the hamburger). Mounted only when isMobile && open. */}
      {shouldTrapDrawerFocus(isMobile, mobileNavOpen) ? (
        <MobileDrawerA11y drawerRef={drawerRef} onClose={closeMobileNav} />
      ) : null}
    </>
  );
}
