"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JdSummary } from "./AnalyzeTypes";

export function useAnalyzeJdLibrary(setJobDescriptionText: (value: string) => void) {
  const [jdLibrary, setJdLibrary] = useState<JdSummary[]>([]);
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

  useEffect(() => {
    let cancelled = false;
    fetch("/api/jds")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled || !payload?.jds) return;
        setJdLibrary(payload.jds as JdSummary[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
    selectedJdSlug,
    setSelectedJdSlug: setSelectedJdSlugExternal,
    pickJd,
    jdLoading,
    jdLoadFailed,
  };
}
