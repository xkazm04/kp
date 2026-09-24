"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JdSummary } from "./AnalyzeTypes";
import type { JdAction } from "./analyzeJdSource";
import {
  JD_LIBRARY_LIMIT,
  readJdLibraryPayload,
  type JdLibraryState,
} from "./analyzeJdLibraryState";

/**
 * The saved-JD library and the pick flow. The column's source of truth (which JD is
 * linked, its body, whether it loaded) is NOT held here: it is the form's one
 * JdSource (analyzeJdSource.ts), and this hook dispatches the pick into it.
 */
export function useAnalyzeJdLibrary(dispatchJd: (action: JdAction) => void) {
  const [jdLibrary, setJdLibrary] = useState<JdSummary[]>([]);
  // The library's honest load state. It used to be inferred from `jdLibrary.length`,
  // which cannot tell "still loading" from "this workspace has no saved JDs" from
  // "the request failed" — and the picker told every one of them the same thing.
  const [jdLibraryState, setJdLibraryState] = useState<JdLibraryState>("loading");
  // Refetch nonce: bumping it re-runs the load effect, which is how the picker's
  // Retry works without duplicating the fetch or leaking an AbortController.
  const [libraryAttempt, setLibraryAttempt] = useState(0);
  // Whether the route CUT the library it answered. `/api/jds` reads the `limit`
  // below and answers `{ jds, truncated, limit }` (wave 40) — before that it took no
  // Request at all, so this bound was sent and ignored and a 201st JD simply did not
  // exist as far as the picker was concerned, with nothing saying so.
  const [jdLibraryTruncated, setJdLibraryTruncated] = useState(false);
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
  // A picked JD's body lands in the textarea only after its fetch resolves, and the
  // server never resolves slug->body itself. While it is in flight the source is
  // `saved/loading`, which sends NO slug (jdSubmission) and holds the submit (jdLoading);
  // a failed or bodyless answer is `saved/failed`, which also sends none, so a JD-blind
  // run can never be filed as a role-specific match.
  // Monotonic pick counter: ignore a slow saved-JD body fetch that resolves after
  // a newer pick, so the textarea can't end up holding JD A's body while the slug
  // records JD B (the run would then silently use the wrong JD). One counter shared
  // by both entry points — the dropdown pick and the ?jd= deep link — so a deep-link
  // load in flight can't last-write-win over a fresh manual pick.
  const jdPickSeqRef = useRef(0);

  // Load the saved-JD library. Bounded (JD_LIBRARY_LIMIT, matching the route's own
  // listJdsPage cap, JDS_PAGE_MAX_LIMIT) and aborted on unmount, and — the part that changed — a
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
        setJdLibraryTruncated((payload as { truncated?: unknown } | null)?.truncated === true);
      })
      .catch(() => {
        // An unmount/refetch abort is not a failure — the surface is gone or a
        // newer attempt owns the state. Anything else genuinely failed, and the
        // picker must say so rather than showing an empty library.
        if (controller.signal.aborted) return;
        setJdLibrary([]);
        setJdLibraryState("failed");
        // A failed load knows nothing about the library's size — claiming "not
        // truncated" there would be the same inference the empty array used to make.
        setJdLibraryTruncated(false);
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
      const seq = ++jdPickSeqRef.current;
      // The pick becomes the column's source now: an attached JD file is dropped by
      // the transition, so the file's prose can no longer be scored under this role.
      dispatchJd({ type: "pickSaved", slug });
      const fail = () => {
        if (seq !== jdPickSeqRef.current) return; // a newer pick owns the column now
        dispatchJd({ type: "bodyFailed", slug });
      };
      fetch(`/api/jds/${encodeURIComponent(slug)}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((full: { body?: unknown } | null) => {
          // Drop a stale response: a slower earlier pick must not last-write-win over a
          // newer one. The transition re-checks the slug and the loading state as well.
          if (seq !== jdPickSeqRef.current) return;
          // A non-string or blank body (an { error }, a renamed field) is a failed load
          // inside the transition — never a non-string pushed into the textarea.
          dispatchJd({ type: "bodyLoaded", slug, body: full?.body });
        })
        .catch(fail);
    },
    [dispatchJd]
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

  return {
    jdLibrary,
    jdLibraryState,
    jdLibraryTruncated,
    reloadJdLibrary,
    pickJd,
  };
}
