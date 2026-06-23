"use client";

import { useSyncExternalStore } from "react";
import { getServerTheme, getTheme, subscribeTheme, type Theme } from "@/app/_lib/theme";

// Reactive theme for BEHAVIORAL forks — different handlers, effects, chart
// configs, animation params per register. For style-only differences prefer a
// dark: variant on the recipe (markup-only forks can branch on this hook in a
// client component). Server snapshot renders the default theme; the real value
// snaps in at hydration.
export function useTheme(): Theme {
  return useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);
}
