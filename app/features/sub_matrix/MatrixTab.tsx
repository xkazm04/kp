"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { buildUrl } from "@/app/features/tabs";
import { Check, ListChecks, X } from "lucide-react";
import { ARCHETYPE_BADGE, normalizeArchetype } from "@/app/_lib/archetypes";
import { isTerminalEntryStatus } from "@/app/_lib/pipeline-status";
import { postPipelineAdd } from "@/app/_lib/useAddToPipeline";
import { cellClass, ColumnStats, MatrixLegend, type Cell } from "./MatrixShared";

type Candidate = { id: string; label: string; archetype: string | null };
type Position = { id: string; title: string; seniority: string; roleFamily: string };
type Matrix = {
  candidates: Candidate[];
  positions: Position[];
  cells: Cell[][];
  // Requested positions that couldn't be scored (job record missing) — flagged
  // so the grid never quietly omits a column the recruiter asked for.
  missing: { id: string; title: string }[];
  // Candidates whose profile failed to validate/transform — flagged (with the error)
  // so the grid never quietly omits a row, the symmetric counterpart to `missing`.
  missingCandidates: { id: string; label: string; error: string }[];
  placements: Record<string, { stage: string; status: string }>;
};

// Dot colours are pure presentation, keyed by the canonical archetype id. The id set and
// short labels come from the shared registry (ARCHETYPE_BADGE — the same source the Match
// tab uses), so a newly added archetype renders with its OWN label (and a neutral dot when
// no colour is configured) instead of silently mislabelling as bau/"Experienced".
const ARCH_DOT: Record<string, string> = {
  bau: "bg-steel",
  student: "bg-coral",
  career_switcher: "bg-moss",
};
const ARCH_DOT_FALLBACK = "bg-stone-400";

function archStyle(archetype: string | null): { bg: string; label: string } {
  const id = normalizeArchetype(archetype) || "bau"; // null/blank → the experienced default, as before
  return { bg: ARCH_DOT[id] ?? ARCH_DOT_FALLBACK, label: ARCHETYPE_BADGE[id] ?? ARCHETYPE_BADGE.bau ?? "Experienced" };
}
const STAGE_INITIAL: Record<string, string> = {
  Accepted: "A",
  Screened: "S",
  Interview: "I",
  Offer: "O",
  Hired: "H",
};

export function MatrixTab() {
  const router = useRouter();
  const search = useSearchParams();
  // When arriving from a Pipeline position ("Rank candidates"), scope the matrix
  // to that single position so it reads as a per-position ranking.
  const jobParam = search.get("job");
  const [data, setData] = useState<Matrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortByFit, setSortByFit] = useState(true);
  const [family, setFamily] = useState<string>("all");
  // Bulk shortlist from the matrix (MAT3 matrix half). In select mode a cell click
  // toggles selection instead of navigating; the action bar files every selected
  // (candidate → that position) into the pipeline in one pass. Cell key = candId|posId.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [added, setAdded] = useState<Set<string>>(() => new Set());
  const [adding, setAdding] = useState(false);
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/matrix");
        // The route returns a structured { error } body (from parseStderrError)
        // on failure — read it so the real cause reaches the screen instead of
        // an opaque status code.
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || `matrix ${r.status}`);
        if (body.error) throw new Error(body.error);
        setData(body as Matrix);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Load failed.");
      }
    })();
  }, []);

  const families = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.positions.map((p) => p.roleFamily))].filter(Boolean).sort();
  }, [data]);

  // visible columns: a single position when scoped via ?job=, otherwise the
  // role-family filter. Indices are preserved to index back into `cells`.
  const cols = useMemo(() => {
    if (!data) return [];
    const indexed = data.positions.map((p, i) => ({ p, i }));
    if (jobParam) return indexed.filter(({ p }) => p.id === jobParam);
    return indexed.filter(({ p }) => family === "all" || p.roleFamily === family);
  }, [data, family, jobParam]);

  const scopedPosition = jobParam ? data?.positions.find((p) => p.id === jobParam) ?? null : null;
  // A shared or bookmarked ?job= deep-link can outlive its position (closed or
  // filled since the link went out). Once the data is in, jobParam-with-no-match
  // means cols is empty and every reset is gated on scopedPosition — detect it so
  // we can offer a way back instead of stranding the user on a zero-column grid.
  const staleJob = Boolean(jobParam) && Boolean(data) && !scopedPosition;
  const clearJob = () => router.push(buildUrl({ tab: "matrix", job: null }, search.toString()));

  // rows sorted by best visible fit (or alphabetical)
  const rows = useMemo(() => {
    if (!data) return [];
    const colIdx = cols.map((c) => c.i);
    const best = (ri: number) =>
      Math.max(0, ...colIdx.map((ci) => data.cells[ri]?.[ci]?.score ?? -1));
    const order = data.candidates.map((cand, ri) => ({ cand, ri }));
    order.sort((a, b) =>
      sortByFit ? best(b.ri) - best(a.ri) : a.cand.label.localeCompare(b.cand.label)
    );
    return order;
  }, [data, cols, sortByFit]);

  // Per-column non-blocked scores across the whole candidate pool (MAT2) — the
  // distribution the header strip summarizes. Keyed by the position's index into
  // `cells` so it lines up with the rendered columns.
  const colScores = useMemo(() => {
    const out: Record<number, number[]> = {};
    if (!data) return out;
    for (const { i } of cols) {
      const scores: number[] = [];
      for (let ri = 0; ri < data.candidates.length; ri += 1) {
        const c = data.cells[ri]?.[i];
        if (c && !c.blocked && c.score != null) scores.push(c.score);
      }
      out[i] = scores;
    }
    return out;
  }, [data, cols]);

  const open = (candId: string, posId: string) => router.push(buildUrl({ tab: "match", profile: candId, job: posId }, search.toString()));

  const cellKey = (candId: string, posId: string) => `${candId}|${posId}`;
  const toggleCell = (candId: string, posId: string) =>
    setSelected((s) => {
      const k = cellKey(candId, posId);
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  // File every selected (candidate → position) into the pipeline at Screened, in
  // one pass — sequentially, reusing the canonical postPipelineAdd so this surface
  // can't drift from the Match-side add. Successes ring locally (the matrix doesn't
  // refetch placements); failures stay selected for a one-click retry. The score is
  // looked up from `cells` by the candidate row + position column at add time.
  const addSelected = async () => {
    if (adding || !data || selected.size === 0) return;
    setAdding(true);
    const failed = new Set<string>();
    let ok = 0;
    for (const key of selected) {
      const [candId, posId] = key.split("|");
      const cand = data.candidates.find((c) => c.id === candId);
      const pos = data.positions.find((p) => p.id === posId);
      if (!cand || !pos) {
        failed.add(key);
        continue;
      }
      const ri = data.candidates.findIndex((c) => c.id === candId);
      const ci = data.positions.findIndex((p) => p.id === posId);
      const score = data.cells[ri]?.[ci]?.score ?? null;
      const res = await postPipelineAdd(pos.id, pos.title, {
        candidateId: cand.id,
        candidateLabel: cand.label,
        archetype: cand.archetype,
        matchScore: score,
        roleFamily: pos.roleFamily,
      });
      if (res.ok) {
        ok += 1;
        setAdded((a) => new Set(a).add(key));
      } else {
        failed.add(key);
      }
    }
    setSelected(failed);
    setAnnounce(
      failed.size === 0
        ? `Added ${ok} candidate${ok === 1 ? "" : "s"} to the pipeline.`
        : `Added ${ok}; ${failed.size} failed — still selected for retry.`
    );
    setAdding(false);
  };

  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-meta uppercase text-coral">Workspace</p>
          <h2 className="mt-1 font-serif text-display text-ink">Fit matrix</h2>
          <p className="mt-1 max-w-2xl text-body text-steel">
            {staleJob
              ? "The link you followed points to a position that is no longer open."
              : scopedPosition
              ? `Candidates ranked by fit for ${scopedPosition.title}. Colour = match strength; a ring marks candidates already in this position's pipeline.`
              : "Every candidate scored against every open position. Colour = match strength; a ring marks candidates already in that position's pipeline. Click any cell to open the full match."}
          </p>
        </div>
        {!staleJob ? (
          <div className="flex items-center gap-2">
            {data ? (
              <span className="rounded-md border border-stone-200 bg-paper px-2.5 py-1 text-sm text-steel">
                {data.candidates.length} candidates × {cols.length} positions
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setSortByFit((v) => !v)}
              className="focus-ring rounded-md border border-stone-200 bg-white px-2.5 py-1 text-sm font-semibold text-ink hover:border-coral/40"
            >
              Sort: {sortByFit ? "best fit" : "A–Z"}
            </button>
            {data && data.candidates.length > 0 ? (
              <button
                type="button"
                onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
                aria-pressed={selectMode}
                className={`focus-ring inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-semibold ${
                  selectMode ? "border-coral bg-coral/10 text-coral" : "border-stone-200 bg-white text-ink hover:border-coral/40"
                }`}
                title="Select cells to add multiple candidates to the pipeline at once"
              >
                <ListChecks size={14} /> {selectMode ? "Done selecting" : "Shortlist"}
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      <p role="status" aria-live="polite" className="sr-only">{announce}</p>

      {selectMode ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-coral/30 bg-coral/5 px-3 py-2">
          <span className="text-sm font-semibold text-ink">
            {selected.size > 0 ? `${selected.size} selected` : "Tap cells to shortlist"}
          </span>
          <button
            type="button"
            onClick={addSelected}
            disabled={selected.size === 0 || adding}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-ink/90 disabled:opacity-40"
          >
            <Check size={14} /> {adding ? "Adding…" : selected.size > 0 ? `Add ${selected.size} to pipeline` : "Add to pipeline"}
          </button>
          {selected.size > 0 ? (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              disabled={adding}
              className="focus-ring inline-flex h-8 items-center rounded-md px-2 text-sm font-semibold text-steel hover:text-ink disabled:opacity-40"
            >
              Clear
            </button>
          ) : null}
          <button
            type="button"
            onClick={exitSelect}
            className="focus-ring ml-auto inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm font-semibold text-steel hover:text-ink"
          >
            <X size={13} /> Exit
          </button>
          <span className="w-full text-meta text-steel">
            Each tick files that candidate into the position&apos;s pipeline (Screened). Blocked / already-in-pipeline cells can&apos;t be selected.
          </span>
        </div>
      ) : null}

      {scopedPosition ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-coral/10 px-2.5 py-1 text-sm font-semibold text-coral">
            Ranking for {scopedPosition.title}
          </span>
          <button
            type="button"
            onClick={clearJob}
            className="focus-ring rounded-full border border-stone-200 bg-white px-2.5 py-1 text-sm font-semibold text-steel hover:border-coral/40"
          >
            Show all positions
          </button>
        </div>
      ) : !staleJob && families.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          {["all", ...families].map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFamily(f)}
              className={`focus-ring rounded-full px-2.5 py-1 text-sm font-semibold transition-colors ${
                family === f ? "bg-ink text-white" : "border border-stone-200 bg-white text-steel hover:border-coral/40"
              }`}
            >
              {f === "all" ? "All families" : f.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      ) : null}

      {data && data.missing.length > 0 ? (
        <p className="rounded-md border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-800">
          <span className="font-semibold">
            {data.missing.length} requested {data.missing.length === 1 ? "position" : "positions"} could not be scored
          </span>{" "}
          and {data.missing.length === 1 ? "is" : "are"} omitted from the grid (no matching job record):{" "}
          {data.missing.map((m) => m.title).join(", ")}.
        </p>
      ) : null}

      {data && data.missingCandidates.length > 0 ? (
        <p className="rounded-md border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-800">
          <span className="font-semibold">
            {data.missingCandidates.length} {data.missingCandidates.length === 1 ? "candidate" : "candidates"} could not be scored
          </span>{" "}
          and {data.missingCandidates.length === 1 ? "is" : "are"} omitted from the grid (profile failed to
          load). Hover a name for the reason:{" "}
          {data.missingCandidates.map((m, i) => (
            <span key={m.id}>
              {i > 0 ? ", " : ""}
              <span title={m.error} className="cursor-help underline decoration-dotted decoration-amber-400">
                {m.label}
              </span>
            </span>
          ))}
          .
        </p>
      ) : null}

      {error ? (
        <p className="rounded-md bg-red-50 p-3 text-base text-red-700">{error}</p>
      ) : !data ? (
        <p className="text-base text-steel">Computing the matrix…</p>
      ) : staleJob ? (
        <div className="rounded-lg border border-stone-200 bg-paper p-8 text-center shadow-panel">
          <p className="font-serif text-xl text-ink">Position no longer open</p>
          <p className="mx-auto mt-2 max-w-md text-base text-steel">
            It was closed or filled after this link was shared, so its candidate ranking isn&apos;t
            available. Other positions are still ranked.
          </p>
          <button
            type="button"
            onClick={clearJob}
            className="focus-ring mt-5 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink/90"
          >
            Show all positions
          </button>
        </div>
      ) : data.candidates.length === 0 || data.positions.length === 0 ? (
        <p className="rounded-md bg-paper p-4 text-base text-steel">
          No seeded candidates or open positions yet. Positions are the jobs that appear in the pipeline.
        </p>
      ) : (
        <>
          <div className="overflow-auto rounded-lg border border-stone-200 bg-white shadow-panel" style={{ maxHeight: "70vh" }}>
            <table className="border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-20 border-b border-r border-stone-200 bg-paper p-2 text-left font-semibold text-steel">
                    Candidate
                  </th>
                  {cols.map(({ p, i }) => (
                    <th
                      key={p.id}
                      title={`${p.title} · ${p.seniority}`}
                      className="sticky top-0 z-10 border-b border-stone-100 bg-paper p-1.5 align-bottom"
                    >
                      <div className="mx-auto w-[84px] truncate text-left font-semibold text-ink">{p.title}</div>
                      <div className="text-left text-sm uppercase text-steel">{p.seniority}</div>
                      <ColumnStats scores={colScores[i] ?? []} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ cand, ri }) => {
                  const a = archStyle(cand.archetype);
                  return (
                    <tr key={cand.id} className="hover:bg-paper/40">
                      <td className="sticky left-0 z-10 border-b border-r border-stone-100 bg-white p-2">
                        <div className="flex items-center gap-1.5">
                          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${a.bg}`} title={a.label} />
                          <span className="w-[120px] truncate font-medium text-ink">{cand.label}</span>
                        </div>
                      </td>
                      {cols.map(({ p, i }) => {
                        const c = data.cells[ri]?.[i] ?? { score: null, blocked: true };
                        const place = data.placements[`${cand.id}|${p.id}`];
                        // "In the pipeline" = placed and not in a terminal state.
                        // Must exclude `declined` as well as `rejected`, else a
                        // candidate who turned us down still rings as in-flight.
                        const inPipe = place && !isTerminalEntryStatus(place.status);
                        const key = `${cand.id}|${p.id}`;
                        const wasAdded = added.has(key);
                        const ringed = inPipe || wasAdded;
                        // Selectable only when there's something to add: a scored
                        // (non-blocked) cell that isn't already in the pipeline / just added.
                        const selectable = selectMode && !c.blocked && !ringed;
                        const isSel = selected.has(key);
                        return (
                          <td key={p.id} className="border-b border-l border-stone-50 p-0">
                            <button
                              type="button"
                              onClick={() => (selectMode ? selectable && toggleCell(cand.id, p.id) : open(cand.id, p.id))}
                              disabled={selectMode && !selectable}
                              title={
                                selectMode
                                  ? selectable
                                    ? `${isSel ? "Deselect" : "Select"} ${cand.label} → ${p.title}`
                                    : `${cand.label} → ${p.title}: ${c.blocked ? "blocked (KO)" : ringed ? "already in pipeline" : ""}`
                                  : `${cand.label} → ${p.title}: ${c.blocked ? "blocked (KO)" : c.score}${place ? ` · in pipeline (${place.stage})` : ""}`
                              }
                              aria-label={`${cand.label} to ${p.title}: ${c.blocked ? "blocked" : `match ${c.score}`}${ringed ? ", in pipeline" : ""}${selectMode && selectable ? (isSel ? " — selected" : " — selectable") : ""}`}
                              aria-pressed={selectMode ? isSel : undefined}
                              className={`relative grid h-9 w-full place-items-center font-semibold transition-transform ${
                                selectMode ? (selectable ? "cursor-pointer" : "cursor-default opacity-50") : "hover:scale-105"
                              } ${cellClass(c)} ${
                                isSel ? "ring-2 ring-inset ring-coral" : ringed ? "ring-2 ring-inset ring-ink/50" : ""
                              }`}
                            >
                              {c.blocked ? "–" : c.score}
                              {isSel ? (
                                <span className="absolute right-0.5 top-0.5"><Check size={11} className="text-coral" /></span>
                              ) : ringed ? (
                                <span className="absolute right-0.5 top-0.5 text-sm font-bold text-ink/70">
                                  {wasAdded && !inPipe ? "+" : STAGE_INITIAL[place?.stage ?? ""] ?? ""}
                                </span>
                              ) : null}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <MatrixLegend />
        </>
      )}
    </section>
  );
}
