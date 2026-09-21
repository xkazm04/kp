// The typed view of sources-catalog.json — the research record behind the three
// tiers. The API serves it so the Sources page can show WHY a board is A, B or C,
// quote the clause the owner acknowledges, and carry `termsHash` so an edited
// summary re-asks the acknowledgement (JobseekerSource.acknowledgedTermsHash).

import { createHash } from "node:crypto";
import catalogJson from "./sources-catalog.json";
import { isSourceAdapterName, SOURCE_KINDS, SOURCE_TIERS, type SourceAdapterName, type SourceKind, type SourceTier } from "./types";

export type CatalogEntry = {
  id: string;
  host: string;
  tier: SourceTier;
  adapter: SourceAdapterName;
  kind: SourceKind;
  label: string;
  robotsSummary: string;
  termsQuote: string;
  termsUrl: string;
  termsHash: string;
  cadenceNote: string;
  refusedReason: string | null;
  needsCompanyConfig: boolean;
  defaultConfig: Record<string, unknown>;
  attribution: string | null;
  checkedOn: string;
};

export function termsHashOf(quote: string): string {
  return createHash("sha256").update(quote, "utf8").digest("hex");
}

type RawEntry = Record<string, unknown>;

function entryFrom(raw: RawEntry): CatalogEntry | null {
  const tier = raw.tier;
  const kind = raw.kind;
  if (typeof raw.id !== "string" || typeof raw.host !== "string" || typeof raw.termsQuote !== "string") return null;
  if (!(SOURCE_TIERS as readonly unknown[]).includes(tier) || !(SOURCE_KINDS as readonly unknown[]).includes(kind) || !isSourceAdapterName(raw.adapter)) return null;
  return {
    id: raw.id,
    host: raw.host.toLowerCase(),
    tier: tier as SourceTier,
    adapter: raw.adapter,
    kind: kind as SourceKind,
    label: typeof raw.label === "string" ? raw.label : raw.id,
    robotsSummary: typeof raw.robotsSummary === "string" ? raw.robotsSummary : "",
    termsQuote: raw.termsQuote,
    termsUrl: typeof raw.termsUrl === "string" ? raw.termsUrl : "",
    termsHash: termsHashOf(raw.termsQuote),
    cadenceNote: typeof raw.cadenceNote === "string" ? raw.cadenceNote : "",
    refusedReason: typeof raw.refusedReason === "string" ? raw.refusedReason : null,
    needsCompanyConfig: raw.needsCompanyConfig === true,
    defaultConfig: raw.defaultConfig && typeof raw.defaultConfig === "object" ? (raw.defaultConfig as Record<string, unknown>) : {},
    attribution: typeof raw.attribution === "string" ? raw.attribution : null,
    checkedOn: typeof raw.checkedOn === "string" ? raw.checkedOn : "",
  };
}

const ENTRIES: CatalogEntry[] = ((catalogJson as { entries: RawEntry[] }).entries ?? []).map(entryFrom).filter((e): e is CatalogEntry => e !== null);

export function sourcesCatalog(): CatalogEntry[] {
  return ENTRIES;
}

export function catalogEntry(id: string): CatalogEntry | null {
  return ENTRIES.find((e) => e.id === id) ?? null;
}

/** The entry whose host matches (exact, or a parent domain for per-company ATS hosts). */
export function catalogEntryForHost(host: string): CatalogEntry | null {
  const h = host.trim().toLowerCase();
  return ENTRIES.find((e) => e.host === h) ?? ENTRIES.find((e) => h.endsWith(`.${e.host}`)) ?? null;
}

/** The terms hash a source must have acknowledged to be enabled. A host outside the
 *  catalog has no quoted clause, so its hash is derived from the host itself — the
 *  acknowledgement then says "I checked this board's terms myself". */
export function termsHashForSource(source: { host: string; adapter: SourceAdapterName }): string {
  const entry = catalogEntryForHost(source.host);
  return entry ? entry.termsHash : termsHashOf(`uncatalogued:${source.host}`);
}

/** Tier for a host: the catalog's when known, else B — an unknown board's terms
 *  have not been read, and "not read" is exactly what the acknowledgement is for. */
export function tierForHost(host: string): SourceTier {
  return catalogEntryForHost(host)?.tier ?? "B";
}
