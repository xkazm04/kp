// The palette's debounced server search (hits/error/loading + the fetch effect),
// split out of CommandPalette.tsx so the component stays under the 200-line file
// cap. Verbatim behaviour — aborts the in-flight request on every keystroke and on
// close, so a slow earlier response can't clobber a newer result set.
import { useCallback, useEffect, useState } from "react";
import type { useTranslations } from "next-intl";
import { DEBOUNCE_MS, type SearchHit } from "./workspaceCommandPaletteTypes";

export function useWorkspaceCommandPaletteSearch(
  open: boolean,
  query: string,
  t: ReturnType<typeof useTranslations>
) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  // #4 — in-flight flag for the debounced search, so a prior query's hits don't
  // linger silently and the palette shows a "Searching…" affordance instead.
  const [loading, setLoading] = useState(false);

  // Shared reset for "opening fresh" and "query dropped below the search minimum".
  const reset = useCallback(() => {
    setHits([]);
    setError(null);
    setLoading(false);
  }, []);

  // Pending from the first keystroke (debounce included), so the list can't sit on
  // the prior query's results without a signal that a newer term is being fetched.
  // Raised by the caller's onChange EVENT — the effect below only schedules the
  // debounced fetch, it never sets state synchronously during render/commit.
  const markPending = useCallback(() => setLoading(true), []);

  // Debounced server search. Sub-minimum queries never reach here — the caller's
  // onChange handler resets synchronously (an event, not an effect), so this
  // effect only schedules async work and sets state from its callbacks.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then(async (r) => {
          const body = (await r.json().catch(() => null)) as { results?: SearchHit[]; error?: string } | null;
          // An aborted (superseded) request leaves `loading` for the newer run to own.
          if (controller.signal.aborted) return;
          if (!r.ok || !body || body.error) {
            setError(body?.error ?? t("searchFailed"));
          } else {
            setError(null);
            setHits(Array.isArray(body.results) ? body.results : []);
          }
          setLoading(false);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setError(t("searchFailed"));
            setLoading(false);
          }
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, t]);

  return { hits, error, loading, reset, markPending };
}
