"use client";

import { useEffect, useState } from "react";
import type { JdSummary } from "./AnalyzeTypes";

export function useAnalyzeJdLibrary(setJobDescriptionText: (value: string) => void) {
  const [jdLibrary, setJdLibrary] = useState<JdSummary[]>([]);
  const [selectedJdSlug, setSelectedJdSlug] = useState<string | null>(null);

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const slug = new URLSearchParams(window.location.search).get("jd");
    if (!slug) return;
    fetch(`/api/jds/${encodeURIComponent(slug)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((jd) => {
        if (!jd) return;
        setSelectedJdSlug(jd.slug);
        setJobDescriptionText(jd.body);
      })
      .catch(() => {});
  }, [setJobDescriptionText]);

  return { jdLibrary, selectedJdSlug, setSelectedJdSlug };
}
