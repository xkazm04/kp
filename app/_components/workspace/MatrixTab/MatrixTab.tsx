"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildMatrix,
  MatrixGrid,
  type AnalysisRow,
  type JdRow,
} from "./MatrixGrid";

export function MatrixTab() {
  const [analyses, setAnalyses] = useState<AnalysisRow[] | null>(null);
  const [jds, setJds] = useState<JdRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/analyses").then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`analyses ${r.status}`))
      ),
      fetch("/api/jds").then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`jds ${r.status}`))
      ),
    ])
      .then(([analysesPayload, jdsPayload]) => {
        if (cancelled) return;
        setAnalyses((analysesPayload.analyses as AnalysisRow[]) ?? []);
        setJds((jdsPayload.jds as JdRow[]) ?? []);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Load failed.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const grid = useMemo(() => {
    if (!analyses || !jds) return null;
    return buildMatrix(analyses, jds);
  }, [analyses, jds]);

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <header className="border-b border-stone-200 pb-4">
        <p className="text-meta uppercase text-coral">Workspace</p>
        <h2 className="mt-1 font-serif text-display text-ink">Candidate × JD matrix</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">
          One row per distinct candidate label, one column per JD that has at least one analysis.
          Cell values are the candidate&apos;s overall score; click to open the saved analysis.
        </p>
      </header>

      <div className="mt-5">
        {error ? (
          <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>
        ) : !grid ? (
          <p className="text-sm text-steel">Loading…</p>
        ) : grid.candidates.length === 0 ? (
          <p className="rounded-md bg-paper p-4 text-sm text-steel">
            No saved runs yet. Run one from the <strong>Analyze</strong> tab; it will appear here
            once a JD slug is attached.
          </p>
        ) : grid.orderedJds.length === 0 ? (
          <p className="rounded-md bg-paper p-4 text-sm text-steel">
            Saved runs exist but none are tagged with a JD slug. Save a JD in the{" "}
            <strong>Library</strong> tab, then attach it from the <strong>Analyze</strong> tab.
          </p>
        ) : (
          <MatrixGrid grid={grid} />
        )}
      </div>
    </section>
  );
}
