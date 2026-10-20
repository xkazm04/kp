"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useDialogA11y } from "@/app/_components/useDialogA11y";

/*
 * The interactive half of the header (the prototype's shared/chrome.js): the bar
 * goes solid once the page has scrolled 40px (or always, `solid`, as on About
 * over its dark world), and the Menu button opens the phone menu.
 *
 * The bar's contents and the menu's contents are server-rendered and passed in;
 * this component only owns the <header> element, the Menu button and the panel.
 * The panel is a SIBLING of the header, never inside it: `.bar.is-stuck` carries a
 * backdrop-filter, which would make the header the containing block of a fixed
 * child and shrink the full-screen menu to the bar's 64px.
 *
 * Menu keyboard contract (today's MobileNav): focus moves into the menu on open,
 * Escape closes it, focus returns to the Menu button; any link in it closes it.
 * Non-modal (no trap, no scroll lock), like the prototype's.
 */
export function HeaderShell({ solid, menu, children }: { solid: boolean; menu: ReactNode; children: ReactNode }) {
  const t = useTranslations("siteChrome");
  const [stuck, setStuck] = useState(solid);
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    if (solid) return;
    const onScroll = () => setStuck(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [solid]);

  return (
    <>
      <header className={stuck ? "bar is-stuck" : "bar"} id="bar">
        {children}
        <button
          className="menu-btn"
          type="button"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? t("menu.close") : t("menu.open")}
        </button>
      </header>
      {open ? (
        <MenuPanel id={menuId} onClose={() => setOpen(false)}>
          {menu}
        </MenuPanel>
      ) : null}
    </>
  );
}

function MenuPanel({ id, onClose, children }: { id: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useDialogA11y(ref, onClose, { trap: false, lockScroll: false });
  return (
    <div
      id={id}
      ref={ref}
      tabIndex={-1}
      className="menu"
      onClick={(e) => {
        if (e.target instanceof Element && e.target.closest("a")) onClose();
      }}
    >
      {children}
    </div>
  );
}
