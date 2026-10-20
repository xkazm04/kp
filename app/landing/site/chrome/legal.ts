/** The product's policy pages, linked from every public front door (the same
 *  three LegalRow renders on /privacy, /terms, /trust, /market). Labels are
 *  landing.footer.<key>. */
export const LEGAL_LINKS = [
  { href: "/privacy", key: "privacy" },
  { href: "/terms", key: "terms" },
  { href: "/trust", key: "trust" }
] as const;
