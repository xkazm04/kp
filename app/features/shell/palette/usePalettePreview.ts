"use client";

// The preview pane's data hook: highlighted palette item → the PalettePreview
// for it (GET /api/palette/preview). Debounced (arrow-key runs through ten rows
// should cost one request, not ten), aborted on change, and memoised per key
// for the life of the document with a short TTL — the pane re-shows a row's
// facts instantly on the way back up the list, and a stale count is bounded.
import { useEffect, useState } from "react";
import type { PalettePreview } from "@/app/_lib/palette-preview/types";
import type { PaletteItem } from "../workspaceCommandPaletteTypes";

export type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; preview: PalettePreview }
  | { status: "error" };

const DEBOUNCE_MS = 120;
const TTL_MS = 30_000;
const cache = new Map<string, { at: number; preview: PalettePreview }>();

/** The request that describes an item, or null when there is nothing to preview
 *  (a command like the tour). Tabs key by id; entities by their hit identity —
 *  a recent carries the same identity as the hit it was recorded from. */
export function previewQuery(item: PaletteItem | null): string | null {
  if (!item) return null;
  if (item.recent) return `type=${encodeURIComponent(item.recent.type)}&id=${encodeURIComponent(item.recent.id)}`;
  if (item.tabId) return `tab=${encodeURIComponent(item.tabId)}`;
  return null;
}

export function usePalettePreview(item: PaletteItem | null): PreviewState {
  const key = previewQuery(item);
  // Resolved results mirrored into state so a completed fetch re-renders; the
  // module cache is the source of truth across mounts.
  const [results, setResults] = useState<Record<string, PalettePreview | "error">>({});

  useEffect(() => {
    if (!key) return;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) {
      // Fresh in the module cache but not yet in this mount's state — adopt it.
      // (Deferred to a microtask so the effect never sets state synchronously.)
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) setResults((r) => (r[key] === hit.preview ? r : { ...r, [key]: hit.preview }));
      });
      return () => {
        cancelled = true;
      };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/palette/preview?${key}`, { signal: controller.signal })
        .then(async (r) => {
          const body = (await r.json().catch(() => null)) as { preview?: PalettePreview } | null;
          if (controller.signal.aborted) return;
          if (!r.ok || !body?.preview) {
            setResults((prev) => ({ ...prev, [key]: "error" }));
            return;
          }
          cache.set(key, { at: Date.now(), preview: body.preview });
          setResults((prev) => ({ ...prev, [key]: body.preview! }));
        })
        .catch(() => {
          if (!controller.signal.aborted) setResults((prev) => ({ ...prev, [key]: "error" }));
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);

  if (!key) return { status: "idle" };
  const got = results[key];
  if (got === undefined) return { status: "loading" };
  if (got === "error") return { status: "error" };
  return { status: "ready", preview: got };
}
