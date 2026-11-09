"use client";

// Console deep links for the panels. The surface itself is PanelFrame.tsx.
//
// Round 5: /one has two FRAMES (OneFrame below). On the `/one` page a Console link is a
// plain link — it leaves for `/`, a real navigation. Inside the workspace (`?tab=one`) the
// workspace IS the console, so the same link switches tabs IN PLACE through the shell's own
// door (useShellNavigate: a same-document `?tab=` patch the URL inbox adopts — no RSC
// round-trip; like every workspace tab switch it is app state, not a history step). It stays an <a> with its href either way, so a
// modified click (new tab / window) still opens the destination on its own.
import Link from "next/link";
import { createContext, useContext, type MouseEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useShellNavigate } from "@/app/features/shell/nav/shallow-nav";
import { buildUrl, clearedTabScopedParams, type WorkspaceTabId } from "@/app/features/shell/tabs";

/** Where /one is mounted: its own page (`/one`, owns the viewport) or a workspace tab. */
export type OneFrame = "page" | "tab";
export const OneFrameContext = createContext<OneFrame>("page");
export const useOneFrame = (): OneFrame => useContext(OneFrameContext);

/** A Console deep link: the tab plus its scoped params, from a clean query (/one's own
 *  query must never leak into the workspace). */
export function consoleHref(tab: WorkspaceTabId, params: Record<string, string> = {}): string {
  return buildUrl({ ...clearedTabScopedParams(), tab, ...params }, "");
}

/** A link into the Console that, inside the workspace, switches tabs in place. */
export function ConsoleAnchor({ href, className, children, ...rest }: { href: string; className: string; children: ReactNode; "data-role"?: string; "data-tip"?: string }) {
  const frame = useOneFrame();
  const nav = useShellNavigate();
  const onClick =
    frame === "tab"
      ? (e: MouseEvent<HTMLAnchorElement>) => {
          // A modified or non-primary click keeps the browser's own meaning (new tab, window).
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          nav.push(href);
        }
      : undefined;
  return (
    <Link className={className} href={href} onClick={onClick} {...rest}>
      {children}
    </Link>
  );
}

export function ConsoleLink({ tab, params, label }: { tab: WorkspaceTabId; params?: Record<string, string>; label?: string }) {
  const t = useTranslations("one.core.panels");
  return (
    <ConsoleAnchor className="k-btn k-btn--link k-btn--sm" href={consoleHref(tab, params)} data-role="one-console-link">
      {label ?? t("openInConsole")}
    </ConsoleAnchor>
  );
}
