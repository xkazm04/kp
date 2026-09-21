"use client";

import { useCallback, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Menu, X } from "lucide-react";
import KandidateMark from "@/app/landing/_components/KandidateMark";
import { useDialogA11y } from "@/app/_components/useDialogA11y";

// The /me mobile chrome: a top bar and an off-canvas drawer, mirroring
// WorkspaceNavDrawer.tsx rather than inventing a second shape. What /me used to have
// below `md` was an `overflow-x-auto` strip of the same links — no drawer, and no
// brand at all, because RailBrandMark is `hidden md:flex`.
//
// WorkspaceNavDrawer is not reused directly: its props are the recruiter shell's
// (NAV_GROUPS, attention counts, capabilities, a tab-select callback), and /me has
// none of them. What IS reused is every mechanism it uses — the bar, the scrim, the
// `inert` collapsed subtree, and `useDialogA11y` for focus-in / Tab-trap / Escape /
// scroll-lock / focus-restore.
//
// The drawer holds the RAIL ITSELF (4.75rem), handed in by MeNav, so the mobile and
// desktop navigation are one definition. The aside deliberately does NOT clip its
// overflow: the appearance/language popovers open `left-full` off the rail, which at
// this width lands outside the drawer and over the scrim — where, at z-50, they are
// the frontmost thing on screen.

/** Mounted ONLY while the drawer is open, which is what fits the mount-lifecycle
 *  hook to a persistent element (the aside stays mounted so it can slide). */
function MeDrawerA11y({ drawerRef, onClose }: { drawerRef: RefObject<HTMLElement | null>; onClose: () => void }) {
  useDialogA11y(drawerRef, onClose, { trap: true, lockScroll: true });
  return null;
}

export function MeNavDrawer({ rail }: { rail: (close: () => void) => ReactNode }) {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLElement | null>(null);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      {/* Mobile top bar — hidden at md+ where the rail is permanent, and never printed. */}
      <div className="flex items-center justify-between border-b border-stone-300 bg-paper px-4 py-3 md:hidden print:hidden">
        {/* The mark, rendered here rather than by RailBrandMark (which hides below md),
            so a phone is not the one viewport with no way home and no brand. */}
        <Link href="/" aria-label={t("home")} className="focus-ring rounded-lg">
          <KandidateMark className="h-7 w-7 text-ink [--k-accent:var(--color-coral)] [--k-fg:var(--color-paper)] dark:-rotate-3" />
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="me-nav"
          aria-label={open ? t("closeMenu") : t("openMenu")}
          className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-md border border-stone-300 text-ink"
        >
          {open ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
        </button>
      </div>

      {/* Scrim behind the open drawer — click to dismiss. */}
      {open ? <div className="fixed inset-0 z-40 bg-ink/40 md:hidden" aria-hidden onClick={close} /> : null}

      {/* Collapsed → `inert` removes the whole subtree from the tab order AND the a11y
          tree (so aria-expanded is truthful), not merely translated off-canvas. The
          aside is md:hidden outright, so `inert` needs no viewport test. */}
      <aside
        ref={drawerRef}
        id="me-nav"
        tabIndex={-1}
        inert={!open}
        className={`fixed inset-y-0 left-0 z-50 flex w-[4.75rem] border-r border-stone-300 bg-paper pb-[env(safe-area-inset-bottom)] shadow-xl transition-transform duration-200 focus:outline-none md:hidden print:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {rail(close)}
      </aside>

      {open ? <MeDrawerA11y drawerRef={drawerRef} onClose={close} /> : null}
    </>
  );
}
