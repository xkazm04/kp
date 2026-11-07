"use client";

// Console deep links for the panels. The surface itself is PanelFrame.tsx.
import Link from "next/link";
import { useTranslations } from "next-intl";
import { buildUrl, clearedTabScopedParams, type WorkspaceTabId } from "@/app/features/shell/tabs";

/** A Console deep link: the tab plus its scoped params, from a clean query (/one's own
 *  `?v=` must never leak into the workspace). */
export function consoleHref(tab: WorkspaceTabId, params: Record<string, string> = {}): string {
  return buildUrl({ ...clearedTabScopedParams(), tab, ...params }, "");
}

export function ConsoleLink({ tab, params, label }: { tab: WorkspaceTabId; params?: Record<string, string>; label?: string }) {
  const t = useTranslations("one.core.panels");
  return (
    <Link className="k-btn k-btn--link k-btn--sm" href={consoleHref(tab, params)} data-role="one-console-link">
      {label ?? t("openInConsole")}
    </Link>
  );
}
