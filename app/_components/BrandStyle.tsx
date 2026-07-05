import { getBrand } from "@/app/_lib/brand-store";

// White-label accent injection (E3). Overrides the `--color-coral` token — the
// primary brand accent — in BOTH themes with the workspace's configured color,
// re-skinning the whole app (buttons, active nav, focus rings, badges, AND the
// candidate-facing offer/apply/schedule pages, which share this root layout)
// through the single CSS-variable seam the design system was built for
// (docs/DESIGN.md). Rendered near the top of <body>, AFTER globals.css (which Next
// injects into <head>), so these :root / [data-theme] overrides win by source order.
//
// SAFETY: the color is strictly hex-validated at the store boundary
// (app/_lib/brand-config.ts, `sanitizeAccentColor`), so it can never carry arbitrary
// CSS — that validation is what makes the dangerouslySetInnerHTML below safe.
export function BrandStyle() {
  let accent: string | null = null;
  try {
    accent = getBrand().accentColor;
  } catch {
    accent = null; // a brand-read failure must never break the app shell
  }
  if (!accent) return null;
  const css = `:root{--color-coral:${accent};}[data-theme="dark"]{--color-coral:${accent};}`;
  return <style data-kp-brand="accent" dangerouslySetInnerHTML={{ __html: css }} />;
}
