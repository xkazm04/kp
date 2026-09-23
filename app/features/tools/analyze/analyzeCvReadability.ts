// Preflight: what the engine can read of each attached Analyze file, decided
// before the run spends anything.
//
// WHY THIS EXISTS. A scanned CV (an image-only PDF) extracts to EMPTY text
// without raising (pipeline/jobfit/extractors.py: `page.extract_text() or ""`).
// In blind mode the redactor needs that text, so the engine halts and answers
// `blind_unavailable` — correctly, fail closed — but the recruiter learns it only
// from a failed task, and in a multi-CV compare settleVariants
// (app/_lib/analyze-run.ts) quietly drops the variant after the other engine
// calls have spent. The same scan used as a JD FILE is preferred over typed JD
// text and silently scores JD-blind. /api/extract-text has answered
// {text, charCount, pageCount} since eceb983e9 precisely "so callers can warn on
// empty scans"; this module is the caller that warns.
//
// THE RULES (blind-screening standard: fail closed on an unmaskable document):
//   - blind + a CV with no text layer (or one the extractor refused) BLOCKS, and
//     always with a remedy: run without blind, or remove that CV.
//   - an unknown ('unchecked': rate-limited, timed out, offline) never blocks —
//     degrade, never block. The server-side refusal still stands behind it, so
//     the preflight is an earlier, kinder copy of a refusal the engine enforces,
//     never a gate that could let a blind run through.
//   - without blind the model reads the raw file itself (pipeline.py), so a scan
//     is an honest note, not a block.
//
// COST. Each unique PDF/DOCX costs one extractor spawn here and the pipeline
// extracts again at run time. The cache below (keyed by the canonical CV
// identity, cvVariantHash) keeps it to one per distinct document per session,
// .txt/.md are measured locally, and the door's 20/10min/IP limit answering 429
// reads as 'unchecked', not as a fault.
import { cvVariantHash } from "@/app/_lib/cv-variant";

/** The engine's own short-profile bar: pipeline.py flags profile text under 120
 *  characters as "short - assessment may be less reliable". */
export const THIN_CHARS = 120;

export type Readability =
  | { kind: "checking" }
  | { kind: "readable"; chars: number; pages: number | null }
  | { kind: "thin"; chars: number; pages: number | null }
  | { kind: "no-text"; pages: number | null }
  | { kind: "unreadable" }
  | { kind: "unchecked" };

export type ReadabilityKind = Readability["kind"];

/** One /api/extract-text answer, reduced to what the preflight reads. `null` is
 *  a request that never got an answer (network throw, unparseable body). */
export type ExtractAnswer =
  | { ok: true; charCount: number; pageCount: number | null }
  | { ok: false; status: number; code?: string }
  | null;

export function readabilityFromExtract(answer: ExtractAnswer): Readability {
  if (!answer) return { kind: "unchecked" };
  if (!answer.ok) {
    // Only the door's "this FILE cannot be read" is a fact about the document.
    // 429 (rate limit), 503 (engine busy), 504 (timeout) and 5xx faults say
    // nothing about it — unknown, never a block.
    if (answer.code === "EXTRACT_TEXT_UNREADABLE") return { kind: "unreadable" };
    return { kind: "unchecked" };
  }
  const pages = typeof answer.pageCount === "number" ? answer.pageCount : null;
  const chars = Math.max(0, Math.floor(answer.charCount));
  if (chars === 0) return { kind: "no-text", pages };
  if (chars < THIN_CHARS) return { kind: "thin", chars, pages };
  return { kind: "readable", chars, pages };
}

/** Readability of text that is already in hand (a .txt/.md read locally). */
export function readabilityFromText(text: string): Readability {
  // The extractor's charCount is len() of what it returns, and whitespace alone
  // is nothing the redactor or the model can use.
  const chars = text.trim().length === 0 ? 0 : text.length;
  return readabilityFromExtract({ ok: true, charCount: chars, pageCount: null });
}

/** A document blind screening cannot mask: no text to redact at all. */
export function isUnmaskable(r: Readability): boolean {
  return r.kind === "no-text" || r.kind === "unreadable";
}

export type PreflightNote =
  | { cv: number; kind: "model-read" | "thin" | "unreadable" }
  | { jd: true; kind: "jd-file-empty" | "jd-file-empty-overrides-text" | "jd-file-unreadable" };

export type PreflightRemedy = "disable-blind" | "remove-variant";

export type PreflightVerdict = {
  /** The Analyze button must not fire: blind + an unmaskable CV. */
  blockRun: boolean;
  /** Blind is on and a CV is still being checked — the button waits rather than
   *  let a possibly-unmaskable document through. Resolves to a verdict or to
   *  'unchecked' (which never blocks). */
  waiting: boolean;
  /** Indices (into cvs) that blind screening cannot redact. */
  blindUnmaskable: number[];
  remedies: PreflightRemedy[];
  notes: PreflightNote[];
};

export function preflightVerdict(input: {
  blind: boolean;
  cvs: readonly Readability[];
  jd: Readability | null;
  jdTextTyped?: boolean;
}): PreflightVerdict {
  const { blind, cvs, jd, jdTextTyped = false } = input;
  const blindUnmaskable: number[] = [];
  const notes: PreflightNote[] = [];

  cvs.forEach((r, i) => {
    if (blind && isUnmaskable(r)) {
      blindUnmaskable.push(i);
      return;
    }
    if (r.kind === "no-text") notes.push({ cv: i, kind: "model-read" });
    else if (r.kind === "unreadable") notes.push({ cv: i, kind: "unreadable" });
    else if (r.kind === "thin") notes.push({ cv: i, kind: "thin" });
  });

  if (jd?.kind === "no-text") {
    // analyze-run.ts passes a JD file path IN PREFERENCE to typed JD text, and the
    // service extracts it with no empty check — so pasted text does not rescue it.
    notes.push({ jd: true, kind: jdTextTyped ? "jd-file-empty-overrides-text" : "jd-file-empty" });
  } else if (jd?.kind === "unreadable") {
    notes.push({ jd: true, kind: "jd-file-unreadable" });
  }

  const blockRun = blindUnmaskable.length > 0;
  return {
    blockRun,
    waiting: blind && !blockRun && cvs.some((r) => r.kind === "checking"),
    blindUnmaskable,
    remedies: blockRun ? ["disable-blind", "remove-variant"] : [],
    notes,
  };
}

// ---------------------------------------------------------------------------
// Measuring one file
// ---------------------------------------------------------------------------

/** Session cache: content hash -> the pending or settled measurement. A promise
 *  is stored so two byte-identical files measured at once share ONE call. */
export type ReadabilityCache = Map<string, Promise<Readability>>;

const CACHE_CAP = 64;

export function createReadabilityCache(): ReadabilityCache {
  return new Map();
}

function isLocalText(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".markdown");
}

async function extractAnswer(file: File, doFetch: typeof fetch): Promise<ExtractAnswer> {
  try {
    const form = new FormData();
    form.append("file", file);
    const response = await doFetch("/api/extract-text", { method: "POST", body: form });
    const payload = (await response.json().catch(() => null)) as
      | { charCount?: unknown; pageCount?: unknown; code?: unknown }
      | null;
    if (!response.ok) {
      return { ok: false, status: response.status, code: typeof payload?.code === "string" ? payload.code : undefined };
    }
    if (!payload || typeof payload.charCount !== "number") return null;
    return {
      ok: true,
      charCount: payload.charCount,
      pageCount: typeof payload.pageCount === "number" ? payload.pageCount : null,
    };
  } catch {
    /* a network failure is an unknown, not a verdict about the document */
    return null;
  }
}

export async function measureFile(
  file: File,
  deps: { fetch: typeof fetch; cache: ReadabilityCache },
): Promise<Readability> {
  if (isLocalText(file)) {
    try {
      return readabilityFromText(await file.text());
    } catch {
      /* an unreadable local blob is an unknown here; the engine gets the last word */
      return { kind: "unchecked" };
    }
  }

  let key: string;
  try {
    key = await cvVariantHash(file);
  } catch {
    /* no Web Crypto (an insecure origin): measure uncached rather than not at all */
    return readabilityFromExtract(await extractAnswer(file, deps.fetch));
  }

  const hit = deps.cache.get(key);
  if (hit) return hit;

  const pending = extractAnswer(file, deps.fetch).then(readabilityFromExtract);
  if (deps.cache.size >= CACHE_CAP) {
    const oldest = deps.cache.keys().next().value;
    if (oldest !== undefined) deps.cache.delete(oldest);
  }
  deps.cache.set(key, pending);
  const result = await pending;
  // An unknown is never remembered: the next look (after the rate-limit window,
  // or back online) gets a real answer.
  if (result.kind === "unchecked" && deps.cache.get(key) === pending) deps.cache.delete(key);
  return result;
}
