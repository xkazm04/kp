// MPSV open data — the Czech labour office's vacancy file (tier A, CC-BY-like open
// data at data.mpsv.cz). The full file is ~184 MB of JSON; it is read as a STREAM
// (jsonArrayStream.ts) and filtered locally against the seeker's titles/locations,
// capped at `maxRefs`. Nothing is buffered beyond one element.
//
// URL: `config.url` when set, else the full daily file. data.mpsv.cz also publishes
// daily delta files ("Přírůstky volných míst") that would make a 12-hourly scan far
// cheaper; their exact URL could not be confirmed offline while this was written, so
// an owner who knows it sets `config.url` and the adapter reads it the same way (the
// item shape is identical). Documented in docs/features/jobseeker/README.md.

import type { RawPosting } from "../types";
import { readJsonArrayStream } from "./jsonArrayStream";
import { cfg, isoOrNull, matchesLocations, matchesTargets, mustOk, rawPosting, str, workModeFromText } from "./shared";
import { AdapterCollapsed, type PostingRef, type SourceAdapter } from "./types";

export const MPSV_FULL_URL = "https://data.mpsv.cz/od/soubory/volna-mista/volna-mista.json";
const MPSV_DETAIL_URL = "https://www.uradprace.cz/web/cz/volna-mista-v-cr#/volne-misto/";

type Item = Record<string, unknown>;

/** The file's records are Czech-keyed; read the few we use defensively — the open
 *  data schema evolves and a missing field must degrade a posting, not the run. */
export function mpsvItemToRaw(item: Item): RawPosting | null {
  const id = str(item.referencniCislo) ?? str(item.id) ?? str(item.portalId);
  const profese = item.profese as Record<string, unknown> | undefined;
  const title = str(item.nazev) ?? str(profese?.nazev) ?? str(item.pozice);
  if (!id || !title) return null;
  const firma = item.zamestnavatel as Record<string, unknown> | undefined;
  const misto = item.mistoVykonuPrace as Record<string, unknown> | undefined;
  const obec = misto?.obec as Record<string, unknown> | undefined;
  const mzda = item.mzda as Record<string, unknown> | undefined;
  const mzdaMin = typeof mzda?.min === "number" ? mzda.min : null;
  const mzdaMax = typeof mzda?.max === "number" ? mzda.max : null;
  const body = [str(item.popis), str(item.poznamka), str(item.pozadavky), str(item.vyhody)].filter(Boolean).join("\n");
  return rawPosting({
    externalKey: id,
    url: str(item.url) ?? `${MPSV_DETAIL_URL}${encodeURIComponent(id)}`,
    title,
    company: str(firma?.nazev),
    location: str(obec?.nazev) ?? str(misto?.obec) ?? str(misto?.nazev),
    country: "cz",
    workMode: workModeFromText(`${title} ${body.slice(0, 4000)}`),
    postedAt: isoOrNull(item.datumZverejneni) ?? isoOrNull(item.datumVlozeni),
    salaryText: mzdaMin !== null || mzdaMax !== null ? `${mzdaMin ?? ""}–${mzdaMax ?? ""} Kč` : null,
    salary: mzdaMin !== null || mzdaMax !== null ? { min: mzdaMin, max: mzdaMax, currency: "CZK", period: "month" } : null,
    bodyText: body,
    lang: "cs",
  });
}

export const mpsvBulkAdapter: SourceAdapter = {
  name: "mpsv_bulk",
  detailFetches: false,
  async *discover(ctx) {
    const url = cfg(ctx.source, "url") ?? MPSV_FULL_URL;
    const out = mustOk(await ctx.fetch(url, { sourceId: ctx.source.id, accept: "application/json", stream: true }));
    if (!out.stream) throw new AdapterCollapsed("shape_changed", "MPSV bulk file returned no body stream");
    let yielded = 0;
    let scanned = 0;
    // The root is an object in the published file (`{"polozky":[...]}`) in some
    // revisions and a bare array in others; `arrayKey` handles the former, and a bare
    // array simply never matches the key seek — so try the array first, then the key.
    const arrayKey = cfg(ctx.source, "arrayKey");
    for await (const item of readJsonArrayStream(out.stream, { arrayKey: arrayKey ?? null })) {
      scanned++;
      if (!item || typeof item !== "object") continue;
      const raw = mpsvItemToRaw(item as Item);
      if (!raw) continue;
      if (!matchesTargets(raw.title, ctx.preferences)) continue;
      if (!matchesLocations(raw.location, ctx.preferences)) continue;
      yield { externalKey: raw.externalKey, url: raw.url, hint: raw } satisfies PostingRef;
      if (++yielded >= ctx.limits.maxRefs) break;
    }
    ctx.log({ level: "info", code: "mpsv_scanned", detail: `${scanned} records read, ${yielded} kept` });
    if (scanned === 0) throw new AdapterCollapsed("shape_changed", "MPSV bulk file yielded no records");
  },
  async detail(ref) {
    const hint = ref.hint;
    if (!hint || !hint.title) return null;
    return rawPosting({ ...hint, externalKey: ref.externalKey, url: ref.url, title: hint.title });
  },
};
