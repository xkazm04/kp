"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { BTN_GHOST, EYEBROW, FIELD, KBD, META_LABEL, NOTICE, PANEL, STICKY_HEAD, TOGGLE_GROUP, toggleBtn } from "@/app/_components/ui/recipes";
import type { Gig, GigArena, GigAttempt, GigKpi } from "@/app/_lib/gigs/types";
import {
  CELL_CAP,
  deriveQueue,
  LINE_STEPS,
  lineRows,
  matchesSearch,
  NEED_KINDS,
  needsYou,
  nextNeed,
  OFF_STEPS,
  overallCell,
  queueCounts,
  specialistEdgeIndex,
  STEP_OWNER,
  type NeedKind,
  type SourceRow,
  type SpecialistRow,
} from "./gigsLogic";
import { RateLine, sentMarks } from "./GigsMarks";
import { EmptyCell, GigCard, LaneLabel, Terminus, WallLegend } from "./GigsWallCells";
import { useBareKeys } from "./useBareKeys";
import { useGigsFormat } from "./useGigsFormat";

// The line - what the Gigs tab opens on (the owner's pick of the blind contest, "The
// Line", re-expressed in kp's two registers). The program is one pipeline, so it is drawn
// as a wall: arenas are ROWS, each opened by a sticky label naming its specialists and its
// sources' state; the canonical lifecycle steps are COLUMNS; then "Left the line"
// (declined, withdrawn, expired, grouped) and a TERMINUS per arena with its rate.
//
// Three columns carry the "your judgement" band (suspect, drafted, sent); every other
// column names who owns the next move in words. An arena that never reached a step shows
// "none reached" in place; one that reached it and moved on shows "none here now".
//
// The header counts what needs the operator, as buttons that open the oldest such gig;
// `N` opens the next one. `/` searches (matches stay lit, the rest dim), and a filter dims
// everything that does not need you. The wall scrolls on both axes INSIDE its own frame,
// with the arena labels and the column heads pinned, so the page never scrolls sideways.
//
// A card opens the gig as a full page (GigsDetail.tsx). This component unmounts while
// that page is up; the tab keeps its state (search, filter, expanded cells) and the
// frame's scroll, and on the way back the wall restores both and brings the card that
// was opened into view with focus on it.

export type WallFilter = "all" | "needs";
export type WallState = { search: string; filter: WallFilter; expanded: string[] };
export const EMPTY_WALL: WallState = { search: "", filter: "all", expanded: [] };

/** Where the wall was when the operator left it. */
export type WallMemo = { left: number; top: number; page: number };

const NEED_TONE: Record<NeedKind, { on: string; count: string }> = {
  review: { on: "border-coral bg-coral/10 text-ink", count: "bg-coral text-white" },
  suspect: { on: "border-red-400 bg-red-50 text-red-800", count: "bg-red-700 text-white" },
  record: { on: "border-blue-200 bg-blue-50 text-blue-700", count: "bg-blue-700 text-white" },
};

/** The nearest ancestor that scrolls vertically: the page, as far as this tab can tell. */
function pageScroller(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight) return n;
  }
  return (document.scrollingElement as HTMLElement | null) ?? null;
}

export function GigsWall({
  gigs,
  attemptsByGig,
  truncated,
  kpi,
  sources,
  specialists,
  now,
  state,
  onState,
  memoRef,
  lastOpened,
  arenaFocus,
  onOpen,
  onOpenSpecialist,
  onOpenScorecard,
  onHire,
  onNothingNeeded,
}: {
  gigs: readonly Gig[];
  attemptsByGig: Readonly<Record<string, GigAttempt>>;
  truncated: boolean;
  kpi: GigKpi | null;
  sources: readonly SourceRow[];
  specialists: readonly SpecialistRow[];
  now: Date;
  state: WallState;
  onState: (next: WallState) => void;
  memoRef: MutableRefObject<WallMemo | null>;
  /** The gig whose page the operator last came back from - lit, and in view. */
  lastOpened: string | null;
  /** An arena crumb asked for this row. */
  arenaFocus: GigArena | null;
  onOpen: (gigId: string) => void;
  onOpenSpecialist: (id: string) => void;
  onOpenScorecard: (arena: GigArena) => void;
  onHire: (arena: GigArena) => void;
  onNothingNeeded: () => void;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const rows = useMemo(() => lineRows(gigs, attemptsByGig), [gigs, attemptsByGig]);
  const queue = useMemo(() => deriveQueue(gigs, attemptsByGig), [gigs, attemptsByGig]);
  const counts = queueCounts(queue);
  const sourceById = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);
  const specialistById = useMemo(() => new Map(specialists.map((s) => [s.id, s])), [specialists]);
  const edgeOf = useCallback((id: string) => specialistEdgeIndex(specialists, id), [specialists]);
  const searching = state.search.trim() !== "";
  const hits = searching ? gigs.filter((g) => matchesSearch(g, state.search)).length : 0;
  const stepCount = (step: string) => gigs.filter((g) => g.status === step).length;

  // Leaving for another page (a gig, a specialist, the scorecard): remember where the
  // frame and the page were, so the way back lands in the same place.
  const remember = useCallback(() => {
    const frame = frameRef.current;
    if (frame) memoRef.current = { left: frame.scrollLeft, top: frame.scrollTop, page: pageScroller(frame)?.scrollTop ?? 0 };
  }, [memoRef]);
  const open = useCallback(
    (gigId: string) => {
      remember();
      onOpen(gigId);
    },
    [remember, onOpen]
  );

  // Coming back: restore the frame and the page, then make sure the card that was opened
  // is in view and holds focus. Layout effect, so the first paint is already in place.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const m = memoRef.current;
    if (m) {
      frame.scrollLeft = m.left;
      frame.scrollTop = m.top;
      const page = pageScroller(frame);
      if (page) page.scrollTop = m.page;
    }
    if (arenaFocus) {
      const lane = frame.querySelector<HTMLElement>(`[data-lane="${arenaFocus}"]`);
      if (lane) frame.scrollTop = Math.max(0, lane.offsetTop - (frame.querySelector<HTMLElement>("[data-line-head]")?.offsetHeight ?? 0));
      return;
    }
    if (!lastOpened) return;
    const card = frame.querySelector<HTMLElement>(`[data-gig-card="${CSS.escape(lastOpened)}"]`);
    if (!card) return;
    const f = frame.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    if (c.top < f.top || c.bottom > f.bottom || c.left < f.left || c.right > f.right) card.scrollIntoView({ block: "nearest", inline: "nearest" });
    card.focus({ preventScroll: true });
    // All three are fixed for the wall's life (the tab sets them only while the wall is
    // unmounted), so this runs once: the arrival, not a reaction to every re-read.
  }, [memoRef, arenaFocus, lastOpened]);

  const openNext = useCallback(
    (only?: NeedKind) => {
      const item = nextNeed(queue, lastOpened, only);
      if (item) open(item.gig.id);
      else onNothingNeeded();
    },
    [queue, lastOpened, open, onNothingNeeded]
  );

  useBareKeys((key) => {
    if (key === "/") {
      searchRef.current?.focus();
      searchRef.current?.select();
      return true;
    }
    if (key === "n") {
      openNext();
      return true;
    }
    return false;
  });

  const toggleCell = (key: string) =>
    onState({ ...state, expanded: state.expanded.includes(key) ? state.expanded.filter((k) => k !== key) : [...state.expanded, key] });

  const card = (gig: Gig) => {
    const latest = attemptsByGig[gig.id] ?? null;
    const spId = latest?.specialistId ?? gig.specialistId;
    const hit = searching && matchesSearch(gig, state.search);
    const dim = (searching && !hit) || (state.filter === "needs" && !needsYou(gig, latest));
    return (
      <GigCard
        key={gig.id}
        gig={gig}
        latest={latest}
        source={gig.sourceId ? (sourceById.get(gig.sourceId) ?? null) : null}
        specialist={spId ? (specialistById.get(spId) ?? null) : null}
        edge={spId ? edgeOf(spId) : -1}
        now={now}
        dim={dim}
        hit={hit}
        current={gig.id === lastOpened}
        onOpen={open}
      />
    );
  };

  /** A cell's cards, capped at CELL_CAP unless opened out - or unless a search is on, or
   *  it holds the card being returned to (a hidden hit is no hit). */
  const cards = (key: string, list: Gig[]) => {
    const expanded = searching || state.expanded.includes(key) || (lastOpened !== null && list.slice(CELL_CAP).some((g) => g.id === lastOpened));
    const shown = expanded ? list : list.slice(0, CELL_CAP);
    return (
      <>
        {shown.map(card)}
        {list.length > CELL_CAP && !searching ? (
          <button type="button" onClick={() => toggleCell(key)} className={`${BTN_GHOST} min-h-8 justify-center px-2 text-sm`} aria-expanded={expanded}>
            {expanded ? t("line.showFewer") : t("line.showMore", { count: list.length - CELL_CAP })}
          </button>
        ) : null}
      </>
    );
  };

  const overall = kpi ? overallCell(kpi) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div role="group" aria-label={t("line.needsLabel")} className="flex flex-wrap items-center gap-2">
          {NEED_KINDS.map((k) => {
            const n = counts[k];
            return (
              <button
                key={k}
                type="button"
                disabled={n === 0}
                onClick={() => openNext(k)}
                className={`focus-ring inline-flex h-9 items-center gap-2 rounded-full border pl-1.5 pr-3 text-sm font-semibold transition-transform dark:-rotate-1 dark:shadow-sticker-xs dark:hover:rotate-0 ${
                  n > 0 ? NEED_TONE[k].on : "border-stone-200 text-steel"
                }`}
              >
                <span className={`inline-grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-sm nums ${n > 0 ? NEED_TONE[k].count : "bg-stone-100 text-steel"}`}>{n}</span>
                {t(`line.need.${k}` as Parameters<typeof t>[0], { count: n })}
              </button>
            );
          })}
        </div>
        {overall ? (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 lg:ml-auto">
            <span className={META_LABEL}>{t("scorecard.rateTitle")}</span>
            <RateLine cell={overall} />
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="relative">
          <span className="sr-only">{t("line.searchLabel")}</span>
          <Search size={15} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-steel" />
          <input
            ref={searchRef}
            type="search"
            value={state.search}
            onChange={(e) => onState({ ...state, search: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape") e.currentTarget.blur();
            }}
            placeholder={t("line.searchPlaceholder")}
            className={`${FIELD} w-72 pl-8`}
          />
        </label>
        <div role="group" aria-label={t("line.filterLabel")} className={TOGGLE_GROUP}>
          {(["all", "needs"] as const).map((f) => (
            <button key={f} type="button" aria-pressed={state.filter === f} onClick={() => onState({ ...state, filter: f })} className={`focus-ring rounded px-3 py-1 text-sm font-semibold ${toggleBtn(state.filter === f)}`}>
              {f === "all" ? t("line.filterAll") : t("line.filterNeeds")}
            </button>
          ))}
        </div>
        <span role="status" className="text-sm text-steel nums">
          {searching ? t("line.searchHits", { count: hits }) : null}
        </span>
        <p className="text-sm text-steel lg:ml-auto">{t.rich("line.keys", { kbd: (chunks) => <kbd className={`${KBD} text-xs`}>{chunks}</kbd> })}</p>
      </div>

      <WallLegend />
      {truncated ? <p className={`${NOTICE("amber")} px-3 py-1.5 text-sm`}>{t("line.truncated", { count: gigs.length })}</p> : null}

      <div
        ref={frameRef}
        onScroll={(e) => {
          // Kept current, so a switch to another screen by the tab strip also comes back here.
          memoRef.current = { left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop, page: memoRef.current?.page ?? 0 };
        }}
        className={`${PANEL} relative max-h-[max(26rem,calc(100dvh_-_15rem))] overflow-auto overscroll-contain`}
      >
        <div role="table" aria-label={t("line.tableLabel")} className="grid w-full min-w-[110rem] grid-cols-[12.5rem_repeat(9,minmax(8.75rem,1fr))_9.5rem_11.5rem]">
          <div role="row" className="contents">
            <div role="columnheader" className={`${STICKY_HEAD("corner")} border-t-4 border-t-transparent px-3 py-2 ${META_LABEL}`} data-line-head>
              {t("line.corner")}
            </div>
            {LINE_STEPS.map((step) => {
              const owner = STEP_OWNER[step];
              const mine = owner === "you";
              return (
                <div key={step} role="columnheader" className={`${STICKY_HEAD()} border-t-4 px-2 py-2 ${mine ? "border-t-coral" : "border-t-transparent"}`}>
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={mine ? EYEBROW : META_LABEL}>{fmt.status(step)}</span>
                    <span className="text-sm text-steel nums">{stepCount(step)}</span>
                  </span>
                  <span className={`mt-0.5 block text-xs ${mine ? "font-semibold text-coral" : "text-steel"}`}>{t(`line.owner.${owner}` as Parameters<typeof t>[0])}</span>
                </div>
              );
            })}
            <div role="columnheader" className={`${STICKY_HEAD()} border-t-4 border-t-transparent px-2 py-2`}>
              <span className={`block ${META_LABEL}`}>{t("line.leftTheLine")}</span>
              <span className="mt-0.5 block text-xs text-steel">{t("line.leftOwner")}</span>
            </div>
            <div role="columnheader" className={`${STICKY_HEAD()} border-l-2 border-t-4 border-l-stone-300 border-t-transparent px-3 py-2`}>
              <span className={`block ${META_LABEL}`}>{t("line.terminus")}</span>
              <span className="mt-0.5 block text-xs text-steel">{t("line.terminusOwner")}</span>
            </div>
          </div>

          {rows.map((row) => {
            const laneSpecialists = specialists.filter((s) => s.spec.arena === row.arena);
            return (
              <div key={row.arena} role="row" className="contents">
                <div role="rowheader" data-lane={row.arena} className="sticky left-0 z-10 border-b-2 border-r border-stone-200 bg-white p-3">
                  <LaneLabel
                    arena={row.arena}
                    total={row.total}
                    specialists={laneSpecialists}
                    edgeOf={edgeOf}
                    sources={sources.filter((s) => s.arena === row.arena)}
                    onOpenSpecialist={(id) => {
                      remember();
                      onOpenSpecialist(id);
                    }}
                    onHire={(arena) => {
                      remember();
                      onHire(arena);
                    }}
                  />
                </div>
                {row.cells.map((cell) => {
                  const mine = STEP_OWNER[cell.step] === "you";
                  const key = `${row.arena}:${cell.step}`;
                  return (
                    <div
                      key={cell.step}
                      role="cell"
                      aria-label={t("line.cellLabel", { arena: fmt.arena(row.arena), step: fmt.status(cell.step), count: cell.gigs.length })}
                      className={`flex min-w-0 flex-col items-stretch gap-2 border-b-2 border-r border-stone-200 p-2 [border-right-style:dashed] ${mine ? "bg-coral/5 dark:bg-coral/10" : ""}`}
                    >
                      {cell.gigs.length ? cards(key, cell.gigs) : <EmptyCell reached={cell.reached} />}
                    </div>
                  );
                })}
                <div role="cell" className="flex min-w-0 flex-col gap-2 border-b-2 border-stone-200 bg-stone-50 p-2">
                  {row.off.every((o) => o.gigs.length === 0) ? (
                    <span className="px-1 py-2 text-xs text-steel">{t("line.noneLeft")}</span>
                  ) : (
                    OFF_STEPS.map((step) => {
                      const group = row.off.find((o) => o.step === step)!;
                      if (group.gigs.length === 0) return null;
                      return (
                        <div key={step} className="flex flex-col gap-2">
                          <p className={META_LABEL}>
                            {fmt.status(step)} <span className="nums">{group.gigs.length}</span>
                          </p>
                          {cards(`${row.arena}:${step}`, group.gigs)}
                        </div>
                      );
                    })
                  )}
                </div>
                <div role="cell" className="border-b-2 border-l-2 border-stone-200 border-l-stone-300 bg-white p-3">
                  <Terminus
                    cell={kpi?.byArena[row.arena]}
                    marks={sentMarks(gigs, attemptsByGig, (g) => g.arena === row.arena)}
                    onOpenScorecard={() => {
                      remember();
                      onOpenScorecard(row.arena);
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
