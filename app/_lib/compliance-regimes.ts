// P1-1 — the compliance JURISDICTION catalog. The product was framed
// mono-jurisdiction (GDPR / EU AI Act only); a recruiter outside the EU saw
// EU-specific language and no acknowledgement of their own regime. This pure,
// dependency-free module names, per jurisdiction, the legal hooks the app's
// existing guarantees map onto — so the candidate disclosure and the recruiter
// compliance posture can speak the right framework. The ACTIVE regime is a
// workspace setting (decision-config "compliance" phase); this module is just the
// reference data + normalization, so it imports nothing and is safe in the
// browser bundle, on the server, and under `node --test`.
//
// IMPORTANT — these are FRAMING references, not legal advice and not a claim of
// certified conformance. The law names are proper nouns (identical across cs/en),
// so they live here as plain strings; the connecting prose is i18n-templated at
// the render sites with these values interpolated in.

export const REGIME_IDS = ["eu", "uk", "us", "sg", "in", "ae", "global"] as const;
export type RegimeId = (typeof REGIME_IDS)[number];

export type ComplianceRegime = {
  id: RegimeId;
  /** The data-protection law candidate PII is processed under. */
  dataLaw: string;
  /** The legal hook for the human-in-the-loop / no-solely-automated-decision
   *  guarantee the app already enforces (screen-wave approval, human decisions). */
  oversightBasis: string;
  /** The equal-opportunity / anti-discrimination framework the jurisdiction
   *  assesses hiring against. */
  antiDiscrimination: string;
  /** The named statutory adverse-impact test, where the jurisdiction has a fixed
   *  one (US: the EEOC four-fifths rule). null where there is no single codified
   *  ratio — the {@link computeAdverseImpact} primitive still applies, but no
   *  jurisdiction-specific threshold is asserted. */
  adverseImpactStandard: string | null;
};

// Kept deliberately concise and accurate: each row names the primary instrument,
// not an exhaustive citation list. "global" is the honest fallback for a
// workspace that spans jurisdictions or hasn't picked one.
export const COMPLIANCE_REGIMES: Record<RegimeId, ComplianceRegime> = {
  eu: {
    id: "eu",
    dataLaw: "GDPR",
    oversightBasis: "EU AI Act Art. 14 + GDPR Art. 22",
    antiDiscrimination: "EU equal-treatment directives",
    adverseImpactStandard: null,
  },
  uk: {
    id: "uk",
    dataLaw: "UK GDPR / Data Protection Act 2018",
    oversightBasis: "UK GDPR Art. 22",
    antiDiscrimination: "Equality Act 2010",
    adverseImpactStandard: null,
  },
  us: {
    id: "us",
    dataLaw: "US state privacy laws (CCPA et al.) + FCRA",
    oversightBasis: "EEOC guidance on automated employment-decision tools",
    antiDiscrimination: "Title VII / ADEA / ADA (EEOC); OFCCP for federal contractors",
    adverseImpactStandard: "Four-fifths (80%) rule",
  },
  sg: {
    id: "sg",
    dataLaw: "PDPA",
    oversightBasis: "MOM / TAFEP fair-employment guidelines",
    antiDiscrimination: "TAFEP fair-employment principles; MAS guidance (financial sector)",
    adverseImpactStandard: null,
  },
  in: {
    id: "in",
    dataLaw: "DPDP Act 2023",
    oversightBasis: "DPDP Act (notice + consent)",
    antiDiscrimination: "Constitutional equal-opportunity provisions",
    adverseImpactStandard: null,
  },
  ae: {
    id: "ae",
    dataLaw: "UAE PDPL (Federal Decree-Law 45/2021)",
    oversightBasis: "UAE PDPL automated-processing provisions",
    antiDiscrimination: "MoHRE anti-discrimination provisions",
    adverseImpactStandard: null,
  },
  global: {
    id: "global",
    dataLaw: "applicable local data-protection law",
    oversightBasis: "human-in-the-loop review (no solely-automated adverse decision)",
    antiDiscrimination: "applicable equal-opportunity law",
    adverseImpactStandard: null,
  },
};

/** The default jurisdiction. "eu" preserves the app's pre-P1-1 behaviour exactly
 *  (GDPR framing), so an unconfigured workspace is unchanged. */
export const DEFAULT_REGIME_ID: RegimeId = "eu";

/** Coerce any stored / posted value to a known RegimeId, defaulting unknown or
 *  malformed input to {@link DEFAULT_REGIME_ID}. Used at every read boundary so a
 *  stale or hand-edited config can never surface an undefined regime. */
export function normalizeRegimeId(value: unknown): RegimeId {
  return typeof value === "string" && (REGIME_IDS as readonly string[]).includes(value)
    ? (value as RegimeId)
    : DEFAULT_REGIME_ID;
}

/** The full regime record for a (possibly untrusted) id, normalized first. */
export function getRegime(id: unknown): ComplianceRegime {
  return COMPLIANCE_REGIMES[normalizeRegimeId(id)];
}
