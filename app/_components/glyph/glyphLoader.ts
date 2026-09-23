// Client-side loader for traced glyph art, by id.
//
// The art is served by GET /api/glyphs/[id] (glyphCatalog.ts, server-only) instead
// of being imported, so ~274 KB of emitted path data stays off the workspace page's
// import graph and reaches the browser only when an empty state actually renders.
//
// Contract:
//   - one request per id per page lifetime: a pending load is shared by every
//     concurrent caller, and a resolved glyph is served from memory (and readable
//     synchronously through `peek`, so a remount paints without a blank frame);
//   - a failure — network error, non-2xx, a body that is not JSON or not a
//     TracedGlyph — resolves `null` and never throws. Every glyph is decorative
//     (the empty state's heading and copy carry the meaning), so the renderer keeps
//     its sized blank square. A failure is NOT cached: the next mount retries.
//
// Pure apart from the injected fetch, so node:test drives it with a stub.
import type { GlyphElement, TracedGlyph } from "./MotionizedGlyph";
import { isGlyphId, type GlyphId } from "./glyphRegistry";

/** The route an id is served from; null at runtime for anything that is not an id. */
export function glyphUrl(id: GlyphId): string | null {
  return isGlyphId(id) ? `/api/glyphs/${id}` : null;
}

function isGlyphElement(value: unknown): value is GlyphElement {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.d === "string" && typeof v.fill === "string" && typeof v.delay === "number";
}

/** Shape guard for a response body — the emitted `{ viewBox, data: {d, fill, delay}[] }`. */
export function isTracedGlyph(value: unknown): value is TracedGlyph {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.viewBox === "string" && Array.isArray(v.data) && v.data.every(isGlyphElement);
}

export interface GlyphLoader {
  /** The art for `id`, fetched at most once while it succeeds; null on any failure. */
  load(id: string): Promise<TracedGlyph | null>;
  /** The art if it has already arrived, else undefined. Synchronous, never fetches. */
  peek(id: string): TracedGlyph | undefined;
}

/** A loader over an injected fetch — read at call time, so a test can stub it. */
export function createGlyphLoader(getFetch: () => typeof fetch): GlyphLoader {
  const done = new Map<GlyphId, TracedGlyph>();
  const pending = new Map<GlyphId, Promise<TracedGlyph | null>>();

  async function fetchArt(id: GlyphId): Promise<TracedGlyph | null> {
    const url = glyphUrl(id);
    if (!url) return null;
    try {
      const res = await getFetch()(url);
      if (!res.ok) return null;
      const body: unknown = await res.json();
      return isTracedGlyph(body) ? body : null;
    } catch {
      /* decorative art: offline, aborted or a non-JSON body all mean "keep the blank square" */
      return null;
    }
  }

  return {
    load(id) {
      if (!isGlyphId(id)) return Promise.resolve(null);
      const hit = done.get(id);
      if (hit) return Promise.resolve(hit);
      const inflight = pending.get(id);
      if (inflight) return inflight;
      const p = fetchArt(id).then((art) => {
        pending.delete(id);
        if (art) done.set(id, art);
        return art;
      });
      pending.set(id, p);
      return p;
    },
    peek(id) {
      return isGlyphId(id) ? done.get(id) : undefined;
    },
  };
}

const defaultLoader = createGlyphLoader(() => globalThis.fetch);

/** Load a glyph's art through the page-wide cache. */
export function loadGlyph(id: string): Promise<TracedGlyph | null> {
  return defaultLoader.load(id);
}

/** A glyph's art if it has already arrived on this page, else undefined. */
export function peekGlyph(id: string): TracedGlyph | undefined {
  return defaultLoader.peek(id);
}
