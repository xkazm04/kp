// White-label brand configuration (E3 / E-BRD, docs/ENTERPRISE_READINESS.md §4).
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
  return {
    displayName: sanitizeBrandName(o.displayName),
    accentColor: sanitizeAccentColor(o.accentColor),
    logoUrl: sanitizeLogoUrl(o.logoUrl),
  };
}
