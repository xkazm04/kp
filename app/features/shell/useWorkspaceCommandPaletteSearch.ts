// The palette's debounced server search (hits/error/loading + the fetch effect),
// split out of CommandPalette.tsx so the component stays under the 200-line file
// cap. Verbatim behaviour — aborts the in-flight request on every keystroke and on
// close, so a slow earlier response can't clobber a newer result set.
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { resolveErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import { DEBOUNCE_MS, type SearchHit } from "./workspaceCommandPaletteTypes";

export function useWorkspaceCommandPaletteSearch(
  open: boolean,
  query: string,
  t: ReturnType<typeof useTranslations>
) {
  // Search failures resolve from the machine `code`, never the server's English
  // `error` — see app/_lib/use-error-message.ts. The pure resolveErrorMessage
  // rather than useErrorMessage(), because the hook hands back a FRESH closure each
  // render and this resolver is a dependency of the debounced effect below: an
  // unstable one would restart the debounce on every render. `t` is stable.
  const tErrors = useTranslations("errors");
  const errMsg = useCallback(
    (payload: ApiErrorPayload | null, fallback: string) => {
      type ErrorKey = Parameters<typeof tErrors>[0];
      return resolveErrorMessage(payload, fallback, (c) => tErrors.has(c as ErrorKey), (c) => tErrors(c as ErrorKey));
    },
    [tErrors]
  );
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
          const body = (await r.json().catch(() => null)) as { results?: SearchHit[]; error?: string; code?: string } | null;
          // An aborted (superseded) request leaves `loading` for the newer run to own.
          if (controller.signal.aborted) return;
          if (!r.ok || !body || body.error) {
            setError(errMsg(body, t("searchFailed")));
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
  }, [open, query, t, errMsg]);

  return { hits, error, loading, reset, markPending };
}
