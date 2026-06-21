// Single source of the role-family vocabulary on the TS side. Mirrors the Python
// taxonomy (data/taxonomy.json::role_families + data/salary_benchmarks.json families)
// — keep the two in lockstep when adding a family. Human-facing labels are served
// via i18n `enums.family.<slug>` (useEnumLabel), which falls back to labelize();
// ROLE_FAMILY_LABELS is the non-i18n English fallback for the rare module-level use.
//
// Opened beyond the original 3 IT families (idea P0-1) so non-tech workforces —
// healthcare, trades, frontline service, finance, etc. — are representable instead
// of collapsing to software_engineering.
export const ROLE_FAMILY_SLUGS = [
  "software_engineering",
  "data_ai",
  "product_project",
  "healthcare_clinical",
  "life_sciences_research",
  "skilled_trades",
  "operations_logistics",
  "frontline_service",
  "sales_marketing",
  "finance_accounting",
  "legal_compliance",
  "hr_people",
  "education_academic",
  "creative_design",
  "customer_support",
  "general_professional",
] as const;

export type RoleFamilySlug = (typeof ROLE_FAMILY_SLUGS)[number];

export const ROLE_FAMILY_LABELS: Record<string, string> = {
  software_engineering: "Software",
  data_ai: "Data / AI",
  product_project: "Product / Project",
  healthcare_clinical: "Healthcare / Clinical",
  life_sciences_research: "Science / Research",
  skilled_trades: "Skilled Trades",
  operations_logistics: "Operations / Logistics",
  frontline_service: "Frontline / Service",
  sales_marketing: "Sales / Marketing",
  finance_accounting: "Finance / Accounting",
  legal_compliance: "Legal / Compliance",
  hr_people: "HR / People",
  education_academic: "Education / Academic",
  creative_design: "Creative / Design",
  customer_support: "Customer Support",
  general_professional: "General / Professional",
};

// The neutral fallback when no family is detected — matches the Python
// DEFAULT_FAMILY (salary_benchmarks.json::default_family). Never assume software.
export const DEFAULT_ROLE_FAMILY: RoleFamilySlug = "general_professional";
