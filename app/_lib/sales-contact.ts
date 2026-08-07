// Sales contact for the Enterprise (contact-sales) tier — the one plan that is
// custom-priced and negotiated rather than self-served. Configurable per deploy
// via NEXT_PUBLIC_SALES_EMAIL (the only prefix Next.js exposes to the client
// bundle, so both the landing band and the in-app Billing tab can read it). The
// placeholder fallback keeps the CTA from dead-ending — a working mailto beats
// the current "Talk to sales → /login password box" gap (UAT EB-H1-02 / M10) —
// but SHOULD be overridden per deploy with your real sales address.
export const SALES_EMAIL = process.env.NEXT_PUBLIC_SALES_EMAIL?.trim() || "sales@kandidate.app";

/** A `mailto:` for the Enterprise contact-sales path, with a prefilled subject so
 *  the reply lands in the right place. Used by the landing enterprise band and the
 *  Billing tab's Enterprise card. */
export function salesContactHref(subject = "Enterprise plan enquiry"): string {
  return `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(subject)}`;
}
