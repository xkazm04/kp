"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Clock3 } from "lucide-react";
import { useRecents } from "./recents";

// SHELL3 — the sidebar "Recent" group. A client island so BOTH sidebars share
// it: the interactive Workspace and the server-rendered WorkspaceNav (detail
// pages), where localStorage is only reachable from the client. Renders
// nothing until something has been opened — no empty-section chrome.
export function RecentsNav() {
  const t = useTranslations("nav");
  const recents = useRecents();
  if (recents.length === 0) return null;
  return (
    <div className="px-3 pb-4">
      <p className="flex items-center gap-1.5 px-2 pb-1 text-sm font-semibold uppercase tracking-[0.12em] text-steel/70">
        <Clock3 size={12} aria-hidden /> {t("recent")}
      </p>
      <div className="space-y-0.5">
        {recents.map((r) => (
          <Link
            key={`${r.type}-${r.id}`}
            href={r.href}
            className="focus-ring flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium text-steel transition-colors hover:bg-stone-50 hover:text-ink"
          >
            <span className="h-1 w-1 shrink-0 rounded-full bg-stone-300" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{r.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
