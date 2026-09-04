"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JdSummary } from "./AnalyzeTypes";
import {
  JD_LIBRARY_LIMIT,
  readJdLibraryPayload,
  type JdLibraryState,
} from "./analyzeJdLibraryState";

export function useAnalyzeJdLibrary(setJobDescriptionText: (value: string) => void) {
  const [jdLibrary, setJdLibrary] = useState<JdSummary[]>([]);
  // The library's honest load state. It used to be inferred from `jdLibrary.length`,
  // which cannot tell "still loading" from "this workspace has no saved JDs" from
  // "the request failed" — and the picker told every one of them the same thing.
  const [jdLibraryState, setJdLibraryState] = useState<JdLibraryState>("loading");
  // Refetch nonce: bumping it re-runs the load effect, which is how the picker's
  // Retry works without duplicating the fetch or leaking an AbortController.
  const [libraryAttempt, setLibraryAttempt] = useState(0);
  // Which attempt `jdLibraryState` describes. Paired with the render-time
  // adjustment below — React's "adjust state when a prop changes" shape — so a
  // Retry shows "loading" from that very render. Flipping it in the effect
  // instead would paint the stale failed state for a frame AND need a
  // set-state-in-effect suppression; the state is derived, so it does not.
  const [stateForAttempt, setStateForAttempt] = useState(0);
  if (stateForAttempt !== libraryAttempt) {
    setStateForAttempt(libraryAttempt);
    setJdLibraryState("loading");
  }
  const [selectedJdSlug, setSelectedJdSlug] = useState<string | null>(null);
  // True while a picked JD's body fetch is in flight. The textarea is populated only AFTER
  // this resolves, and the server never resolves the slug→body itself — so submitting before
  // it lands runs the analysis JD-blind while still tagging it with the slug. Callers OR this
  // into the submit gate so a pick-then-immediately-Analyze can't run without the JD.
  const [jdLoading, setJdLoading] = useState(false);
  // True when the last pick's body fetch failed (404 from a stale list, network
  // error, or a bodyless payload). The slug is cleared on failure so the run can't
  // be tagged with a JD it never saw; this flag lets the picker say why.
  const [jdLoadFailed, setJdLoadFailed] = useState(false);
  // Monotonic pick counter: ignore a slow saved-JD body fetch that resolves after
  // a newer pick, so the textarea can't end up holding JD A's body while the slug
  // records JD B (the run would then silently use the wrong JD). One counter shared
  // by both entry points — the dropdown pick and the ?jd= deep link — so a deep-link
  // load in flight can't last-write-win over a fresh manual pick.
  const jdPickSeqRef = useRef(0);

  // Load the saved-JD library. Bounded (JD_LIBRARY_LIMIT, matching the route's own
  // listJds(200) cap) and aborted on unmount, and — the part that changed — a
  // failure is REPORTED. The old `.catch(() => {})` swallowed a 500, a network
  // drop and an offline tab alike into the initial empty array, which the picker
  // rendered as "No JDs saved": a claim about the recruiter's own library that the
  // client had never confirmed.
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/jds?limit=${JD_LIBRARY_LIMIT}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (controller.signal.aborted) return;
        const result = readJdLibraryPayload<JdSummary>(payload);
        setJdLibrary(result.jds);
        setJdLibraryState(result.state);
      })
      .catch(() => {
        // An unmount/refetch abort is not a failure — the surface is gone or a
        // newer attempt owns the state. Anything else genuinely failed, and the
        // picker must say so rather than showing an empty library.
        if (controller.signal.aborted) return;
        setJdLibrary([]);
        setJdLibraryState("failed");
      });
    return () => controller.abort();
  }, [libraryAttempt]);

  /** Re-run the library load — the picker's Retry on the failed state. */
  const reloadJdLibrary = useCallback(() => setLibraryAttempt((n) => n + 1), []);

  // The single JD-by-slug loader. Both the dropdown and the ?jd= deep link route
  // through here, so the preview-to-full-body fetch, the error handling, and the
  // slug bookkeeping live in one place and cannot drift between the two entry
  // points. Records the selection first (the list payload only carries a preview),
  // then fetches the full body and populates the textarea.
  const pickJd = useCallback(
    (slug: string) => {
      setSelectedJdSlug(slug);
      setJdLoadFailed(false);
      const seq = ++jdPickSeqRef.current;
      setJdLoading(true);
      // A failed body fetch must DETACH the pick, not just skip the textarea write:
      // the slug rides along in the submit, so keeping it recorded would persist a
      // JD-blind run as a role-specific match (analyze-run logs jd_present:false
      // with jd_slug set). Clear the slug and flag the failure for the picker.
      const fail = () => {
        if (seq !== jdPickSeqRef.current) return; // a newer pick owns the slug now
        setSelectedJdSlug(null);
        setJdLoadFailed(true);
      };
      fetch(`/api/jds/${encodeURIComponent(slug)}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((full) => {
          // Drop a stale response: a slower earlier pick must not last-write-win
          // over a newer one (textarea/slug would then disagree).
          if (seq !== jdPickSeqRef.current) return;
          // The slug endpoint can return a non-{body:string} shape (an { error },
          // a renamed field, a partial record); setting a non-string into the
          // controlled textarea white-screens the whole tab (e.g. from a shareable
          // ?jd= URL). Guard the write — and treat it as a failed load (the run
          // would otherwise proceed JD-blind), same as a 404/network error.
          if (full && typeof full.body === "string") {
            setJobDescriptionText(full.body);
          } else {
            fail();
          }
        })
        .catch(fail)
        .finally(() => {
          // Only the current pick owns the flag — a superseded pick's resolution must not
          // clear a newer pick's loading state.
          if (seq === jdPickSeqRef.current) setJdLoading(false);
        });
    },
    [setJobDescriptionText]
  );

  // Load the JD named by a shareable ?jd= URL on mount, through the same loader.
  // Deferred kick-off (0 ms timer): pickJd records the slug synchronously, and a
  // sync setState in the effect body would cascade a render before the first
  // commit settles. Behavior is unchanged — the load still starts right away.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const slug = new URLSearchParams(window.location.search).get("jd");
    if (!slug) return;
    const t = window.setTimeout(() => pickJd(slug), 0);
    return () => window.clearTimeout(t);
  }, [pickJd]);

  // External slug writes (detach, paste-over, file attach) are corrective actions —
  // they also dismiss a lingering load-failure message, so callers don't need to
  // know the flag exists.
  const setSelectedJdSlugExternal = useCallback((slug: string | null) => {
    setJdLoadFailed(false);
    setSelectedJdSlug(slug);
  }, []);

  return {
    jdLibrary,
    jdLibraryState,
    reloadJdLibrary,
    selectedJdSlug,
    setSelectedJdSlug: setSelectedJdSlugExternal,
    pickJd,
    jdLoading,
    jdLoadFailed,
  };
}
