import type { ReactNode } from "react";
import { TITLE_DISPLAY } from "./recipes";

/*
 * Display title that changes register with the theme: Studio Light renders
 * the plain serif heading; Spark Dark adds the landing hero's hand-drawn
 * amber underline (and the title face itself flips to Bricolage via the
 * --font-serif token). The swap is pure CSS (`hidden dark:block` on the
 * squiggle), so this stays server-safe.
 */
export function SectionTitle({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <h2 className={`${TITLE_DISPLAY} ${className}`}>
      <span className="relative inline-block">
        {children}
        <svg
          viewBox="0 0 220 14"
          aria-hidden
          preserveAspectRatio="none"
          className="absolute -bottom-2 left-0 hidden h-2.5 w-full dark:block"
        >
          <path d="M4 10 C 50 2, 120 2, 216 8" fill="none" stroke="var(--color-dial-amber)" strokeWidth="6" strokeLinecap="round" />
        </svg>
      </span>
    </h2>
  );
}
