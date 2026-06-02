"use client";

import { AlertTriangle } from "lucide-react";
import type { LoadState } from "@/app/_lib/useLoader";

// How long ago a `lastUpdated` epoch was, in coarse human units.
function ago(ms: number): string {
  const d = (Date.now() - ms) / 1000;
  if (!Number.isFinite(d) || d < 0) return "just now";
  if (d < 60) return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

// Surfaces a loader's failure so an outage no longer renders identically to a
// genuinely empty result. Renders nothing while the loader is healthy. On
// failure it distinguishes two cases via `lastUpdated`:
//  - never loaded  → "couldn't load" (we have nothing to show)
//  - loaded before → "stale, last updated X ago" (we're showing old data)
// `variant="banner"` is for an empty slot; `variant="pill"` sits inline in a
// section header next to data that's now stale.
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
  if (!state.failed) return null;
  const seen = state.lastUpdated != null;

  if (variant === "pill") {
    return (
      <span
        role="status"
        title={`Automatic refresh of ${label} is failing${seen ? ` — last updated ${ago(state.lastUpdated!)}` : ""}.`}
        className={`inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-micro font-semibold uppercase text-amber-700 ${className}`}
      >
        <AlertTriangle size={11} className="shrink-0" /> {seen ? `stale · ${ago(state.lastUpdated!)}` : "offline"}
      </span>
    );
  }

  return (
    <div
      role="alert"
      className={`flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 ${className}`}
    >
      <AlertTriangle size={14} className="shrink-0" />
      <span>
        {seen
          ? `Couldn't refresh ${label} — showing data from ${ago(state.lastUpdated!)}. Retrying…`
          : `Couldn't load ${label} — the service may be down. Retrying…`}
      </span>
    </div>
  );
}
