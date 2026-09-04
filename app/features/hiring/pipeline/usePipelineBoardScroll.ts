"use client";

// The pipeline board's horizontal-scroll chrome: click-a-stage-header-to-center,
// the ◀/▶ column paging controls, and drag-near-the-edge auto-scroll (native
// HTML5 DnD does not auto-scroll the drop container on its own). Split out of
// PipelineBoard.tsx.

import { useCallback, useEffect, useRef, useState } from "react";

// bug-ui pipeline #4 — native HTML5 DnD does NOT auto-scroll the drop container,
// so on a board wide enough to overflow (240 + STAGES×280 = 1640px for 5 stages)
// a stage scrolled off-screen is an unreachable drop target: the recruiter must
// release, scroll, and re-drag. This edge auto-scroll glides the board left/right
// while a card is dragged near either edge. `dragover` bubbles up from the cells
// (they preventDefault but never stopPropagation), so ONE handler on the scroll
// region sees every move; an rAF loop keeps scrolling even when the pointer is
// held still inside the edge zone (dragover alone wouldn't fire when stationary).
const EDGE_ZONE = 72; // px band at each edge that triggers auto-scroll
const MAX_EDGE_SPEED = 20; // px/frame at the very edge (ramps with proximity)

export function usePipelineBoardScroll(dragEnabled: boolean) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // board-grid-has-a-name — whether there is anywhere left to page. The ◀/▶ controls
  // were always enabled, so at either end of the board a click did nothing and the
  // control gave no reason: a keyboard user tabbing the toolbar could not tell "this
  // does nothing here" from "this is broken". Both start false, so on a board narrow
  // enough not to overflow neither control ever arms.
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  // 1px of slack: a smooth scroll lands on a fractional scrollLeft, and browsers round
  // scrollWidth, so an exact comparison flickers the controls at the extremes.
  const syncExtents = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft < max - 1);
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    syncExtents();
    el.addEventListener("scroll", syncExtents, { passive: true });
    // The board's WIDTH changes without a scroll: the viewport resizes, and the axis
    // itself is workspace-editable, so a column added or removed re-measures the
    // content. Observe both boxes rather than only the viewport.
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncExtents) : null;
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", syncExtents);
      observer?.disconnect();
    };
  }, [syncExtents]);

  // Click a stage header to glide that column to the centre of the viewport, so
  // a wide pipeline is navigable left↔right without dragging the scrollbar.
  const centerColumn = (e: React.MouseEvent<HTMLButtonElement>) => {
    const container = scrollRef.current;
    if (!container) return;
    const cell = e.currentTarget;
    const delta =
      cell.getBoundingClientRect().left -
      container.getBoundingClientRect().left -
      (container.clientWidth - cell.clientWidth) / 2;
    container.scrollBy({ left: delta, behavior: "smooth" });
  };

  // Page the board one stage column at a time via the ◀/▶ controls.
  const scrollByColumn = (dir: -1 | 1) => {
    const container = scrollRef.current;
    if (!container) return;
    const col = container.querySelector<HTMLElement>("[data-stage-header]");
    const step = col?.clientWidth ?? Math.round(container.clientWidth * 0.6);
    container.scrollBy({ left: dir * step, behavior: "smooth" });
  };

  const autoScroll = useRef<{ vx: number; raf: number | null }>({ vx: 0, raf: null });
  const stopAutoScroll = () => {
    const s = autoScroll.current;
    s.vx = 0;
    if (s.raf != null) {
      cancelAnimationFrame(s.raf);
      s.raf = null;
    }
  };
  const stepAutoScroll = () => {
    const s = autoScroll.current;
    const el = scrollRef.current;
    if (!el || s.vx === 0) {
      s.raf = null;
      return;
    }
    el.scrollLeft += s.vx;
    s.raf = requestAnimationFrame(stepAutoScroll);
  };
  const onBoardDragOver = (ev: React.DragEvent) => {
    if (!dragEnabled) return;
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ev.clientX;
    let vx = 0;
    // x <= 0 is the spurious final dragover some browsers fire as the drag ends —
    // ignore it so the board doesn't lurch left on drop.
    if (x > 0 && x < rect.left + EDGE_ZONE) {
      vx = -Math.ceil(((rect.left + EDGE_ZONE - x) / EDGE_ZONE) * MAX_EDGE_SPEED);
    } else if (x > rect.right - EDGE_ZONE) {
      vx = Math.ceil(((x - (rect.right - EDGE_ZONE)) / EDGE_ZONE) * MAX_EDGE_SPEED);
    }
    const s = autoScroll.current;
    s.vx = vx;
    if (vx !== 0 && s.raf == null) s.raf = requestAnimationFrame(stepAutoScroll);
  };
  // Cancel any running loop on unmount so an rAF can't outlive the component.
  useEffect(() => stopAutoScroll, []);

  return { scrollRef, centerColumn, scrollByColumn, onBoardDragOver, stopAutoScroll, canScrollLeft, canScrollRight };
}
