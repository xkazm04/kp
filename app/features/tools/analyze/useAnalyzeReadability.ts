"use client";

// Measures what the engine can read of every attached Analyze file, once per
// file, for the preflight strip above the Analyze button. The decision itself is
// pure (analyzeCvReadability.ts); this hook only owns the measuring and the
// per-File results.
//
// Reads the form's inputs and makes its own /api/extract-text fetch through
// measureFile — it deliberately does not extend AnalyzeApi.extractFileText,
// whose one caller (the GitHub deep-dive) needs the text and nothing else.
import { useEffect, useMemo, useRef, useState } from "react";
import { createReadabilityCache, measureFile, type Readability } from "./analyzeCvReadability";

// Session-wide: the same bytes attached again (a re-drop, a restored draft, the
// same PDF as CV and JD) never cost a second extractor spawn.
const sessionCache = createReadabilityCache();

const CHECKING: Readability = { kind: "checking" };

export function useAnalyzeReadability(
  cvFiles: readonly File[],
  jdFile: File | null,
): { cvs: Readability[]; jd: Readability | null } {
  // Keyed by File identity: a replaced or removed file simply stops being read.
  const [results, setResults] = useState<ReadonlyMap<File, Readability>>(() => new Map());
  // Files already measured or in flight. A WeakSet so a removed File is not
  // pinned in memory by the bookkeeping.
  const started = useRef(new WeakSet<File>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const files = jdFile ? [...cvFiles, jdFile] : [...cvFiles];
    for (const file of files) {
      if (started.current.has(file)) continue;
      started.current.add(file);
      void measureFile(file, { fetch: (...args) => fetch(...args), cache: sessionCache }).then((r) => {
        if (!mounted.current) return;
        setResults((prev) => {
          const next = new Map(prev);
          next.set(file, r);
          return next;
        });
      });
    }
  }, [cvFiles, jdFile]);

  return useMemo(
    () => ({
      cvs: cvFiles.map((f) => results.get(f) ?? CHECKING),
      jd: jdFile ? (results.get(jdFile) ?? CHECKING) : null,
    }),
    [cvFiles, jdFile, results],
  );
}
