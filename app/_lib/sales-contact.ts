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
 *  Billing tab's Enterprise card.
 *
 *  `subject` is REQUIRED and comes from the caller's translator
 *  (`t("salesEnquirySubject")`, the `common` namespace) — it is the one string on
 *  this path that a human reads, and it used to be an English default baked in
 *  here. A default is the wrong shape for it twice over: this module is imported
 *  by client components in a four-locale app, so a default silently ships English
 *  to a Czech recruiter's mail client; and nothing in `_lib` can reach a
 *  translator, so the default could never have been anything else. Making the
 *  parameter required moves the decision to the only layer that knows the reader's
 *  language, and makes a forgotten one a tsc error rather than an English subject
 *  line nobody notices. */
export function salesContactHref(subject: string): string {
  return `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(subject)}`;
}
