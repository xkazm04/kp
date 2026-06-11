// Client-side theme store — the runtime half of the [data-theme="dark"] token
// seam in globals.css (docs/DESIGN.md: Studio Light vs Spark Dark). The DOM
// attribute IS the source of truth (the pre-hydration script in layout.tsx
// sets it before React boots); this module wraps it in a subscribable store so
// components read it via useSyncExternalStore instead of effect-and-setState.

export type Theme = "light" | "dark";

// Must match the literal in layout.tsx's THEME_INIT inline script.
export const THEME_STORAGE_KEY = "kp-theme";

const listeners = new Set<() => void>();

export function getTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

// Server snapshot: the server cannot know the visitor's choice; render the
// default and let the first client snapshot correct it after hydration.
export function getServerTheme(): Theme {
  return "light";
}

export function setTheme(next: Theme): void {
  if (next === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Storage may be unavailable (private mode); the flip still holds for this page.
  }
  listeners.forEach((listener) => listener());
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
