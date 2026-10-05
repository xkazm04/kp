import { JetBrains_Mono } from "next/font/google";

/*
 * About's instrument face (hero LCD, receipts tape, silkscreen labels):
 * --f-mono in css/about-tokens.css reads --font-mk-mono. A module of its own so
 * only /about preloads it; AboutHome passes `aboutMono.variable` to MkRoot.
 */
export const aboutMono = JetBrains_Mono({
  subsets: ["latin", "latin-ext"],
  weight: ["500", "700"],
  variable: "--font-mk-mono",
  display: "swap",
  // No generated Arial-based fallback face: see fonts.ts (it would catch the
  // glyphs the web font lacks ahead of the declared --f-mono stack). The list is
  // the first family of that stack; the CSS continues with the rest.
  adjustFontFallback: false,
  fallback: ["IBM Plex Mono"]
});
