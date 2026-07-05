/*
 * Typed access to the committed Market Pulse snapshot + the Czech-regions map
 * geometry, plus the pure formatting/heat helpers both variants share. The data
 * is produced by scripts/build-market-pulse.mjs from the Pumper `mpsv-vpm` /
 * `mpsv-ispv` datasets; this module is the single seam the page reads it through.
 */
import snapshotJson from "@/data/market_pulse.json";
import geoJson from "@/data/cz-regions.json";
import { LIMEWASH, AMBER, CORAL, MOSS } from "../tokens";

/** The 16 taxonomy role-family keys — a literal union so `families.${FamilyKey}`
 *  resolves against the typed `jobMarket` i18n namespace (next-intl needs this). */
export type FamilyKey =
  | "software_engineering"
  | "data_ai"
  | "product_project"
  | "healthcare_clinical"
  | "life_sciences_research"
  | "skilled_trades"
  | "operations_logistics"
  | "frontline_service"
  | "sales_marketing"
  | "finance_accounting"
  | "legal_compliance"
  | "hr_people"
  | "education_academic"
  | "creative_design"
  | "customer_support"
  | "general_professional";
export type OrgKey = "private" | "public" | "agency";

export interface RefSalary {
  family: FamilyKey;
  label: string;
  p10: number | null;
  junior: number | null;
  medior: number | null;
  senior: number | null;
  lead: number | null;
  median: number | null;
  employees_k: number;
  occupations: number;
}
export interface Region {
  krajId: string;
  code: string;
  name: string;
  vacancies: number;
  medianSalary: number | null;
  p25: number | null;
  p75: number | null;
}
export interface OrgType {
  orgType: OrgKey;
  label: string;
  vacancies: number;
  medianSalary: number | null;
  p25: number | null;
  p75: number | null;
}
export interface FamilyDemand {
  family: FamilyKey;
  label: string;
  vacancies: number;
  share: number;
  momentum: number | null;
}
export interface Occupation {
  czIsco: string;
  name: string;
  family: FamilyKey;
  vacancies: number;
  medianSalary: number | null;
}
export interface JdItem {
  title: string;
  occupation: string | null;
  employer: string | null;
  orgType: OrgKey;
  region: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  posted: string | null;
  skills: string[];
}
export interface JdGroup {
  family: FamilyKey;
  label: string;
  items: JdItem[];
}
export interface Meta {
  generated_at: string;
  currency: string;
  salary_basis: string;
  total_vacancies: number;
  occupations_tracked: number;
  regions: number;
  national_median: number | null;
  ispv_period: string | null;
  vacancies_date: string | null;
  median_posting_age_days: number | null;
  posted_within_90d_pct: number | null;
  posted_within_180d_pct: number | null;
  relics_filtered: number;
  source: string;
  license: string;
  attribution: string;
  attribution_url: string;
  coverage_note: string;
}
export interface Snapshot {
  meta: Meta;
  reference_salaries: RefSalary[];
  regions: Region[];
  org_types: OrgType[];
  demand: { national_total: number; top_families: FamilyDemand[]; top_occupations: Occupation[] };
  jd_references: JdGroup[];
}
export interface GeoRegion {
  name: string;
  d: string;
  cx: number;
  cy: number;
}
export interface Geo {
  viewBox: string;
  regions: Record<string, GeoRegion>;
}

export const snapshot = snapshotJson as unknown as Snapshot;
export const geo = geoJson as unknown as Geo;

/** The 16 role families in taxonomy order (used to colour-key demand + salary). */
export const FAMILY_ORDER = snapshot.reference_salaries.map((r) => r.family);

// ── formatting ───────────────────────────────────────────────────────────────
const NBSP = " "; // Czech convention: space as the thousands separator.
export function fmtInt(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}
export function fmtCzk(n: number | null | undefined): string {
  return n == null ? "—" : `${fmtInt(n)}${NBSP}Kč`;
}
/** ISO `YYYY-MM-DD` → Czech-style `D. M. YYYY` (e.g. "1. 6. 2026"). */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${Number(d)}. ${Number(m)}. ${y}`;
}

/** Compact money for tight chips: 28 600 → "28,6 tis.". */
export function fmtCzkShort(n: number | null | undefined): string {
  if (n == null) return "—";
  const k = n / 1000;
  const s = k >= 100 ? Math.round(k).toString() : k.toFixed(1).replace(".", ",").replace(",0", "");
  return `${s}${NBSP}tis.`;
}

// ── heat scale (pale limewash → amber → coral), on-brand ─────────────────────
function hexToRgb(h: string): [number, number, number] {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
/** t in [0,1] → colour along the limewash→amber→coral ramp. */
export function heatColor(t: number): string {
  const stops = [LIMEWASH, AMBER, CORAL].map(hexToRgb);
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const [r1, g1, b1] = stops[i];
  const [r2, g2, b2] = stops[i + 1];
  return rgbToHex(lerp(r1, r2, f), lerp(g1, g2, f), lerp(b1, b2, f));
}
/** Cool salary ramp: pale → moss (green = higher pay). */
export function salaryColor(t: number): string {
  const [r1, g1, b1] = hexToRgb("#eef3e6");
  const [r2, g2, b2] = hexToRgb(MOSS);
  const x = Math.max(0, Math.min(1, t));
  return rgbToHex(lerp(r1, r2, x), lerp(g1, g2, x), lerp(b1, b2, x));
}

export type MapMetric = "volume" | "salary";

/** Normalise a region's chosen metric to [0,1] across all regions. */
export function regionScale(regions: Region[], metric: MapMetric) {
  const vals = regions
    .map((r) => (metric === "volume" ? r.vacancies : r.medianSalary))
    .filter((v): v is number => v != null);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return (r: Region) => {
    const v = metric === "volume" ? r.vacancies : r.medianSalary;
    if (v == null || max === min) return 0.5;
    return (v - min) / (max - min);
  };
}
