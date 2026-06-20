/**
 * Pure helpers for the DevInspector — kept separate from the component so the
 * DOM-walking / path-classification logic stays small and easy to reason about.
 * Only meaningful in `npm run dev:inspect`, where the `inject-source-loc` Babel
 * pass stamps host elements with `data-loc="<path>:LINE:COL"`.
 */

export interface LocEntry {
  /** The DOM element carrying this `data-loc`. */
  el: Element;
  /** Raw attribute value: `src/.../File.tsx:88:7`. */
  raw: string;
  /** Copied reference (Claude-Code clickable): `src/.../File.tsx:88`. */
  loc: string;
  /** Repo-relative path: `src/.../File.tsx`. */
  path: string;
  /** 1-based line. */
  line: number;
}

/**
 * Path segments that mark reusable "library" internals. When resolving the
 * default copy target we skip these and land on the call site (the feature/page
 * file that *used* the shared component). Alt+right-click still reaches them.
 */
const LIBRARY_SEGMENTS = [
  "/lib/",
  "/hooks/",
  "/stores/",
  "/shared/",
  "/ui/",
  "/utils/",
  "/i18n/",
  "/_dev-inspector/",
];

export function isLibraryPath(path: string): boolean {
  const p = `/${path}`;
  return LIBRARY_SEGMENTS.some((seg) => p.includes(seg));
}

export function parseLoc(raw: string): Omit<LocEntry, "el"> | null {
  const m = /^(.*):(\d+):(\d+)$/.exec(raw);
  if (!m) return null;
  const [, path, lineStr] = m;
  if (!path || !lineStr) return null;
  return { raw, path, line: Number(lineStr), loc: `${path}:${lineStr}` };
}

/** DOM ancestor chain of `[data-loc]` elements, innermost → outermost. */
export function buildChain(start: Element | null): LocEntry[] {
  const out: LocEntry[] = [];
  let el: Element | null = start?.closest("[data-loc]") ?? null;
  while (el) {
    const raw = el.getAttribute("data-loc");
    const parsed = raw ? parseLoc(raw) : null;
    if (parsed) out.push({ el, ...parsed });
    el = el.parentElement?.closest("[data-loc]") ?? null;
  }
  return out;
}

/**
 * Index of the default copy target: the first non-library file in the chain
 * (the call site), falling back to the innermost element when everything in
 * the chain is library code.
 */
export function pickDefaultIndex(chain: LocEntry[]): number {
  const i = chain.findIndex((c) => !isLibraryPath(c.path));
  return i === -1 ? 0 : i;
}

/** Collapse consecutive entries that resolve to the same `path:line`. */
export function dedupeChain(chain: LocEntry[]): LocEntry[] {
  return chain.filter((c, i) => i === 0 || c.loc !== chain[i - 1]?.loc);
}
