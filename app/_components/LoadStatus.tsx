"use client";

import { AlertTriangle } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { NOTICE } from "@/app/_components/ui/recipes";
import type { LoadState } from "@/app/_lib/useLoader";

// Surfaces a loader's failure so an outage no longer renders identically to a
// genuinely empty result. Renders nothing while the loader is healthy. On
// failure it distinguishes two cases via `lastUpdated`:
//  - never loaded  → "couldn't load" (we have nothing to show)
//  - loaded before → "stale, last updated X ago" (we're showing old data)
// `variant="banner"` is for an empty slot; `variant="pill"` sits inline in a
// section header next to data that's now stale.
//
// The frame sentences used to be English string literals wrapped around a
// `label` the caller had already localized — so a Czech operator read
// "Couldn't refresh Kandidáti — showing data from 3m ago." The elapsed time was
// hand-rolled too ("3m ago"), which is a relative-time format every locale
// spells differently; next-intl's formatter owns it now.
export function LoadStatus({
  state,
  label,
  variant = "banner",
  className = "",
}: {
  state: LoadState;
  label: string;
  variant?: "banner" | "pill";
  className?: string;
}) {
  const t = useTranslations("loadStatus");
  const format = useFormatter();
  if (!state.failed) return null;
  const seen = state.lastUpdated != null;
  // Formatted against an explicit `now` so the string is a pure function of the
  // render, not of when the formatter happened to read the clock.
  const ago = seen ? format.relativeTime(new Date(state.lastUpdated!), new Date()) : "";

  if (variant === "pill") {
    return (
      <span
        role="status"
        title={seen ? t("pillTitleStale", { label, ago }) : t("pillTitle", { label })}
        className={`inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-micro font-semibold uppercase text-amber-700 ${className}`}
      >
        <AlertTriangle size={11} className="shrink-0" /> {seen ? t("stale", { ago }) : t("offline")}
      </span>
    );
  }

  return (
    <div role="alert" className={`flex items-center gap-2 ${NOTICE("amber")} px-3 py-2 text-micro ${className}`}>
      <AlertTriangle size={14} className="shrink-0" />
      <span>{seen ? t("refreshFailed", { label, ago }) : t("loadFailed", { label })}</span>
    </div>
  );
}
