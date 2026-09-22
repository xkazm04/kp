// Client-side theme store — the runtime half of the [data-theme="dark"] token
// seam in globals.css (docs/design/README.md: Studio Light vs Spark Dark). The DOM
// attribute IS the source of truth (the pre-hydration script in layout.tsx
// sets it before React boots); this module wraps it in a subscribable store so
// components read it via useSyncExternalStore instead of effect-and-setState.

export type Theme = "light" | "dark";

// Must match the literal in layout.tsx's THEME_INIT inline script.
export const THEME_STORAGE_KEY = "kp-theme";

const listeners = new Set<() => void>();

let storageBound = false;
let systemTheme: MediaQueryList | null = null;

function explicitTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "dark" || stored === "light" ? stored : null;
  } catch {
    return null;
  }
}

function applyThemeAttr(next: Theme): void {
  if (next === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
}

function onThemeStorage(ev: StorageEvent): void {
  if (ev.key !== THEME_STORAGE_KEY) return;
  // Foreign-tab write: apply the attribute the same way setTheme does, but do
  // not re-write localStorage (this tab did not choose; the other tab already stored).
  applyThemeAttr(ev.newValue === "dark" || (ev.newValue !== "light" && systemTheme?.matches) ? "dark" : "light");
  listeners.forEach((listener) => listener());
}

function onSystemThemeChange(ev: MediaQueryListEvent): void {
  if (explicitTheme()) return;
  applyThemeAttr(ev.matches ? "dark" : "light");
  listeners.forEach((listener) => listener());
}

function bindThemeStorage(): void {
  if (storageBound || typeof window === "undefined") return;
  window.addEventListener("storage", onThemeStorage);
  systemTheme = window.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
  systemTheme?.addEventListener("change", onSystemThemeChange);
  storageBound = true;
}

function unbindThemeStorage(): void {
  if (!storageBound || typeof window === "undefined") return;
  window.removeEventListener("storage", onThemeStorage);
  systemTheme?.removeEventListener("change", onSystemThemeChange);
  systemTheme = null;
  storageBound = false;
}

export function getTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

// Server snapshot: the server cannot know the visitor's choice; render the
// default and let the first client snapshot correct it after hydration.
export function getServerTheme(): Theme {
  return "light";
}

export function setTheme(next: Theme): void {
  applyThemeAttr(next);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Storage may be unavailable (private mode); the flip still holds for this page.
  }
  listeners.forEach((listener) => listener());
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  bindThemeStorage();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) unbindThemeStorage();
  };
}
