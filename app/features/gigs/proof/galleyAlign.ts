"use client";

import { useLayoutEffect, type RefObject } from "react";

/** Where the margin is a real column (a wide sheet), pull each paragraph's notes down to the
 *  first phrase they mark, so the hairline meets its underline (B/3's alignNotes). Used by
 *  the full galley (Galley.tsx). */
export function useAlignNotes(sheetRef: RefObject<HTMLElement | null>, paras: unknown, pinned: unknown) {
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const align = () => {
      sheet.querySelectorAll<HTMLElement>(".para").forEach((p) => {
        const notes = p.querySelector<HTMLElement>(".mnotes");
        const mark = p.querySelector<HTMLElement>("mark.pm");
        if (!notes || !mark || !notes.children.length) return;
        notes.style.paddingTop = "";
        if (getComputedStyle(notes).gridColumnStart !== "3") return;
        const off = mark.getBoundingClientRect().top - p.getBoundingClientRect().top - 12;
        notes.style.paddingTop = `${Math.max(0, Math.round(off))}px`;
      });
    };
    align();
    const ro = new ResizeObserver(align);
    ro.observe(sheet);
    return () => ro.disconnect();
  }, [sheetRef, paras, pinned]);
}
