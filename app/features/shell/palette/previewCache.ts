"use client";

/*
 * The palette preview's memo, and the pure state machine around it.
 *
 * WHY THIS IS ITS OWN MODULE (/perfect wave 17, shell-nav): the cache used to
 * live inside usePalettePreview keyed on the QUERY alone — `tab=pipeline`, or
 * `type=job&id=…`. A palette query says nothing about WHOSE numbers it asked
 * for, so within one document the same key resolved to whichever tenant was
 * current when the entry was written: switch teams and the pane could re-show
 * the previous workspace's counts for up to thirty seconds. A full reload after
 * a switch (WorkspaceTab.switchTo) hides that today, which is exactly the kind
 * of guarantee a cache should not be resting on — one in-place switch, and the
 * pane leaks a foreign tenant's headline figures.
 *
 * So every entry is filed under (workspace, query). An unresolved workspace is
 * not a key: nothing is read from the cache and nothing is written to it, so the
 * worst case is a colder pane, never a wrong one.
 *
 * The tenant comes from the same door recents.ts uses — GET /api/workspaces,
 * whose `current` field is the only place the browser can learn it (the session
 * cookie carrying it is httpOnly). Resolved once per document and shared.
 */

import type { PalettePreview } from "@/app/_lib/palette-preview/types";

/** A cached count is a headline figure, not a source of truth: short enough that
 *  a stale number cannot survive a real edit, long enough to make an arrow-key
 *  run back up the list instant. */
export const PREVIEW_TTL_MS = 30_000;

/** (workspace, query) → one cache key. `\u0000` cannot occur in either half of a
 *  URL-encoded query or a workspace id, so no pair can collide with another. */
export function scopedKey(scope: string, query: string): string {
  return `${scope}\u0000${query}`;
}

type Entry = { at: number; preview: PalettePreview };
const cache = new Map<string, Entry>();

/** A fresh entry for this tenant + query, or null (missing, or past its TTL). */
export function readPreview(scope: string | null, query: string, now: number): PalettePreview | null {
  if (!scope) return null;
  const hit = cache.get(scopedKey(scope, query));
  if (!hit) return null;
  if (now - hit.at >= PREVIEW_TTL_MS) {
    cache.delete(scopedKey(scope, query));
    return null;
  }
  return hit.preview;
}

/** Remember a resolved preview. A null scope is a no-op — see the header: we
 *  would rather cache nothing than file a tenant's numbers under "unknown". */
export function writePreview(scope: string | null, query: string, preview: PalettePreview, now: number): void {
  if (!scope) return;
  cache.set(scopedKey(scope, query), { at: now, preview });
}

/** Drop everything. Called when the resolved tenant CHANGES, and by tests. */
export function clearPreviewCache(): void {
  cache.clear();
}

// ── The tenant this document belongs to ────────────────────────────────────

let scope: string | null = null;
let resolving: Promise<string | null> | null = null;

/** The tenant if it is already known, else null — the synchronous read the
 *  render path uses so a cache hit costs no await. */
export function currentPreviewScope(): string | null {
  return scope;
}

/** Seed the tenant when a caller already knows it (a shell that resolved
 *  `currentWorkspace()` server-side). Changing tenants empties the cache, which
 *  is the whole point: no entry outlives the workspace it was read from. */
export function primePreviewScope(id: string | null): void {
  if (!id || scope === id) return;
  if (scope !== null) clearPreviewCache();
  scope = id;
  resolving = Promise.resolve(id);
}

/** Resolve the tenant once per document. A failure resolves to null (no cache)
 *  and clears `resolving`, so the next preview retries rather than disabling the
 *  memo for the whole session. */
export function resolvePreviewScope(): Promise<string | null> {
  if (scope) return Promise.resolve(scope);
  resolving ??= fetch("/api/workspaces")
    .then((r) => (r.ok ? (r.json() as Promise<{ current?: unknown }>) : null))
    .then((body) => {
      const current = body && typeof body.current === "string" ? body.current : "";
      if (!current) throw new Error("no current workspace in /api/workspaces");
      primePreviewScope(current);
      return current;
    })
    .catch(() => {
      resolving = null;
      return null;
    });
  return resolving;
}

/** Test hook: forget the resolved tenant AND the cache. */
export function resetPreviewScopeForTests(): void {
  scope = null;
  resolving = null;
  clearPreviewCache();
}

// ── The pure fetch-state machine ───────────────────────────────────────────

export type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; preview: PalettePreview }
  | { status: "error" };

/** What one preview response means. Extracted from the effect so the three ways
 *  a request fails — a non-2xx, a body that parsed to nothing, a 200 carrying no
 *  `preview` — are pinned by a test instead of by reading the promise chain. */
export function previewFromResponse(ok: boolean, body: unknown): PalettePreview | "error" {
  if (!ok) return "error";
  const preview = (body as { preview?: unknown } | null)?.preview;
  if (!preview || typeof preview !== "object") return "error";
  return preview as PalettePreview;
}

/** Resolved results + the current key → what the pane renders. No key at all is
 *  `idle` (a command row has nothing to preview); a key with no result yet is
 *  `loading`, which is also what a key looks like while it is being re-fetched. */
export function previewStateFor(
  key: string | null,
  results: Record<string, PalettePreview | "error">
): PreviewState {
  if (!key) return { status: "idle" };
  const got = results[key];
  if (got === undefined) return { status: "loading" };
  if (got === "error") return { status: "error" };
  return { status: "ready", preview: got };
}
