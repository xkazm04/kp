"use client";

// The preview pane's data hook: highlighted palette item → the PalettePreview
// for it (GET /api/palette/preview). Debounced (arrow-key runs through ten rows
// should cost one request, not ten), aborted on change, and memoised per
// (workspace, query) for the life of the document with a short TTL — the pane
// re-shows a row's facts instantly on the way back up the list, and a stale
// count is bounded AND tenant-scoped (previewCache.ts owns both halves).
import { useEffect, useState } from "react";
import type { PalettePreview } from "@/app/_lib/palette-preview/types";
import type { PaletteItem } from "../workspaceCommandPaletteTypes";
import {
  currentPreviewScope,
  previewFromResponse,
  previewStateFor,
  readPreview,
  resolvePreviewScope,
  writePreview,
  type PreviewState,
} from "./previewCache";

export type { PreviewState };

const DEBOUNCE_MS = 120;

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
    // Warm the tenant so the SECOND preview of this document can hit the memo.
    // Fire-and-forget: nothing here waits on it, and a failure just means no cache.
    void resolvePreviewScope();
    const hit = readPreview(currentPreviewScope(), key, Date.now());
    if (hit) {
      // Fresh in the module cache but not yet in this mount's state — adopt it.
      // (Deferred to a microtask so the effect never sets state synchronously.)
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) setResults((r) => (r[key] === hit ? r : { ...r, [key]: hit }));
      });
      return () => {
        cancelled = true;
      };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/palette/preview?${key}`, { signal: controller.signal })
        .then(async (r) => {
          const body = (await r.json().catch(() => null)) as unknown;
          if (controller.signal.aborted) return;
          const outcome = previewFromResponse(r.ok, body);
          setResults((prev) => ({ ...prev, [key]: outcome }));
          if (outcome === "error") return;
          // File it under the tenant, once that is known — not under whoever is
          // current when the NEXT reader asks.
          void resolvePreviewScope().then((scope) => writePreview(scope, key, outcome, Date.now()));
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

  return previewStateFor(key, results);
}
