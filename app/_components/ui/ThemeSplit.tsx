import type { ReactNode } from "react";

/*
 * Two-version rendering for components that genuinely fork between the
 * themes' registers (docs/DESIGN.md) — when a dark: variant on a recipe
 * isn't enough because the markup itself differs (decorations, alternate
 * layouts, hand-drawn accents).
 *
 * Both variants render into the DOM; the .theme-*-only helpers in globals.css
 * pick the live one via [data-theme]. That makes the swap pure CSS: no
 * hydration flash, no client JS, usable from Server Components, and
 * display:contents keeps the wrappers out of flex/grid layout. The dormant
 * variant stays mounted — keep ThemeSplit presentational; if a fork carries
 * state or effects, branch on useTheme() in a client component instead.
 */
export function ThemeSplit({ light, dark }: { light: ReactNode; dark: ReactNode }) {
  return (
    <>
      <span className="theme-light-only">{light}</span>
      <span className="theme-dark-only">{dark}</span>
    </>
  );
}
