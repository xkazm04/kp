import type { useTranslations } from "next-intl";
import type { CatalogEntry, SourceRow } from "../logic/wire";

// What a wire row reads off its source and its catalog entry: the adapter's name in the
// reader's language, the job categories it narrows to, and the rest of its config as short
// readable pairs. Shared by the rows (WireRow.tsx, WireDetail.tsx) and the add popover
// (AddWire.tsx).

export type Translate = ReturnType<typeof useTranslations<"gigs">>;
export type Key = Parameters<Translate>[0];

export function adapterLabel(t: Translate, entry: CatalogEntry | null, adapter: string): string {
  const key = `adapter.${adapter}` as Key;
  return t.has(key) ? t(key) : (entry?.label ?? adapter);
}

/** The job categories a Freelancer-style source narrows to, when its config names them. */
export function jobsOf(source: SourceRow): string[] | null {
  const jobs = source.config?.jobs;
  return Array.isArray(jobs) ? jobs.map(String) : null;
}

/** Config other than the job categories, as short readable pairs (never a secret: the
 *  store holds none in config). */
export function otherConfig(source: SourceRow): [string, string][] {
  return Object.entries(source.config ?? {})
    .filter(([k]) => k !== "jobs")
    .map(([k, v]) => {
      const text = typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : Array.isArray(v) ? v.map(String).join(", ") : JSON.stringify(v);
      return [k, text.length > 80 ? `${text.slice(0, 79)}…` : text] as [string, string];
    });
}
