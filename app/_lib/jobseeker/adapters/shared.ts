// Helpers every adapter reaches for: fetch-outcome handling, JSON bodies, text
// cleanup, the RawPosting factory, and the preference filter feeds apply locally.

import { htmlToText } from "../../job-posting-fetch";
import { targetForms } from "../targetAliases";
import type { FetchOk, FetchOutcome } from "../fetch/politeFetch";
import { isWorkMode, type JobseekerPreferences, type RawPosting } from "../types";
import { FetchHalt, type AdapterContext } from "./types";

/** A listing/index fetch the run cannot continue without: anything but `ok` halts. */
export function mustOk(outcome: FetchOutcome): FetchOk {
  if (outcome.kind !== "ok") throw new FetchHalt(outcome);
  return outcome;
}

/** A detail fetch: `blocked`/`offline` halt the source (a denial anywhere is a
 *  denial), while `gone`/`outage`/`robots_disallowed` skip just this posting. An
 *  outage also marks the pass incomplete: the posting was not read, which is not
 *  evidence that it is gone (a 404/410 is). */
export function detailOk(outcome: FetchOutcome, ctx: AdapterContext, url: string): FetchOk | null {
  if (outcome.kind === "ok") return outcome;
  if (outcome.kind === "blocked" || outcome.kind === "offline") throw new FetchHalt(outcome);
  if (outcome.kind === "outage") ctx.incomplete?.(`detail_outage: ${url}`);
  ctx.log({ level: "warn", code: `detail_${outcome.kind}`, detail: `${url}: ${outcome.detail}` });
  return null;
}

export function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null; /* not JSON — the caller treats it as a shape change */
  }
}

export function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** HTML (or entity-escaped HTML, as Greenhouse ships it) → the advertisement text. */
export function bodyFromHtml(html: string | null): string {
  if (!html) return "";
  // Greenhouse returns the content entity-escaped; one decode pass turns it into markup.
  const unescaped = /&lt;\w+/.test(html) && !/<\w+/.test(html) ? html.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&") : html;
  return htmlToText(unescaped).slice(0, 60_000);
}

export function isoOrNull(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  if (typeof v !== "string" || !v.trim()) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// `\b` is ASCII-only in JavaScript, so Czech/French inflections need the Unicode
// letter class for their boundaries ("hybridní režim" must match).
const REMOTE_RE = /(?<!\p{L})(remote|fully remote|home ?office|z domova|na dálku|práce z domu|télétravail|100% remote)(?!\p{L})/iu;
const HYBRID_RE = /(?<!\p{L})(hybrid\p{L}*|hybride)(?!\p{L})/iu;

/** Work mode from free text — only when the text SAYS it; null is "did not say". */
export function workModeFromText(text: string | null): RawPosting["workMode"] {
  if (!text) return null;
  if (HYBRID_RE.test(text)) return "hybrid";
  if (REMOTE_RE.test(text)) return "remote";
  return null;
}

export function rawPosting(partial: Partial<RawPosting> & Pick<RawPosting, "externalKey" | "url" | "title">): RawPosting {
  return {
    company: null,
    location: null,
    country: null,
    postedAt: null,
    salaryText: null,
    salary: null,
    bodyText: "",
    jsonld: null,
    lang: null,
    ...partial,
    workMode: isWorkMode(partial.workMode) ? partial.workMode : null,
  };
}

/** Case/diacritic-insensitive substring test used by the local preference filters. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// The two local filters below are HARD acquisition filters: a posting they drop is
// never stored, never scored. So they must never be stricter than the matcher
// downstream (pipeline/jobfit/matching.py), which ranks. When in doubt, let it through.

/** A folded title as space-delimited whole words, padded so a needle matches only on
 *  word boundaries ("java" is in "Java programátor", not in "JavaScript"). `+` and `#`
 *  stay inside a word so "C++" and "C#" survive. */
function wordsOf(s: string): string {
  const words = fold(s).split(/[^\p{L}\p{N}+#]+/u).filter(Boolean);
  return words.length ? ` ${words.join(" ")} ` : "";
}

/** Does a posting's title match the seeker's target TITLES (folded, whole words)?
 *  No titles = everything. Role-family slugs are deliberately NOT title text: a family
 *  is a ranking signal the matcher weighs, and a title that does not spell the slug
 *  ("Senior AI Engineer" for `software_engineering`) is not evidence it is off-target. */
export function matchesTargets(title: string, prefs: JobseekerPreferences): boolean {
  // Each stated title with its synonyms (the ONE alias table the matcher reads too):
  // "AI Engineer" keeps "AI vývojář" and "KI-Entwickler" from a Czech or German feed.
  const needles = prefs.targetTitles.flatMap(targetForms);
  if (needles.length === 0) return true;
  const hay = wordsOf(title);
  return needles.some((needle) => hay.includes(needle));
}

/** What the location filter reads from a posting: the place, the market, the mode. */
export type LocationFacts = Pick<RawPosting, "location" | "country" | "workMode">;

/** ISO-3166-1 alpha-2, lower-case, or null — the form `preferences.countries` holds. */
export function isoCountry(v: string | null | undefined): string | null {
  const c = (v ?? "").trim().toLowerCase();
  return /^[a-z]{2}$/.test(c) ? c : null;
}

/** Is the posting somewhere the seeker would work? It passes when the seeker named no
 *  place, when the posting's place is unknown (never a penalty — types.ts
 *  EligibilityFlag), when the city matches, when it is in a country the seeker named,
 *  or when it STATES remote and the seeker has not ruled remote out. */
export function matchesLocations(posting: LocationFacts, prefs: JobseekerPreferences): boolean {
  if (prefs.locations.length === 0) return true;
  if (!posting.location) return true;
  const l = fold(posting.location);
  if (prefs.locations.some((needle) => l.includes(fold(needle)))) return true;
  const country = isoCountry(posting.country);
  if (country && prefs.countries.some((c) => isoCountry(c) === country)) return true;
  return posting.workMode === "remote" && (prefs.workModes.length === 0 || prefs.workModes.includes("remote"));
}

/** Read a config value as a non-empty string, or null. */
export function cfg(source: { config: Record<string, unknown> }, key: string): string | null {
  return str(source.config[key]);
}

/** A company slug / board token as it appears in a URL path — nothing else gets interpolated. */
export function safeSlug(v: string | null): string | null {
  return v && /^[a-z0-9][a-z0-9._-]{0,80}$/i.test(v) ? v : null;
}
