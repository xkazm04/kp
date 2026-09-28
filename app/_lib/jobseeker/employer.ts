// The employer a posting names - or null when the ad names a placeholder instead.
//
// Public-employment feeds let an advertiser leave the employer out, and some type a stand-in
// where the name goes: on the live run of 2026-09-28 the best-matching posting of all read
// "AI Engineer (w/m/d) at siehe Beschreibung" ("see the description"). Shown, it is a fake
// employer; folded, it is worse - the sieve treats same source + title + employer as one job
// (sieveModel.twinKey), so two different employers' "AI Engineer" ads both saying "siehe
// Beschreibung" read as one. A stand-in is no employer: null, which the UI already states
// as absent and the twin fold never merges.
//
// Pure and import-free: the adapters call it on the way in and the store on the way out
// (rows written before it existed keep their stand-in in the column).

/** Stand-ins, folded (lower case, one space, no surrounding punctuation), in the markets'
 *  languages - de, en, cs, fr, nl, pl. */
const STAND_INS = new Set([
  "siehe beschreibung", "siehe stellenbeschreibung", "siehe stellenanzeige", "siehe anzeige", "siehe unten", "siehe text",
  "keine angabe", "k. a", "k.a", "nicht angegeben", "anonym", "vertraulich",
  "see description", "see job description", "see below", "see ad", "see advert", "confidential", "company confidential",
  "anonymous", "undisclosed", "not specified", "not disclosed", "n/a", "na",
  "viz popis", "viz inzerát", "viz níže", "neuvedeno", "anonymní", "důvěrné",
  "voir description", "voir la description", "voir ci-dessous", "confidentiel", "anonyme", "non précisé", "non communiqué",
  "zie beschrijving", "zie omschrijving", "vertrouwelijk", "anoniem",
  "patrz opis", "zobacz opis", "poufne", "anonimowy",
]);

function fold(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—(["'„“»«]+|[\s\-–—)\]"'“”»«.:!]+$/gu, "");
}

/** The employer as the ad names it, trimmed; null when it names none or a stand-in. */
export function employerName(name: string | null | undefined): string | null {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return null;
  return STAND_INS.has(fold(trimmed)) ? null : trimmed;
}
