"use client";

import { useId, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDialogA11y } from "@/app/_components/useDialogA11y";
import { enterWorkspace } from "@/app/_lib/auth/session-nav";
import { sourceRepoHref } from "@/app/_lib/source-repo";
import { SECTIONS } from "../SectionRail";

/*
 * Phone-width navigation.
 *
 * Below `sm` the landing had NO navigation at all: the topbar's destinations
 * are `hidden sm:flex` and the section rail is `lg:block`, so a phone visitor's
 * only way anywhere was the hero's two buttons or a scroll to the footer. Five
 * bands of page and no way to jump to the one you came for.
 *
 * A disclosure rather than a full-screen sheet: it is a short list, and the
 * hero should still be visible behind it so the menu reads as an aside on the
 * page rather than a new screen. Keyboard behaviour comes from the app's shared
 * `useDialogA11y` in its NON-modal mode — focus moves into the panel on open,
 * Escape closes it, focus returns to the toggle — which is the contract a
 * disclosure owes without pretending to be a modal that swallows Tab.
 *
 * Section links keep a real `href="#id"` (the no-JS fallback) and glide via
 * `scrollIntoView`, the same as the rail; landing is the fixed art direction,
 * so literal hexes here are the docs/design/README.md exemption.
 */
function MobileNavPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useTranslations("landing");
  const ref = useRef<HTMLDivElement | null>(null);
  useDialogA11y(ref, onClose, { trap: false, lockScroll: false });

  const goToSection = (event: React.MouseEvent<HTMLAnchorElement>, sectionId: string) => {
    const el = document.getElementById(sectionId);
    if (!el) {
      onClose(); // Band not on this page — let the browser follow the anchor.
      return;
    }
    event.preventDefault();
    history.replaceState(null, "", `#${sectionId}`);
    onClose();
    // AFTER the close, and a frame later. Closing unmounts this panel, and
    // useDialogA11y's teardown calls .focus() on the toggle — which scrolls the
    // toggle back into view. Scrolling first meant the page snapped straight
    // back to the top and the tap did nothing (caught by e2e/landing.spec.ts).
    requestAnimationFrame(() => el.scrollIntoView({ block: "start" }));
  };

  return (
    <div
      id={id}
      ref={ref}
      tabIndex={-1}
      className="absolute right-6 top-full z-50 mt-2 w-56 rounded-2xl border-[3px] border-[#17202a] bg-[#fdf8ee] p-2 shadow-[6px_6px_0_#17202a] outline-none sm:hidden"
    >
      <ul className="flex flex-col">
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              onClick={(e) => goToSection(e, s.id)}
              className="block rounded-xl px-3 py-2 text-[17px] font-bold hover:bg-[#dce7d0] focus-ring"
            >
              {t(`nav.${s.key}`)}
            </a>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-col border-t-[3px] border-dashed border-[#dce7d0] pt-2">
        <a href="/about" className="rounded-xl px-3 py-2 text-[17px] font-bold hover:bg-[#dce7d0] focus-ring">
          {t("nav.about")}
        </a>
        <a href="/market" className="rounded-xl px-3 py-2 text-[17px] font-bold hover:bg-[#dce7d0] focus-ring">
          {t("nav.market")}
        </a>
        <a
          href={sourceRepoHref()}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-xl px-3 py-2 text-[17px] font-bold hover:bg-[#dce7d0] focus-ring"
        >
          {t("nav.source")}
        </a>
        <button
          type="button"
          onClick={() => {
            onClose();
            void enterWorkspace();
          }}
          className="mt-2 rounded-lg border-[3px] border-[#17202a] bg-[#caa54c] px-3 py-2 text-[17px] font-bold shadow-[3px_3px_0_#17202a] focus-ring"
        >
          {t("nav.signIn")}
        </button>
      </div>
    </div>
  );
}

export default function MobileNav() {
  const t = useTranslations("landing");
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? t("nav.menuClose") : t("nav.menuOpen")}
        onClick={() => setOpen((v) => !v)}
        className="grid h-11 w-11 place-items-center rounded-lg border-[3px] border-[#17202a] bg-white shadow-[3px_3px_0_#17202a] focus-ring sm:hidden"
      >
        {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
      </button>
      {open && <MobileNavPanel id={panelId} onClose={() => setOpen(false)} />}
    </>
  );
}
