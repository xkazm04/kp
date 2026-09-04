// White-label brand configuration (E3 / E-BRD, docs/product/enterprise-readiness.md §4).
// (Distinct from app/_lib/brand.ts, which is the fixed design-system color palette.)
//
// Single-workspace today — like billing_state (id='workspace'); a workspace key gets
// added for multi-tenancy when E0 lands. Pure module (client + server): all
// validation lives here so the API, the store, and the editor agree on what's
// storable — and, crucially, so the accent color that gets injected into a
// server-rendered <style> is STRICTLY hex-validated (an unvalidated color would be a
// CSS-injection vector — see app/_components/BrandStyle.tsx).

import { DARK, PAPER, WHITE } from "@/app/_lib/brand";

export type BrandConfig = {
  /** White-label display name (sidebar + document title). null = product default. */
  displayName: string | null;
  /** Primary accent as hex — overrides the --color-coral token in both themes. */
  accentColor: string | null;
  /** https:// URL to the customer's logo. null = product default. */
  logoUrl: string | null;
  /** The Spark Dark twin of `accentColor`, DERIVED (never operator-supplied) by
   *  `deriveDarkAccent`. null exactly when `accentColor` is null. The app ships two
   *  themes from one codebase and the accent overrides `--color-coral` in BOTH of
   *  them; a hex validated only against the cream light paper (`#fdf8ee`) can land
   *  at ~2.2:1 on the dark paper (`#141b24`) — the store's own test accent
   *  `#0057b8` does exactly that — so injecting the same literal into both blocks
   *  paints an illegible Spark Dark. This is the second value BrandStyle needs. */
  accentDark: string | null;
};

export const DEFAULT_BRAND: BrandConfig = { displayName: null, accentColor: null, logoUrl: null, accentDark: null };

export const MAX_BRAND_NAME = 60;

// #rgb or #rrggbb only — anything else is rejected before it can reach a <style>.
export const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Whether a raw editor string is syntactically a hex color. The ONE owner of that
 *  question: BrandingTab re-typed this exact literal to decide whether to show the
 *  contrast warning, so a change here silently left the editor on the old rule. */
export function isHexColor(value: string): boolean {
  return HEX_COLOR.test(value.trim());
}

/** A strict hex color, or null. This value is injected into a <style> tag, so it
 *  must NEVER carry arbitrary CSS — e.g. `"red; } body { display:none"` → null. */
export function sanitizeAccentColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return HEX_COLOR.test(v) ? v.toLowerCase() : null;
}

// ── Accent legibility (WCAG contrast) ────────────────────────────────────────
// A syntactically valid hex still isn't a usable *brand* accent. The accent
// overrides --color-coral app-wide (BrandStyle.tsx), where it plays two roles:
//   (1) the FILL beneath white button labels (BTN_PRIMARY = text-white), and
//   (2) a thin graphical indicator — the focus ring / active-nav bar / row-hover
//       stripe — drawn against the cream --color-paper canvas (app/globals.css).
// A light accent makes white-on-accent text AND those focus rings invisible
// (WCAG 1.4.3 text / 2.4.7 focus). The hex regex can't see that; these helpers can.

/** The two grounds an accent must clear, per theme. Both are read off the ONE
 *  place each theme's canvas is declared (app/_lib/brand.ts, kept in lockstep with
 *  app/globals.css by `npm run design:check`), never re-typed here.
 *    `canvas`   - what a thin graphical indicator (focus ring, active-nav bar,
 *                 row-hover stripe) is drawn ON: `--color-paper`.
 *    `onAccent` - what sits IN the accent: the `text-white` button label. That is a
 *                 ROLE, not a color: `--color-white` remaps to #1d2630 in Spark Dark
 *                 (globals.css), so the dark theme's worst case is a DARK label on
 *                 the accent, not a white one. Validating a single "white text"
 *                 assumption is exactly how the light-only check got it wrong. */
export const ACCENT_GROUNDS = {
  light: { canvas: PAPER, onAccent: WHITE },
  dark: { canvas: DARK.PAPER, onAccent: DARK.SURFACE },
} as const;

/** The two themes the accent is injected into (BrandStyle.tsx). */
export type BrandTheme = keyof typeof ACCENT_GROUNDS;

/** WCAG AA for large/bold text and for non-text graphical objects is 3:1 - the
 *  right bar here: button labels are medium-weight UI text and the focus ring is a
 *  graphical indicator. 4.5:1 (AA normal text) would reject the product's OWN
 *  default coral (~3.9:1 on white / ~3.7:1 on paper), so 3:1 is the coherent line. */
export const MIN_ACCENT_CONTRAST = 3;

/** #rgb | #rrggbb -> [r,g,b] (0-255), or null when not a valid hex. */
function hexToRgb(hex: string): [number, number, number] | null {
  const v = hex.trim().toLowerCase();
  if (!HEX_COLOR.test(v)) return null;
  const h = v.slice(1);
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

/** sRGB relative luminance (WCAG 2.x): 0 = black ... 1 = white. */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio (1 ... 21) between two hex colors; NaN if either is not a
 *  valid hex. Symmetric: contrastRatio(a, b) === contrastRatio(b, a). */
export function contrastRatio(hex1: string, hex2: string): number {
  const a = hexToRgb(hex1);
  const b = hexToRgb(hex2);
  if (!a || !b) return NaN;
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** True when a hex accent is legible IN ONE THEME: the label on it AND the accent
 *  as an indicator against that theme's canvas both clear MIN_ACCENT_CONTRAST.
 *  null/empty (the product default) is always legible; an invalid hex is not.
 *
 *  `theme` defaults to "light" because that is the theme the OPERATOR types the hex
 *  for - Studio Light is the default skin and the accent is stored verbatim there.
 *  Spark Dark is not held to the same "as typed" bar: it gets a DERIVED twin
 *  (`deriveDarkAccent`), because demanding one literal that clears both a cream
 *  canvas and an ink-blue one would reject most real brand colors. */
export function accentIsLegible(hex: string | null | undefined, theme: BrandTheme = "light"): boolean {
  if (hex == null || hex.trim() === "") return true;
  if (hexToRgb(hex) == null) return false;
  const ground = ACCENT_GROUNDS[theme];
  return (
    contrastRatio(hex, ground.onAccent) >= MIN_ACCENT_CONTRAST &&
    contrastRatio(hex, ground.canvas) >= MIN_ACCENT_CONTRAST
  );
}

// -- The Spark Dark twin ------------------------------------------------------
// The product's own coral does this by hand: #d65a4a in :root, #ff7e68 under
// [data-theme="dark"] (globals.css) - same hue, lifted until it reads on the dark
// canvas. A white-label accent gets the same treatment mechanically.

/** How far the twin may travel from the operator's color, as absolute HSL
 *  lightness. The lift is what makes a dark accent legible on an ink-blue canvas;
 *  the CAP is what keeps it recognizably the same brand color. Past this the honest
 *  answer is a refusal naming Spark Dark, not a twin the operator would not accept
 *  as theirs. 0.35 is tuned so the product's own coral (L~0.56 -> ~0.70) sits well
 *  inside it while a near-black accent, which has no legible twin that is still
 *  near-black, falls outside. */
export const MAX_DARK_ACCENT_LIFT = 0.35;

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h = (h * 60 + 360) % 360;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const seg = Math.floor(((((h % 360) + 360) % 360) / 60)) % 6;
  const table = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ] as const;
  const [r1, g1, b1] = table[seg];
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r1)}${to(g1)}${to(b1)}`;
}

/**
 * The Spark Dark twin of a light accent: the SAME hue and saturation, lifted in
 * lightness in 1% steps until it clears MIN_ACCENT_CONTRAST against BOTH dark
 * grounds - the ink-blue canvas (#141b24) and the raised surface the dark
 * `text-white` label resolves to (#1d2630). Both grounds are dark, so contrast rises
 * monotonically with lightness and the first clearing step is also the closest one
 * to the operator's color.
 *
 * Returns the accent UNCHANGED when it already clears both (a light brand color
 * needs no twin), and `null` when no step within MAX_DARK_ACCENT_LIFT clears them -
 * a near-black accent, whose only legible twin would no longer be near-black. The
 * caller answers that with a code naming the theme rather than shipping either an
 * unreadable dark skin or a color the operator never chose.
 */
export function deriveDarkAccent(hex: string | null | undefined): string | null {
  if (hex == null || hex.trim() === "") return null;
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const canonical = normalizeHex6(hex);
  if (canonical && accentIsLegible(canonical, "dark")) return canonical;
  const [h, s, l0] = rgbToHsl(rgb);
  for (let step = 1; step <= Math.round(MAX_DARK_ACCENT_LIFT * 100); step++) {
    const l = l0 + step / 100;
    if (l > 1) break;
    const candidate = hslToHex(h, s, l);
    if (accentIsLegible(candidate, "dark")) return candidate;
  }
  return null;
}

// -- The write-door verdict ---------------------------------------------------

/** Why an accent cannot be stored. Each maps 1:1 to a `BRAND_*` refusal code in
 *  app/_lib/api-response.ts, so the door names the reason (and, for a legibility
 *  failure, WHICH THEME) instead of silently dropping the value to null. */
export type AccentRejection = "invalid" | "illegible-light" | "illegible-dark";

export type AccentVerdict =
  | { ok: true; accent: string | null; accentDark: string | null }
  | { ok: false; reason: AccentRejection };

/** The full accent decision for a WRITE: syntax, Studio Light legibility, and a
 *  derivable Spark Dark twin. Empty/absent is the product default and always ok. */
export function resolveAccent(value: unknown): AccentVerdict {
  const accent = sanitizeAccentColor(value);
  if (accent == null) {
    // Absent/empty is "use the product default"; anything else was a real attempt.
    const attempted = typeof value === "string" && value.trim() !== "";
    return attempted ? { ok: false, reason: "invalid" } : { ok: true, accent: null, accentDark: null };
  }
  if (!accentIsLegible(accent, "light")) return { ok: false, reason: "illegible-light" };
  const accentDark = deriveDarkAccent(accent);
  if (!accentDark) return { ok: false, reason: "illegible-dark" };
  return { ok: true, accent: normalizeHex6(accent) ?? accent, accentDark };
}

// ── Live-preview / render helpers ────────────────────────────────────────────
// Pure bits the editor + sidebar need. They live here (not in the .tsx) because
// `node --test` can't load a .tsx, so the fiddly rules stay unit-testable.

/** Expand a valid #rgb or #rrggbb to a canonical 6-digit `#rrggbb` (lowercased);
 *  null when it isn't a valid hex. The live preview fakes a translucent swatch by
 *  concatenating a two-char alpha suffix (`${hex}1a`) — on a 3-digit accent that
 *  yields an invalid 5-digit `#abc1a`, so normalize to 6 digits first. Also gives
 *  `<input type="color">` the 6-digit value it requires. */
export function normalizeHex6(value: string): string | null {
  const rgb = hexToRgb(value);
  if (!rgb) return null;
  return "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join("");
}

/** Whether to render an operator's external logo <img> at all (vs. the bundled
 *  default mark): only when a URL is set AND it hasn't errored at load. Shared by
 *  the sidebar header and the editor preview so their fallback rule can't drift. */
export function shouldRenderLogo(logoUrl: string | null | undefined, hasErrored: boolean): boolean {
  return Boolean(logoUrl && logoUrl.trim()) && !hasErrored;
}

/** Attributes every external-logo <img> must carry. The logo is arbitrary
 *  operator-supplied content on a third-party host, not a bundled asset:
 *  `referrerPolicy="no-referrer"` stops each viewer's browser leaking the current
 *  URL (Referer) to that host on every load. Deliberately NOT `crossOrigin` —
 *  forcing a CORS fetch would break display of logos on hosts that send no CORS
 *  headers; the IP/User-Agent reaching the host is inherent to browser-loading a
 *  remote image and can only be removed by proxying, out of scope here. */
export const EXTERNAL_LOGO_IMG_ATTRS = { referrerPolicy: "no-referrer" } as const;

/** The three editable brand fields, as raw editor strings. */
export type BrandFormValues = { name: string; accent: string; logo: string };

/** Whether the editor diverges from the last loaded/saved baseline — the single
 *  source of truth behind BOTH the Save-enabled state and the unsaved-changes
 *  navigation guard (so the two can't disagree). Trimmed, so a pure-whitespace edit
 *  isn't "dirty" (the store would trim it away anyway). */
export function isBrandFormDirty(current: BrandFormValues, baseline: BrandFormValues): boolean {
  return (
    current.name.trim() !== baseline.name.trim() ||
    current.accent.trim() !== baseline.accent.trim() ||
    current.logo.trim() !== baseline.logo.trim()
  );
}

/** Collapse whitespace, clamp, empty → null. */
export function sanitizeBrandName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.replace(/\s+/g, " ").trim().slice(0, MAX_BRAND_NAME);
  return v || null;
}

/** Longest storable logo URL. Comfortably past any sane CDN path, and a hard
 *  REJECT threshold — never a truncation point (see below). */
export const MAX_LOGO_URL = 500;

/** An `https://` URL, else null — blocks `javascript:` / `data:` / other
 *  schemes from reaching an <img src>. The logo is browser-loaded, so self-host /
 *  air-gapped installs should host it on their own origin.
 *
 *  Over-length is REJECTED, not clamped. This used to `slice(0, 500)`, which turns a
 *  600-char signed CDN URL (`…?X-Amz-Signature=…`) into a 500-char PREFIX: still a
 *  syntactically valid https URL, so it stored and round-tripped happily while the
 *  image 403s forever — and the editor reported a green "Saved" over a logo that can
 *  never load, with no signal anywhere about why. A rejection returns null, which the
 *  editor DOES render (the field comes back empty), so the refusal is visible. */
export function sanitizeLogoUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:") return null;
    return u.href.length > MAX_LOGO_URL ? null : u.href;
  } catch {
    return null;
  }
}

/** Coerce an arbitrary input object to a stored BrandConfig (each field validated). */
export function sanitizeBrand(input: unknown): BrandConfig {
  const o = (input ?? {}) as Record<string, unknown>;
  // The read path stays FAIL-SAFE (drop to the product default), not a refusal:
  // getBrand() re-validates every row on the way out and a stored value that
  // predates a rule must degrade, never throw. The WRITE path (resolveAccent, via
  // /api/brand) is where a bad value earns a coded refusal instead.
  const verdict = resolveAccent(o.accentColor);
  return {
    displayName: sanitizeBrandName(o.displayName),
    // A valid hex that is illegible as an accent (invisible white-on-accent text
    // and focus rings — WCAG 1.4.3 / 2.4.7) is dropped to null at the store
    // boundary, so it can never persist even via a direct API call. The editor
    // (BrandingTab) pre-checks and explains, rather than silently dropping it.
    accentColor: verdict.ok ? verdict.accent : null,
    // DERIVED, never read from the input: the dark twin is a function of the light
    // accent, so it cannot drift from it and an API caller cannot inject one.
    accentDark: verdict.ok ? verdict.accentDark : null,
    logoUrl: sanitizeLogoUrl(o.logoUrl),
  };
}
