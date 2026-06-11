"use client";

import { useSyncExternalStore } from "react";
import { getServerTheme, getTheme, subscribeTheme, type Theme } from "@/app/_lib/theme";

// Reactive theme for BEHAVIORAL forks — different handlers, effects, chart
// configs, animation params per register. For markup-only forks prefer
// ThemeSplit (pure CSS, server-safe); for style-only differences prefer a
// dark: variant on the recipe. Server snapshot renders the default theme;
// the real value snaps in at hydration.
export function useTheme(): Theme {
  return useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);
}
