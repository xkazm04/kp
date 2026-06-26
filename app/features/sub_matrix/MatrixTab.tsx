"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { buildUrl } from "@/app/features/tabs";
import { AlertTriangle, Check, Download, ExternalLink, ListChecks, Sparkles, X } from "lucide-react";
import type { Reasoning } from "@/app/features/sub_match/MatchTypes";
import { normalizeArchetype } from "@/app/_lib/archetypes";
import { isTerminalEntryStatus } from "@/app/_lib/pipeline-status";
import { postPipelineAdd } from "@/app/_lib/useAddToPipeline";
import { downloadFile, toCsv } from "@/app/_lib/export-utils";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { cellClass, ColumnStats, MatrixLegend, type Cell } from "./MatrixShared";
import { ChainEmptyState } from "@/app/_components/ChainEmptyState";
import { Skeleton } from "@/app/_components/Skeleton";
import { CompletionCta } from "@/app/_components/CompletionCta";
import { STRONG_THRESHOLD } from "./matrix-stats";

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

// Returns the dot colour + the canonical archetype id; the display label is
// resolved via useEnumLabel("archetype", id) at the call site.
function archStyle(archetype: string | null): { bg: string; id: string } {
  const id = normalizeArchetype(archetype) || "bau"; // null/blank → the experienced default, as before
  return { bg: ARCH_DOT[id] ?? ARCH_DOT_FALLBACK, id };
}
const STAGE_INITIAL: Record<string, string> = {
  Accepted: "A",
  Screened: "S",
  Interview: "I",
  Offer: "O",
  Hired: "H",
};

type ReasonState = { loading?: boolean; error?: string; data?: Reasoning; source?: string; cached?: boolean };
type Popover = { candId: string; posId: string; cand: Candidate; pos: Position; cell: Cell; rect: { top: number; left: number } };

export function MatrixTab() {
  const t = useTranslations("matrix");
  const locale = useLocale();
  const enumLabel = useEnumLabel();
  // deec915c — on-demand "why this score" popover. A cell click opens a card that
  // lazily fetches /api/match/reasoning for the (candidate, job) pair (the matrix
  // candidate id IS a profileId, which writeMatchInput resolves) and shows the
  // cached verdict/strengths/gaps/probes inline — no tab switch to read the score.
  const [popover, setPopover] = useState<Popover | null>(null);
  const [reasoning, setReasoning] = useState<Record<string, ReasonState>>({});
  // MAT2 — name the hard gate(s) behind a blocked cell. "Blocked: language"
  // and "blocked: seniority" demand opposite recruiter actions (renegotiate vs
  // skip); the bare dash hid that. Localized by the stable KoReason.key; cells
  // from an older cached grid without koKeys fall back to the generic label.
  const blockedLabel = (c: { koKeys?: string[] }) => {
    const keys = c.koKeys ?? [];
    if (keys.length === 0) return t("blockedKo");
    const reasons = keys
      .map((k) => {
        const msgKey = `ko.${k}` as Parameters<typeof t>[0];
        return t.has(msgKey) ? t(msgKey) : k;
      })
      .join(", ");
    return t("blockedKoNamed", { reasons });
  };
  const router = useRouter();
  const search = useSearchParams();
  // When arriving from a Pipeline position ("Rank candidates"), scope the matrix
  // to that single position so it reads as a per-position ranking.
  const jobParam = search.get("job");
  const [data, setData] = useState<Matrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortByFit, setSortByFit] = useState(true);
  const [family, setFamily] = useState<string>("all");
  // MAT6: a fit floor that hides candidate rows whose best visible score is below
  // it (0 = off), and an optional sort by a chosen position column (its original
  // index, or null = the fit/A–Z toggle). On a real pool the grid is mostly weak
  // cells; these make the strong candidates jump out.
  const [minFit, setMinFit] = useState(0);
  const [sortCol, setSortCol] = useState<number | null>(null);
  // Bulk shortlist from the matrix (MAT3 matrix half). In select mode a cell click
  // toggles selection instead of navigating; the action bar files every selected
  // (candidate → that position) into the pipeline in one pass. Cell key = candId|posId.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [added, setAdded] = useState<Set<string>>(() => new Set());
  const [adding, setAdding] = useState(false);
  const [announce, setAnnounce] = useState("");
  // Last bulk-add outcome — drives the visible completion band (the sr-only
  // announce stays for screen readers; sighted users got nothing before).
  const [lastAdd, setLastAdd] = useState<{ ok: number; failed: number } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/matrix");
        // The route returns a structured { error } body (from parseStderrError)
        // on failure — read it so the real cause reaches the screen instead of
        // an opaque status code.
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || t("loadFailedStatus", { status: r.status }));
        if (body.error) throw new Error(body.error);
        setData(body as Matrix);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("loadFailed"));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc closes the reasoning popover (deec915c).
  useEffect(() => {
    if (!popover) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopover(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popover]);

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

  // rows: best-visible-fit sort by default, A–Z when toggled, or by a chosen
  // column's score when a header is clicked (MAT6); filtered to the min-fit floor.
  const rows = useMemo(() => {
    if (!data) return [];
    const colIdx = cols.map((c) => c.i);
    const best = (ri: number) =>
      Math.max(0, ...colIdx.map((ci) => data.cells[ri]?.[ci]?.score ?? -1));
    let order = data.candidates.map((cand, ri) => ({ cand, ri }));
    // Fit floor: keep only candidates whose best VISIBLE score clears it, so a
    // family filter or scoped view applies the floor to what's actually shown.
    if (minFit > 0) order = order.filter(({ ri }) => best(ri) >= minFit);
    // Only honor a column sort while that column is visible (a family filter can
    // hide the sorted column); otherwise fall back to the fit/A–Z toggle.
    const byCol = sortCol != null && colIdx.includes(sortCol) ? (ri: number) => data.cells[ri]?.[sortCol]?.score ?? -1 : null;
    order.sort((a, b) =>
      byCol
        ? byCol(b.ri) - byCol(a.ri)
        : sortByFit
        ? best(b.ri) - best(a.ri)
        : a.cand.label.localeCompare(b.cand.label)
    );
    return order;
  }, [data, cols, sortByFit, minFit, sortCol]);

  // MAT2 row counterpart: how many VISIBLE roles each candidate is a strong fit
  // for (score >= STRONG_THRESHOLD) — a versatile-vs-niche read per candidate,
  // mirroring the per-column strong count. Keyed by candidate row index.
  const rowStrong = useMemo(() => {
    const out: Record<number, number> = {};
    if (!data) return out;
    const colIdx = cols.map((c) => c.i);
    for (let ri = 0; ri < data.candidates.length; ri += 1) {
      let n = 0;
      for (const ci of colIdx) {
        const s = data.cells[ri]?.[ci]?.score;
        if (s != null && s >= STRONG_THRESHOLD) n += 1;
      }
      out[ri] = n;
    }
    return out;
  }, [data, cols]);

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

  // Coverage rollup (the value prop the context is named for): which OPEN roles have
  // ZERO strong fits in the pool. The per-column strong counts already exist (colScores
  // + STRONG_THRESHOLD); nothing surfaced "3 of 8 roles have no strong candidate — source
  // for these". Pure presentation over data already on the client.
  const coverage = useMemo(() => {
    const uncovered: string[] = [];
    for (const { p, i } of cols) {
      const strong = (colScores[i] ?? []).filter((s) => s >= STRONG_THRESHOLD).length;
      if (strong === 0) uncovered.push(p.title);
    }
    return { uncovered, total: cols.length };
  }, [cols, colScores]);

  const open = (candId: string, posId: string) => router.push(buildUrl({ tab: "match", profile: candId, job: posId }, search.toString()));

  // deec915c — lazily fetch (and cache) the reasoning for a (candidate, job) pair.
  const fetchReasoning = (candId: string, posId: string) => {
    const key = `${candId}|${posId}`;
    setReasoning((cur) => {
      if (cur[key]?.data || cur[key]?.loading) return cur; // already loaded / in flight
      void fetch("/api/match/reasoning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: candId, jobId: posId, lang: locale }),
      })
        .then(async (r) => {
          const p = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(p.error || t("reasoningFailed"));
          return p as { reasoning?: Reasoning; source?: string; cached?: boolean };
        })
        .then((p) => setReasoning((s) => ({ ...s, [key]: { data: p.reasoning, source: p.source, cached: p.cached } })))
        .catch((e) => setReasoning((s) => ({ ...s, [key]: { error: e instanceof Error ? e.message : t("reasoningFailed") } })));
      return { ...cur, [key]: { loading: true } };
    });
  };

  // Open the popover anchored under the clicked cell (viewport-fixed from its rect),
  // and kick off the reasoning fetch for a scored cell. A blocked cell shows its KO
  // reason instead — there's no fit rationale to fetch.
  const openCell = (cand: Candidate, pos: Position, cell: Cell, ev: React.MouseEvent<HTMLButtonElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const W = 320;
    const left = Math.min(Math.max(8, r.left), (typeof window !== "undefined" ? window.innerWidth : 1024) - W - 8);
    const top = Math.min(r.bottom + 6, (typeof window !== "undefined" ? window.innerHeight : 768) - 340);
    setPopover({ candId: cand.id, posId: pos.id, cand, pos, cell, rect: { top, left } });
    if (!cell.blocked) fetchReasoning(cand.id, pos.id);
  };

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
      const score = ri >= 0 && ci >= 0 ? data.cells[ri]?.[ci]?.score ?? null : null;
      // A selectable cell always carries a real score, so a null here means the index
      // lookup missed (e.g. a duplicate id in candidates/positions). Fail the add rather
      // than silently filing the candidate with a null/incorrect match score.
      if (score == null) {
        failed.add(key);
        continue;
      }
      const res = await postPipelineAdd(pos.id, pos.title, {
        source: "matrix",
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
        ? t("addedAnnounce", { count: ok })
        : t("addedPartial", { ok, failed: failed.size })
    );
    setLastAdd({ ok, failed: failed.size });
    setAdding(false);
  };

  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  // Export the grid AS SHOWN (MAT4 matrix half): the visible columns × the
  // filtered+sorted rows, so the CSV matches the recruiter's current view. Blocked
  // / unscored cells render as "–", matching the on-screen cell. Built from data
  // already on screen via the shared toCsv/downloadFile — no backend call.
  const exportCsv = () => {
    if (!data) return;
    const header = [t("csvCandidate"), ...cols.map(({ p }) => p.title)];
    const body = rows.map(({ cand, ri }) => [
      cand.label,
      ...cols.map(({ i }) => {
        const c = data.cells[ri]?.[i];
        return c && !c.blocked && c.score != null ? c.score : "–";
      }),
    ]);
    const name = scopedPosition ? `fit-${scopedPosition.title}` : "fit-matrix";
    downloadFile(`${name.replace(/[^\w-]+/g, "_").slice(0, 60)}.csv`, toCsv([header, ...body]), "text/csv");
  };

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
          <h2 className="mt-1 font-serif text-display text-ink">{t("title")}</h2>
          <p className="mt-1 max-w-2xl text-body text-steel">
            {staleJob
              ? t("introStale")
              : scopedPosition
              ? t("introScoped", { title: scopedPosition.title })
              : t("introDefault")}
          </p>
        </div>
        {!staleJob ? (
          <div className="flex items-center gap-2">
            {data ? (
              <span className="rounded-md border border-stone-200 bg-paper px-2.5 py-1 text-sm text-steel">
                {t("countLine", {
                  cands: minFit > 0 ? t("ofCount", { shown: rows.length, total: data.candidates.length }) : `${data.candidates.length}`,
                  positions: cols.length,
                })}
              </span>
            ) : null}
            {/* Min-fit floor (MAT6): hide candidates whose best visible fit is
                below the threshold so a noisy grid shows only the promising rows. */}
            {data && data.candidates.length > 0 ? (
              <div className="inline-flex items-center overflow-hidden rounded-md border border-stone-200 bg-white text-sm font-semibold">
                <span className="px-2 py-1 text-steel">{t("minFit")}</span>
                {[0, 55, 70].map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setMinFit(lvl)}
                    aria-pressed={minFit === lvl}
                    className={`focus-ring border-l border-stone-200 px-2.5 py-1 ${minFit === lvl ? "bg-ink text-white" : "text-ink hover:bg-paper"}`}
                  >
                    {lvl === 0 ? t("off") : `≥${lvl}`}
                  </button>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setSortCol(null); // an explicit fit/A–Z choice overrides a column sort
                setSortByFit((v) => !v);
              }}
              className="focus-ring rounded-md border border-stone-200 bg-white px-2.5 py-1 text-sm font-semibold text-ink hover:border-coral/40"
            >
              {t("sortLabel", { mode: sortCol != null ? t("sortByCol") : sortByFit ? t("sortBestFit") : t("sortAz") })}
            </button>
            {data && data.candidates.length > 0 ? (
              <button
                type="button"
                onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
                aria-pressed={selectMode}
                className={`focus-ring inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-semibold ${
                  selectMode ? "border-coral bg-coral/10 text-coral" : "border-stone-200 bg-white text-ink hover:border-coral/40"
                }`}
                title={t("shortlistTitle")}
              >
                <ListChecks size={14} /> {selectMode ? t("doneSelecting") : t("shortlist")}
              </button>
            ) : null}
            {data && data.candidates.length > 0 && rows.length > 0 ? (
              <button
                type="button"
                onClick={exportCsv}
                className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 py-1 text-sm font-semibold text-ink hover:border-coral/40"
                title={t("exportTitle")}
              >
                <Download size={14} className="text-steel" /> {t("exportCsv")}
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      {/* Coverage gap — the headline talent-intelligence signal: open roles with no
          strong fit. Only meaningful across ≥2 columns (a single scoped role is trivial). */}
      {!scopedPosition && coverage.total >= 2 && coverage.uncovered.length > 0 ? (
        <div role="status" className="mt-3 flex flex-wrap items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-700" aria-hidden />
          <p className="text-amber-900">
            <span className="font-semibold">{t("coverageGap", { uncovered: coverage.uncovered.length, total: coverage.total })}</span>{" "}
            <span className="text-amber-800">{coverage.uncovered.join(", ")}</span>
          </p>
        </div>
      ) : null}

      <p role="status" aria-live="polite" className="sr-only">{announce}</p>

      {/* Bulk-add used to complete with no visible trace — say what was filed
          and link to the board where the new entries actually landed. */}
      {lastAdd && lastAdd.ok > 0 ? (
        <CompletionCta
          message={
            lastAdd.failed === 0
              ? t("addedAnnounce", { count: lastAdd.ok })
              : t("addedPartial", { ok: lastAdd.ok, failed: lastAdd.failed })
          }
          links={[{ label: t("addedBannerCta"), tab: "pipeline" }]}
          onDismiss={() => setLastAdd(null)}
          dismissLabel={t("addedDismiss")}
        />
      ) : null}

      {selectMode ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-coral/30 bg-coral/5 px-3 py-2">
          <span className="text-sm font-semibold text-ink">
            {selected.size > 0 ? t("selectedCount", { count: selected.size }) : t("tapToShortlist")}
          </span>
          <button
            type="button"
            onClick={addSelected}
            disabled={selected.size === 0 || adding}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-ink/90 disabled:opacity-40"
          >
            <Check size={14} /> {adding ? t("adding") : selected.size > 0 ? t("addN", { count: selected.size }) : t("addToPipeline")}
          </button>
          {selected.size > 0 ? (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              disabled={adding}
              className="focus-ring inline-flex h-8 items-center rounded-md px-2 text-sm font-semibold text-steel hover:text-ink disabled:opacity-40"
            >
              {t("clear")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={exitSelect}
            className="focus-ring ml-auto inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm font-semibold text-steel hover:text-ink"
          >
            <X size={13} /> {t("exit")}
          </button>
          <span className="w-full text-meta text-steel">{t("selectHint")}</span>
        </div>
      ) : null}

      {scopedPosition ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-coral/10 px-2.5 py-1 text-sm font-semibold text-coral">
            {t("rankingFor", { title: scopedPosition.title })}
          </span>
          <button
            type="button"
            onClick={clearJob}
            className="focus-ring rounded-full border border-stone-200 bg-white px-2.5 py-1 text-sm font-semibold text-steel hover:border-coral/40"
          >
            {t("showAll")}
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
              {f === "all" ? t("allFamilies") : enumLabel("family", f)}
            </button>
          ))}
        </div>
      ) : null}

      {data && data.missing.length > 0 ? (
        <p className="rounded-md border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-800">
          {t.rich("missingPositions", {
            count: data.missing.length,
            titles: data.missing.map((m) => m.title).join(", "),
            b: (chunks) => <span className="font-semibold">{chunks}</span>,
          })}
        </p>
      ) : null}

      {data && data.missingCandidates.length > 0 ? (
        <p className="rounded-md border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-800">
          {t.rich("missingCandidatesPrefix", {
            count: data.missingCandidates.length,
            b: (chunks) => <span className="font-semibold">{chunks}</span>,
          })}
          {data.missingCandidates.map((m, i) => (
            <span key={m.id}>
              {i > 0 ? ", " : ""}
              <span title={m.error} className="cursor-help underline decoration-dotted decoration-amber-400">
                {m.label}
              </span>
            </span>
          ))}
          {"."}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-md bg-red-50 p-3 text-base text-red-700">{error}</p>
      ) : !data ? (
        <div aria-busy="true" aria-label={t("computing")} className="space-y-2">
          <Skeleton className="h-8 w-56" />
          <div className="space-y-1.5 rounded-lg border border-stone-200 bg-white p-2 shadow-panel">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </div>
      ) : staleJob ? (
        <div className="rounded-lg border border-stone-200 bg-paper p-8 text-center shadow-panel">
          <p className="font-serif text-xl text-ink">{t("staleTitle")}</p>
          <p className="mx-auto mt-2 max-w-md text-base text-steel">{t("staleBody")}</p>
          <button
            type="button"
            onClick={clearJob}
            className="focus-ring mt-5 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink/90"
          >
            {t("showAll")}
          </button>
        </div>
      ) : data.candidates.length === 0 || data.positions.length === 0 ? (
        <ChainEmptyState
          title={t("emptyGrid")}
          links={[
            { tab: "pipeline", label: t("emptyGridCtaPipeline") },
            { tab: "jobs", label: t("emptyGridCtaJobs") },
          ]}
        />
      ) : rows.length === 0 || cols.length === 0 ? (
        // The dataset has candidates/positions, but the min-fit floor or family filter
        // hid them all — show a recoverable empty state instead of sticky headers over
        // a blank tbody (which read as a broken grid).
        <div className="rounded-lg border border-stone-200 bg-paper p-8 text-center shadow-panel">
          <p className="font-serif text-xl text-ink">{t("filteredEmptyTitle")}</p>
          <p className="mx-auto mt-2 max-w-md text-base text-steel">{t("filteredEmptyBody")}</p>
          <button
            type="button"
            onClick={() => {
              setMinFit(0);
              setFamily("all");
            }}
            className="focus-ring mt-5 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink/90"
          >
            {t("clearFilters")}
          </button>
        </div>
      ) : (
        <>
          <div className="overflow-auto rounded-lg border border-stone-200 bg-white shadow-panel" style={{ maxHeight: "70vh" }}>
            <table className="border-collapse text-sm">
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 top-0 z-20 border-b border-r border-stone-200 bg-paper p-2 text-left font-semibold text-steel">
                    {t("candidateHeader")}
                  </th>
                  {cols.map(({ p, i }) => (
                    <th
                      key={p.id}
                      scope="col"
                      className={`sticky top-0 z-10 border-b bg-paper p-1.5 align-bottom ${sortCol === i ? "border-coral" : "border-stone-100"}`}
                    >
                      {/* Click a column to rank candidates by their fit for THAT role
                          (MAT6); click again to clear back to best-overall. */}
                      <button
                        type="button"
                        onClick={() => setSortCol((cur) => (cur === i ? null : i))}
                        aria-pressed={sortCol === i}
                        title={t("colTitle", { title: p.title, seniority: enumLabel("seniority", p.seniority), action: sortCol === i ? t("colSortingClear") : t("colClickSort") })}
                        className="focus-ring block w-[84px] rounded text-left hover:text-coral"
                      >
                        <span className={`block truncate font-semibold ${sortCol === i ? "text-coral" : "text-ink"}`}>
                          {sortCol === i ? "▼ " : ""}{p.title}
                        </span>
                        <span className="block text-sm uppercase text-steel">{enumLabel("seniority", p.seniority)}</span>
                      </button>
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
                      <th scope="row" className="sticky left-0 z-10 border-b border-r border-stone-100 bg-white p-2 text-left font-normal">
                        <div className="flex items-center gap-1.5">
                          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${a.bg}`} title={enumLabel("archetype", a.id)} />
                          <span className="w-[120px] truncate font-medium text-ink">{cand.label}</span>
                          {/* MAT2 row counterpart: strong-fit count across visible roles. */}
                          {rowStrong[ri] > 0 ? (
                            <span
                              className="ml-auto shrink-0 rounded-full bg-moss/10 px-1.5 text-meta font-semibold text-moss nums"
                              title={t("strongFitTitle", { threshold: STRONG_THRESHOLD, count: rowStrong[ri], total: cols.length })}
                            >
                              {`${rowStrong[ri]}★`}
                            </span>
                          ) : null}
                        </div>
                      </th>
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
                              onClick={(ev) => (selectMode ? selectable && toggleCell(cand.id, p.id) : openCell(cand, p, c, ev))}
                              disabled={selectMode && !selectable}
                              title={
                                selectMode
                                  ? selectable
                                    ? t("cellSelectTitle", { action: isSel ? t("deselect") : t("select"), cand: cand.label, pos: p.title })
                                    : t("cellBlockedTitle", { cand: cand.label, pos: p.title, reason: c.blocked ? blockedLabel(c) : ringed ? t("alreadyInPipe") : "" })
                                  : t("cellTitle", { cand: cand.label, pos: p.title, val: c.blocked ? blockedLabel(c) : c.score ?? 0, place: place ? t("inPipelineStage", { stage: enumLabel("stage", place.stage) }) : "" })
                              }
                              aria-label={t("cellAria", {
                                cand: cand.label,
                                pos: p.title,
                                val: c.blocked ? blockedLabel(c) : t("matchVal", { score: c.score ?? 0 }),
                                ring: ringed ? t("inPipelineSuffix") : "",
                                sel: selectMode && selectable ? (isSel ? t("selectedSuffix") : t("selectableSuffix")) : "",
                              })}
                              aria-pressed={selectMode ? isSel : undefined}
                              className={`relative grid h-9 w-full place-items-center font-semibold transition-transform ${
                                selectMode
                                  ? selectable
                                    ? "cursor-pointer"
                                    : "cursor-default opacity-50"
                                  : // Spark Dark: a browsed cell pops like a peeled sticker
                                    // (tilt + hard shadow over its neighbors) instead of the
                                    // light register's flat zoom.
                                    "hover:scale-105 dark:hover:z-10 dark:hover:-rotate-2 dark:hover:scale-110 dark:hover:shadow-sticker-xs"
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

      {/* deec915c — the on-demand reasoning popover. Anchored under the clicked
          cell (viewport-fixed); a full-screen catcher closes it on outside click. */}
      {popover ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPopover(null)} aria-hidden />
          <div
            role="dialog"
            aria-label={t("popoverAria", { cand: popover.cand.label, pos: popover.pos.title })}
            className="fixed z-50 max-h-[60vh] w-80 overflow-y-auto rounded-lg border border-stone-200 bg-white p-3 text-sm shadow-panel"
            style={{ top: popover.rect.top, left: popover.rect.left }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1 truncate font-semibold text-ink">
                  <Sparkles size={13} className="shrink-0 text-coral" /> {popover.cand.label}
                </p>
                <p className="truncate text-steel">
                  {popover.pos.title}
                  {!popover.cell.blocked && popover.cell.score != null ? ` · ${t("matchVal", { score: popover.cell.score })}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPopover(null)}
                aria-label={t("closePopover")}
                className="focus-ring shrink-0 rounded p-0.5 text-steel hover:text-ink"
              >
                <X size={14} />
              </button>
            </div>

            <div className="mt-2">
              {popover.cell.blocked ? (
                <p className="text-amber-800">{blockedLabel(popover.cell)}</p>
              ) : (
                (() => {
                  const st = reasoning[`${popover.candId}|${popover.posId}`];
                  if (!st || st.loading) return <p className="text-steel">{t("reasoningLoading")}</p>;
                  if (st.error) return <p className="text-red-700">{st.error}</p>;
                  const d = st.data;
                  if (!d) return <p className="text-steel">{t("noReasoning")}</p>;
                  return (
                    <div className="space-y-2">
                      {d.verdict ? <p className="text-ink">{d.verdict}</p> : null}
                      {d.strengths?.length ? (
                        <div>
                          <p className="text-meta font-semibold uppercase text-moss">{t("strengths")}</p>
                          <ul className="list-disc pl-4 text-steel">
                            {d.strengths.slice(0, 4).map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {d.gaps?.length ? (
                        <div>
                          <p className="text-meta font-semibold uppercase text-coral">{t("gaps")}</p>
                          <ul className="list-disc pl-4 text-steel">
                            {d.gaps.slice(0, 4).map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {d.interviewProbes?.length ? (
                        <div>
                          <p className="text-meta font-semibold uppercase text-steel">{t("probes")}</p>
                          <ul className="list-disc pl-4 text-steel">
                            {d.interviewProbes.slice(0, 3).map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {st.source && st.source !== "llm" ? (
                        <p className="text-meta text-stone-400">{t("reasoningDeterministic")}</p>
                      ) : null}
                    </div>
                  );
                })()
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                open(popover.candId, popover.posId);
                setPopover(null);
              }}
              className="focus-ring mt-3 inline-flex items-center gap-1 font-semibold text-coral hover:underline"
            >
              {t("viewFullMatch")} <ExternalLink size={12} />
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
