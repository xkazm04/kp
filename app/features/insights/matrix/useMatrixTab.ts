// All state, effects, memoized derivations and handlers for the Fit Matrix tab,
// extracted from MatrixTab.tsx into one hook so the component file itself stays
// under the 200-line cap (kept as .ts — no JSX in this module).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { buildUrl } from "@/app/features/shell/tabs";
import type { Reasoning } from "@/app/features/shared/matchTypes";
import { postPipelineAdd } from "@/app/_lib/useAddToPipeline";
import { downloadFile, toCsv } from "@/app/_lib/export-utils";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { Cell } from "./MatrixShared";
import { STRONG_THRESHOLD } from "./matrixStats";
import { orderMatrixRows } from "./matrixRows";
import { computePopoverPosition } from "./matrixPopover";
import type { Candidate, Matrix, Popover, Position, ReasonState } from "./matrixTabTypes";

export function useMatrixTab() {
  const t = useTranslations("matrix");
  // API failures resolve from the machine `code`, never the server's English
  // `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const locale = useLocale();
  const enumLabel = useEnumLabel();
  // deec915c — on-demand "why this score" popover. A cell click opens a card that
  // lazily fetches /api/match/reasoning for the (candidate, job) pair (the matrix
  // candidate id IS a profileId, which writeMatchInput resolves) and shows the
  // cached verdict/strengths/gaps/probes inline — no tab switch to read the score.
  const [popover, setPopover] = useState<Popover | null>(null);
  const [reasoning, setReasoning] = useState<Record<string, ReasonState>>({});
  // deec915c a11y (bug-ui-scan-2026-07-09 (skill-matrix-coverage #5)): the cell button
  // that opened the popover (focus is restored here on close so a keyboard/AT user isn't
  // stranded) and the dialog element (focus is moved into it on open + Tab is trapped).
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // Close the popover AND return focus to the cell that opened it — the missing half of
  // the dialog contract (a bare setPopover(null) left focus nowhere).
  const closePopover = useCallback(() => {
    setPopover(null);
    const el = triggerRef.current;
    triggerRef.current = null;
    if (el && typeof el.focus === "function") el.focus();
  }, []);
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
        // The route returns a structured { error, code } body (from
        // parseStderrError) on failure — resolve its machine `code` so the real
        // cause reaches the screen in the reader's language instead of an opaque
        // status code (or the server's English `error`).
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(errMsg(body, t("loadFailedStatus", { status: r.status })));
        if (body.error) throw new Error(errMsg(body, t("loadFailed")));
        setData(body as Matrix);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("loadFailed"));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // deec915c popover a11y + layout tracking (bug-ui-scan-2026-07-09 (skill-matrix-coverage
  // #5)). Runs once per OPENED cell (keyed by candId|posId, NOT the rect) so scroll/resize
  // repositions never re-steal focus. On open: move focus into the dialog and trap Tab. On
  // Esc: close + restore focus. On resize/scroll: recompute the position from the LIVE
  // trigger rect so the popover tracks its cell instead of floating detached.
  useEffect(() => {
    if (!popover) return;
    const dialog = dialogRef.current;
    const focusables = (): HTMLElement[] =>
      dialog
        ? Array.from(dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(
            (el) => !el.hasAttribute("disabled"),
          )
        : [];
    // Initial focus → the first control (the close button), so AT announces the dialog.
    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closePopover();
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      const items = focusables();
      if (items.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const idx = active ? items.indexOf(active) : -1;
      if (e.shiftKey) {
        if (idx <= 0) {
          e.preventDefault();
          items[items.length - 1].focus();
        }
      } else if (idx === items.length - 1 || idx === -1) {
        e.preventDefault();
        items[0].focus();
      }
    };

    const reposition = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const rect = computePopoverPosition({ left: r.left, bottom: r.bottom }, { width: window.innerWidth, height: window.innerHeight });
      setPopover((cur) => (cur ? { ...cur, rect } : cur));
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", reposition);
    // Capture phase so the grid's OWN inner scroll container (overflow-auto) also fires it.
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
    // Keyed by the opened cell identity, not the rect — a reposition must not re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popover?.candId, popover?.posId, closePopover]);

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

  // rows: best-visible-fit sort by default, A–Z when toggled, or by a chosen column's
  // score when a header is clicked (MAT6); filtered to the min-fit floor. The ordering +
  // floor math lives in the pure, tested orderMatrixRows (skill-matrix-coverage #4): a row
  // with NO assessed visible cell now yields best=null (not a floored 0), so it sorts into
  // its own trailing group and the floor hides it as "unassessed", never as a real 0.
  const rowOrder = useMemo(() => {
    if (!data) return { order: [] as { cand: Candidate; ri: number }[], hiddenByFloor: 0, hiddenUnassessed: 0 };
    const colIdx = cols.map((c) => c.i);
    // Only honor a column sort while that column is visible (a family filter can hide it).
    const sortByColumn = sortCol != null && colIdx.includes(sortCol);
    const inputs = data.candidates.map((cand, ri) => ({
      item: { cand, ri },
      label: cand.label,
      visibleScores: colIdx.map((ci) => data.cells[ri]?.[ci]?.score ?? null),
      sortColScore: sortByColumn ? data.cells[ri]?.[sortCol]?.score ?? null : undefined,
    }));
    return orderMatrixRows(inputs, { sortByFit, sortByColumn, minFit });
  }, [data, cols, sortByFit, minFit, sortCol]);
  const rows = rowOrder.order;

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

  // "View full match" no longer LEAVES this tab: Match became Matrix's candidate-focus
  // mode, so the same params (?profile=<candidate>&job=<position>) now switch mode in
  // place — MatrixTab derives the mode from ?profile=. The grid's filters, scroll and
  // scope survive the trip, which they never did across a tab switch.
  const open = (candId: string, posId: string) => router.push(buildUrl({ tab: "matrix", profile: candId, job: posId }, search.toString()));

  // Switching to the full ranking — don't restore focus to the now-hidden
  // cell (that's what closePopover does); just clear the ref and close.
  const viewFullMatchAndClose = (candId: string, posId: string) => {
    open(candId, posId);
    triggerRef.current = null;
    setPopover(null);
  };

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
          if (!r.ok) throw new Error(errMsg(p, t("reasoningFailed")));
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
    // Remember the trigger so focus can be restored on close and the popover can be
    // re-anchored to the LIVE cell rect on resize/scroll (skill-matrix-coverage #5).
    triggerRef.current = ev.currentTarget;
    const rect = computePopoverPosition(
      { left: r.left, bottom: r.bottom },
      { width: typeof window !== "undefined" ? window.innerWidth : 1024, height: typeof window !== "undefined" ? window.innerHeight : 768 },
    );
    setPopover({ candId: cand.id, posId: pos.id, cand, pos, cell, rect });
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

  return {
    t,
    enumLabel,
    popover,
    reasoning,
    dialogRef,
    closePopover,
    blockedLabel,
    data,
    error,
    sortByFit,
    setSortByFit,
    family,
    setFamily,
    minFit,
    setMinFit,
    sortCol,
    setSortCol,
    selectMode,
    setSelectMode,
    selected,
    setSelected,
    added,
    adding,
    announce,
    lastAdd,
    setLastAdd,
    families,
    cols,
    scopedPosition,
    staleJob,
    clearJob,
    rowOrder,
    rows,
    rowStrong,
    colScores,
    coverage,
    open,
    viewFullMatchAndClose,
    openCell,
    toggleCell,
    addSelected,
    exitSelect,
    exportCsv,
  };
}
