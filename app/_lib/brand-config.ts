// White-label brand configuration (E3 / E-BRD, docs/product/enterprise-readiness.md §4).
// (Distinct from app/_lib/brand.ts, which is the fixed design-system color palette.)
//
// Single-workspace today — like billing_state (id='workspace'); a workspace key gets
// added for multi-tenancy when E0 lands. Pure module (client + server): all
// validation lives here so the API, the store, and the editor agree on what's
// storable — and, crucially, so the accent color that gets injected into a
// server-rendered <style> is STRICTLY hex-validated (an unvalidated color would be a
// CSS-injection vector — see app/_components/BrandStyle.tsx).

export type BrandConfig = {
  /** White-label display name (sidebar + document title). null = product default. */
  displayName: string | null;
  /** Primary accent as hex — overrides the --color-coral token in both themes. */
  accentColor: string | null;
  /** https:// URL to the customer's logo. null = product default. */
  logoUrl: string | null;
};

export const DEFAULT_BRAND: BrandConfig = { displayName: null, accentColor: null, logoUrl: null };

export const MAX_BRAND_NAME = 60;

// #rgb or #rrggbb only — anything else is rejected before it can reach a <style>.
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

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

/** The paper canvas the focus ring / active-nav indicator is drawn against
 *  (app/globals.css `--color-paper`, light theme — the demanding case: it is far
 *  lighter than the dark theme's paper, so a pale accent contrasts least here). */
const PAPER_BG = "#fdf8ee";
/** The fixed color that sits ON the accent: white button labels (BTN_PRIMARY) and
 *  the focus ring's inner ply (`--color-paper`, ~white). White is the worst case. */
const ON_ACCENT_TEXT = "#ffffff";

/** WCAG AA for large/bold text and for non-text graphical objects is 3:1 — the
 *  right bar here: button labels are medium-weight UI text and the focus ring is a
 *  graphical indicator. 4.5:1 (AA normal text) would reject the product's OWN
 *  default coral (~3.9:1 on white / ~3.7:1 on paper), so 3:1 is the coherent line. */
export const MIN_ACCENT_CONTRAST = 3;

/** #rgb | #rrggbb → [r,g,b] (0–255), or null when not a valid hex. */
function hexToRgb(hex: string): [number, number, number] | null {
  const v = hex.trim().toLowerCase();
  if (!HEX_COLOR.test(v)) return null;
  const h = v.slice(1);
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

/** sRGB relative luminance (WCAG 2.x): 0 = black … 1 = white. */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio (1 … 21) between two hex colors; NaN if either is not a
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

/** True when a hex accent is legible: white text ON it AND the accent as a focus
 *  ring against the paper canvas both clear MIN_ACCENT_CONTRAST. null/empty (the
 *  product default) is always legible; an invalid hex is not. */
export function accentIsLegible(hex: string | null | undefined): boolean {
  if (hex == null || hex.trim() === "") return true;
  if (hexToRgb(hex) == null) return false;
  return (
    contrastRatio(hex, ON_ACCENT_TEXT) >= MIN_ACCENT_CONTRAST &&
    contrastRatio(hex, PAPER_BG) >= MIN_ACCENT_CONTRAST
  );
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

/** An `https://` URL (clamped), else null — blocks `javascript:` / `data:` / other
 *  schemes from reaching an <img src>. The logo is browser-loaded, so self-host /
 *  air-gapped installs should host it on their own origin. */
export function sanitizeLogoUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.href.slice(0, 500) : null;
  } catch {
    return null;
  }
}

/** Coerce an arbitrary input object to a stored BrandConfig (each field validated). */
export function sanitizeBrand(input: unknown): BrandConfig {
  const o = (input ?? {}) as Record<string, unknown>;
  const accent = sanitizeAccentColor(o.accentColor);
  return {
    displayName: sanitizeBrandName(o.displayName),
    // A valid hex that is illegible as an accent (invisible white-on-accent text
    // and focus rings — WCAG 1.4.3 / 2.4.7) is dropped to null at the store
    // boundary, so it can never persist even via a direct API call. The editor
    // (BrandingTab) pre-checks and explains, rather than silently dropping it.
    accentColor: accent && accentIsLegible(accent) ? accent : null,
    logoUrl: sanitizeLogoUrl(o.logoUrl),
  };
}
