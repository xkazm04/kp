import { deriveDarkAccent } from "@/app/_lib/brand-config";

// White-label accent injection (E3). Overrides the `--color-coral` token — the
// primary brand accent — in BOTH themes with the workspace's configured color,
// re-skinning the whole app (buttons, active nav, focus rings, badges, AND the
// candidate-facing offer/apply/schedule pages, which share this root layout)
// through the single CSS-variable seam the design system was built for
// (docs/design/README.md). Rendered near the top of <body>, AFTER globals.css (which Next
// injects into <head>), so these :root / [data-theme] overrides win by source order.
//
// The accent is passed in by the root layout (which reads getBrand() once and also
// seeds BrandProvider), so the brand is a single DB read per request.
//
// TWO themes, TWO values. This used to write the SAME literal into both blocks,
// which is only correct if one hex happens to read on a cream canvas (#fdf8ee) and
// on an ink-blue one (#141b24) — and most brand colors do not. A mid-blue accent
// such as #0057b8 measures 6.5:1 in Studio Light and 2.5:1 in Spark Dark: legible
// where it was validated, invisible where it was copied. globals.css solves this by
// hand for the product's own coral (#d65a4a → #ff7e68 under [data-theme="dark"]);
// `deriveDarkAccent` does the same mechanically — same hue and saturation, lifted in
// lightness only as far as 3:1 on both dark grounds requires. The write door refuses
// an accent with no derivable twin, so a null here means "no accent at all".
//
// SAFETY: the color is strictly hex-validated at the store boundary
// (app/_lib/brand-config.ts, `sanitizeAccentColor`), so it can never carry arbitrary
// CSS — that validation is what makes the dangerouslySetInnerHTML below safe. The
// dark twin is not operator input at all: it is COMPUTED from the validated accent
// and emitted as `#rrggbb`, so it cannot widen that surface.
export function BrandStyle({ accent }: { accent: string | null }) {
  if (!accent) return null;
  // Falls back to the light accent only if the twin cannot be derived — the same
  // behavior as before this component knew about the dark theme, so a brand row
  // that predates the rule still paints something rather than nothing.
  const dark = deriveDarkAccent(accent) ?? accent;
  const css = `:root{--color-coral:${accent};}[data-theme="dark"]{--color-coral:${dark};}`;
  return <style data-kp-brand="accent" dangerouslySetInnerHTML={{ __html: css }} />;
}
