"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { buildUrl } from "../tabs";

type Cell = { score: number | null; blocked: boolean };
type Candidate = { id: string; label: string; archetype: string | null };
type Position = { id: string; title: string; seniority: string; roleFamily: string };
type Matrix = {
  candidates: Candidate[];
  positions: Position[];
  cells: Cell[][];
  placements: Record<string, { stage: string; status: string }>;
};

const ARCH: Record<string, { bg: string; label: string }> = {
  bau: { bg: "bg-steel", label: "Experienced" },
  student: { bg: "bg-coral", label: "Student" },
  career_switcher: { bg: "bg-moss", label: "Switcher" },
};
const STAGE_INITIAL: Record<string, string> = {
  Sourced: "S",
  "AI-matched": "M",
  Screening: "Sc",
  Interview: "I",
  Offer: "O",
  Hired: "H",
};

// diverging score scale: poor -> coral, fair -> amber, good/strong -> moss
function cellClass(c: Cell): string {
  if (c.blocked || c.score == null) return "bg-stone-100 text-stone-300";
  const s = c.score;
  if (s < 45) return "bg-coral/15 text-coral";
  if (s < 60) return "bg-amber-100 text-amber-700";
  if (s < 72) return "bg-moss/20 text-moss";
  if (s < 85) return "bg-moss/40 text-ink";
  return "bg-moss/70 text-white";
}

export function MatrixTab() {
  const router = useRouter();
  const [data, setData] = useState<Matrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortByFit, setSortByFit] = useState(true);
  const [family, setFamily] = useState<string>("all");

  useEffect(() => {
    fetch("/api/matrix")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`matrix ${r.status}`))))
      .then((p) => {
        if (p.error) throw new Error(p.error);
        setData(p as Matrix);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed."));
  }, []);

  const families = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.positions.map((p) => p.roleFamily))].filter(Boolean).sort();
  }, [data]);

  // visible columns (role-family filter) + their original indices
  const cols = useMemo(() => {
    if (!data) return [];
    return data.positions
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => family === "all" || p.roleFamily === family);
  }, [data, family]);

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

  const open = (candId: string, posId: string) => router.push(buildUrl({ tab: "match", profile: candId, job: posId }));

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-meta uppercase text-coral">Workspace</p>
          <h2 className="mt-1 font-serif text-display text-ink">Fit matrix</h2>
          <p className="mt-1 max-w-2xl text-body text-steel">
            Every candidate scored against every open position. Colour = match strength; a ring marks candidates
            already in that position&apos;s pipeline. Click any cell to open the full match.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data ? (
            <span className="rounded-md border border-stone-200 bg-paper px-2.5 py-1 text-xs text-steel">
              {data.candidates.length} candidates × {cols.length} positions
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setSortByFit((v) => !v)}
            className="focus-ring rounded-md border border-stone-200 bg-white px-2.5 py-1 text-xs font-semibold text-ink hover:border-coral/40"
          >
            Sort: {sortByFit ? "best fit" : "A–Z"}
          </button>
        </div>
      </header>

      {families.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          {["all", ...families].map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFamily(f)}
              className={`focus-ring rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                family === f ? "bg-ink text-white" : "border border-stone-200 bg-white text-steel hover:border-coral/40"
              }`}
            >
              {f === "all" ? "All families" : f.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>
      ) : !data ? (
        <p className="text-sm text-steel">Computing the matrix…</p>
      ) : data.candidates.length === 0 || data.positions.length === 0 ? (
        <p className="rounded-md bg-paper p-4 text-sm text-steel">
          No seeded candidates or open positions yet. Positions are the jobs that appear in the pipeline.
        </p>
      ) : (
        <>
          <div className="overflow-auto rounded-lg border border-stone-200 bg-white shadow-panel" style={{ maxHeight: "70vh" }}>
            <table className="border-collapse text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-20 border-b border-r border-stone-200 bg-paper p-2 text-left font-semibold text-steel">
                    Candidate
                  </th>
                  {cols.map(({ p }) => (
                    <th
                      key={p.id}
                      title={`${p.title} · ${p.seniority}`}
                      className="sticky top-0 z-10 border-b border-stone-100 bg-paper p-1.5 align-bottom"
                    >
                      <div className="mx-auto w-[84px] truncate text-left font-semibold text-ink">{p.title}</div>
                      <div className="text-left text-[9px] uppercase text-steel">{p.seniority}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ cand, ri }) => {
                  const a = ARCH[cand.archetype ?? "bau"] ?? ARCH.bau;
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
                        const inPipe = place && place.status !== "rejected";
                        return (
                          <td key={p.id} className="border-b border-l border-stone-50 p-0">
                            <button
                              type="button"
                              onClick={() => open(cand.id, p.id)}
                              title={`${cand.label} → ${p.title}: ${c.blocked ? "blocked (KO)" : c.score}${place ? ` · in pipeline (${place.stage})` : ""}`}
                              className={`relative grid h-9 w-full place-items-center font-semibold transition-transform hover:scale-105 ${cellClass(c)} ${
                                inPipe ? "ring-2 ring-inset ring-ink/50" : ""
                              }`}
                            >
                              {c.blocked ? "–" : c.score}
                              {inPipe ? (
                                <span className="absolute right-0.5 top-0.5 text-[8px] font-bold text-ink/70">
                                  {STAGE_INITIAL[place.stage] ?? ""}
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

          <div className="flex flex-wrap items-center gap-3 text-[11px] text-steel">
            <span className="font-semibold uppercase tracking-wide">Match</span>
            {[
              ["bg-coral/15 text-coral", "<45"],
              ["bg-amber-100 text-amber-700", "45–59"],
              ["bg-moss/20 text-moss", "60–71"],
              ["bg-moss/40 text-ink", "72–84"],
              ["bg-moss/70 text-white", "85+"],
              ["bg-stone-100 text-stone-300", "blocked"],
            ].map(([cls, label]) => (
              <span key={label} className="inline-flex items-center gap-1">
                <span className={`grid h-5 w-6 place-items-center rounded ${cls} text-[9px] font-semibold`}>{label === "blocked" ? "–" : ""}</span>
                {label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1">
              <span className="h-4 w-4 rounded ring-2 ring-inset ring-ink/50" /> in pipeline
            </span>
          </div>
        </>
      )}
    </section>
  );
}
