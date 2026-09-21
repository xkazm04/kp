"use client";

// Every column at a glance, as actor-coloured ticks, with a draggable viewport.
//
// The winner drew this on a `<canvas>`. This one is DOM, and the reason is the
// dual theme: a canvas has to be told its colours in JS, which means reading
// `--color-coral` out of `getComputedStyle` and repainting on every theme flip —
// three moving parts to get a picture that CSS can paint for free and that
// re-skins itself under `[data-theme="dark"]` with no code at all. The cost is
// bounded: the ticks per column are capped, so the whole strip is a few thousand
// 1px spans built once per filter change, not per scroll frame.
//
// IT IS `aria-hidden`, AND THAT IS DELIBERATE, not an oversight. A strip of 99
// unlabelled ticks in the tab order is worse than no strip: everything it
// offers — which roles exist, where they start, jumping to a candidate — is
// reachable from the toolbar's role buttons and its find box, which are real,
// named controls. This is a picture of the board, and the board itself is the
// accessible copy.

import { useCallback, useEffect, useRef, useState } from "react";
import { actorKind, type ActorKind } from "./journeyMarks";
import type { BoardPlan } from "./journeyLayout";

/** Enough ticks to show a column's shape; past this, depth is texture. */
const MAX_TICKS = 22;

const TICK_CLASS: Record<ActorKind, string> = {
  human: "bg-coral",
  machine: "bg-steel",
  unidentified: "bg-dial-stone",
};

export function JourneyMinimap({
  plan,
  scrollerRef,
}: {
  plan: BoardPlan;
  scrollerRef: { current: HTMLElement | null };
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ left: 0, width: 0 });
  const draggingRef = useRef(false);

  const sync = useCallback(() => {
    const scroller = scrollerRef.current;
    const strip = stripRef.current;
    if (!scroller || !strip || scroller.scrollWidth <= 0) return;
    const ratio = strip.clientWidth / scroller.scrollWidth;
    setViewport({ left: scroller.scrollLeft * ratio, width: Math.max(4, scroller.clientWidth * ratio) });
  }, [scrollerRef]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        sync();
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [scrollerRef, sync, plan]);

  const travel = useCallback(
    (clientX: number) => {
      const scroller = scrollerRef.current;
      const strip = stripRef.current;
      if (!scroller || !strip) return;
      const box = strip.getBoundingClientRect();
      const fraction = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
      scroller.scrollLeft = fraction * scroller.scrollWidth - scroller.clientWidth / 2;
    },
    [scrollerRef]
  );

  return (
    <div
      ref={stripRef}
      aria-hidden="true"
      onPointerDown={(event) => {
        draggingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        travel(event.clientX);
      }}
      onPointerMove={(event) => {
        if (draggingRef.current) travel(event.clientX);
      }}
      onPointerUp={() => {
        draggingRef.current = false;
      }}
      className="relative flex h-12 shrink-0 cursor-pointer touch-none select-none items-stretch gap-px border-b border-stone-200 bg-stone-50 px-1"
    >
      {plan.clusters.map((cluster, index) => (
        <div key={cluster.cluster.jobId} className="flex min-w-0 flex-1 items-stretch gap-px">
          {index > 0 ? <span className="w-0.5 shrink-0 bg-ink" /> : null}
          {cluster.columns.map((column) => {
            const events = column.column.events.slice(0, MAX_TICKS);
            return (
              <span
                key={column.column.entryId}
                className="flex min-w-px flex-1 flex-col justify-start gap-px pt-2"
              >
                {events.length === 0 ? (
                  // A column with nothing in it is still a column. An empty slot
                  // would read as "not here"; a dashed box reads as "here, and
                  // holding nothing", which is the true statement.
                  <span className="h-2 w-full border border-dashed border-amber-400" />
                ) : (
                  events.map((event) => (
                    <span key={event.id} className={`h-px w-full ${TICK_CLASS[actorKind(event.actor)]}`} />
                  ))
                )}
              </span>
            );
          })}
        </div>
      ))}
      <span
        className="pointer-events-none absolute inset-y-0 border-2 border-ink bg-ink/10"
        style={{ left: viewport.left, width: viewport.width }}
      />
    </div>
  );
}
